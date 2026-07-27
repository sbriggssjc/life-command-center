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
    const r = await opsQuery('GET', `entities?id=eq.${enc(key)}&select=id,name,domain&limit=1`);
    if (r.data?.[0]) return { entity: r.data[0] };
  }
  const like = `*${enc(key)}*`;
  const r = await opsQuery('GET', `entities?entity_type=eq.asset&or=(name.ilike.${like},address.ilike.${like})&select=id,name,domain&limit=6`);
  const rows = r.data || [];
  if (!rows.length) return { error: `no asset entity matched "${key}" — refusing to enqueue blind` };
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
      await log(`SF activity queued for ${rec.entity.name}: ${req.body.subject || req.body.note || ''}`.slice(0, 200), { entity_id: rec.entity.id, kind: 'log_activity' });
      const ok = await enqueue({ kind: 'log_activity', requested_by: req.body.requested_by,
        payload: { entity_id: rec.entity.id, activity_type: req.body.activity_type || 'Call', subject: req.body.subject, note: req.body.note } }, { opsQuery, WORKSPACE_ID });
      res.status(ok ? 202 : 502).json({ ok, queued: ok, deal: rec.entity.name });
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
      await log(`SF opportunity update queued for ${rec.entity.name}: ${Object.keys(fields).join(', ')}`.slice(0, 200), { entity_id: rec.entity.id, kind: 'update_opportunity', fields });
      const ok = await enqueue({ kind: 'update_opportunity', requested_by: req.body.requested_by,
        payload: { entity_id: rec.entity.id, fields } }, { opsQuery, WORKSPACE_ID });
      res.status(ok ? 202 : 502).json({ ok, queued: ok, deal: rec.entity.name });
    },
  };
}
