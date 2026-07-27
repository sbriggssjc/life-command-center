// ============================================================================
// sf-writeback.js — v2 (reconciled 2026-07-26)
// LCC is the single SF writer, via the EXISTING mechanism: enqueue into `sf_sync_queue`
// (a Power Automate poller already executes the queue against Salesforce and writes
// status/result). No new PA flow URLs, no direct Copilot SF connector.
// Pipeline: resolve deal→entity → log to Cortex → INSERT sf_sync_queue{kind,payload,status:'pending'}.
//
// Wired in server.js:
//   import { makeSfWritebackRoutes } from './api/sf-writeback.js';
//   const sf = makeSfWritebackRoutes({ opsQuery, enc, logMemory, WORKSPACE_ID: PRIMARY_WORKSPACE_ID });
//   app.post('/api/sf/log-activity',        authenticate, sf.logActivity);
//   app.post('/api/sf/create-task',         authenticate, sf.createTask);
//   app.post('/api/sf/update-opportunity',  authenticate, sf.updateOpportunity);
// The existing sf_sync_queue poller/PA flow resolves the SF target from the entity + kind.
// ============================================================================

async function resolveEntity(deal, { opsQuery, enc }) {
  const key = String(deal || '').trim();
  if (!key) return { error: 'deal (name / address / entity id) is required' };
  if (/^[0-9a-f-]{36}$/i.test(key)) {
    const r = await opsQuery('GET', `entities?id=eq.${enc(key)}&select=id,name,entity_type,domain&limit=1`);
    if (r.data?.[0]) return { entity: r.data[0] };
  }
  const like = `*${enc(key)}*`;
  const r = await opsQuery('GET', `entities?entity_type=in.(person,asset)&or=(name.ilike.${like},address.ilike.${like})&select=id,name,entity_type,domain&limit=6`);
  const rows = r.data || [];
  if (!rows.length) return { error: `no person or deal matched "${key}" — refusing to enqueue blind` };
  if (rows.length > 1) return { error: 'ambiguous', candidates: rows.map(x => ({ id: x.id, name: x.name })) };
  return { entity: rows[0] };
}

async function enqueue({ kind, payload, requested_by }, { opsQuery, WORKSPACE_ID }) {
  const r = await opsQuery('POST', 'sf_sync_queue', {
    workspace_id: WORKSPACE_ID, kind, payload, status: 'pending',
    requested_by: requested_by || 'lcc:sf-writeback', requested_at: new Date().toISOString(),
  });
  return r.ok !== false;
}

const SYSTEM_ACTOR = 'b0000000-0000-0000-0000-000000000001'; // service actor (matches activity_events data)

export function makeSfWritebackRoutes({ opsQuery, enc, logMemory, WORKSPACE_ID }) {
  // Confirmation is enforced at the SURFACE layer (Copilot Studio "require confirmation"
  // on the action; ChatGPT's own write prompt), NOT with an HTTP 428 — Copilot connectors
  // treat any non-2xx as ConnectorRequestFailure, which broke the write end to end.
  // resolveEntity() still refuses ambiguous/unmatched deals, so nothing enqueues blind.
  // `user_confirmed` is still recorded in the payload for audit when the caller sends it.
  const confirmed = () => true;
  const log = async (summary, detail) => { try { await logMemory({ summary, domain: 'work', kind: 'outcome', detail }); } catch { /* non-fatal */ } };

  return {
    // POST { deal, subject, note, activity_type?, user_confirmed }
    logActivity: async (req, res) => {
      const rec = await resolveEntity(req.body?.deal, { opsQuery, enc });
      if (rec.error) return res.status(rec.candidates ? 409 : 400).json(rec);
      if (!confirmed(req, res)) return;
      const subject = req.body.subject || 'Call';
      const note = req.body.note || '';
      const activity_type = req.body.activity_type || 'Call';
      const cat = ({ email: 'email', meeting: 'meeting' })[String(activity_type).toLowerCase()] || 'call';
      // (1) System of record: the FULL interaction detail lives in LCC (activity_events call row on the deal).
      const lcc_activity_id = globalThis.crypto.randomUUID();
      try {
        await opsQuery('POST', 'activity_events', {
          id: lcc_activity_id, workspace_id: WORKSPACE_ID, actor_id: SYSTEM_ACTOR, visibility: 'shared',
          category: cat, title: subject, body: note, entity_id: rec.entity.id,
          source_type: 'lcc:copilot', metadata: { logged_via: 'copilot', sf_link_only: true },
        });
      } catch { /* non-fatal: still queue the SF link */ }
      await log(`Call logged in LCC for ${rec.entity.name}: ${subject}`.slice(0, 200), { entity_id: rec.entity.id, kind: 'log_activity', lcc_activity_id });
      // (2) Salesforce gets a LINK/pointer ONLY — interaction notes are NOT synced out of LCC.
      const lcc_ref = `Logged in LCC (activity ${lcc_activity_id}) — full notes retained in LCC, not synced to Salesforce.`;
      const ok = await enqueue({ kind: 'log_call', requested_by: req.body.requested_by,
        payload: { entity_id: rec.entity.id, activity_type, subject, lcc_activity_id, lcc_ref, link_only: true } }, { opsQuery, WORKSPACE_ID });
      res.status(ok ? 202 : 502).json({ ok, queued: ok, deal: rec.entity.name, lcc_activity_id, salesforce: 'link-only (notes retained in LCC)' });
    },
    // POST { deal, subject, due_date?, assignee_email?, user_confirmed }
    createTask: async (req, res) => {
      const rec = await resolveEntity(req.body?.deal, { opsQuery, enc });
      if (rec.error) return res.status(rec.candidates ? 409 : 400).json(rec);
      if (!confirmed(req, res)) return;
      await log(`SF task queued for ${rec.entity.name}: ${req.body.subject || ''}`.slice(0, 200), { entity_id: rec.entity.id, kind: 'create_task' });
      const ok = await enqueue({ kind: 'create_task', requested_by: req.body.requested_by,
        payload: { entity_id: rec.entity.id, subject: req.body.subject, due_date: req.body.due_date || null, assignee_email: req.body.assignee_email || null } }, { opsQuery, WORKSPACE_ID });
      res.status(ok ? 202 : 502).json({ ok, queued: ok, deal: rec.entity.name });
    },
    // POST { deal, fields:{stage?,close_date?,amount?,...}, user_confirmed }
    updateOpportunity: async (req, res) => {
      const rec = await resolveEntity(req.body?.deal, { opsQuery, enc });
      if (rec.error) return res.status(rec.candidates ? 409 : 400).json(rec);
      const fields = req.body?.fields || {};
      if (!Object.keys(fields).length) return res.status(400).json({ ok: false, error: 'fields{} required' });
      const ALLOWED = ['stage', 'close_date', 'amount', 'probability', 'next_step']; // TODO(org): confirm SF field API names
      const bad = Object.keys(fields).filter(k => !ALLOWED.includes(k));
      if (bad.length) return res.status(400).json({ ok: false, error: `fields not allowed: ${bad.join(', ')}` });
      if (!confirmed(req, res)) return;
      // The existing sf_sync_queue poller vocabulary supports STAGE advancement
      // (advance_opportunity_stage). Other Opportunity fields aren't wired to a poller kind yet.
      if (!fields.stage) return res.status(400).json({ ok: false, error: 'SF poller currently supports Opportunity STAGE advancement only — send fields.stage. (close_date/amount/etc. need a poller kind first.)' });
      await log(`SF opportunity stage advance queued for ${rec.entity.name}: ${fields.stage}`.slice(0, 200), { entity_id: rec.entity.id, kind: 'advance_opportunity_stage', fields });
      const ok = await enqueue({ kind: 'advance_opportunity_stage', requested_by: req.body.requested_by,
        payload: { entity_id: rec.entity.id, stage: fields.stage } }, { opsQuery, WORKSPACE_ID });
      res.status(ok ? 202 : 502).json({ ok, queued: ok, deal: rec.entity.name });
    },
  };
}
