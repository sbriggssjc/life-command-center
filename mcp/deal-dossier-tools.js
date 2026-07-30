// ============================================================================
// deal-dossier-tools.js — v2 (reconciled 2026-07-26)
// The dossier is a PROJECTION over EXISTING infra — no new tables:
//   • deal identity  = an `entities` row (entity_type='asset'), keyed by entity_id
//   • correspondence = `activity_events` WHERE entity_id (email/outlook/salesforce/copilot already flow in)
//   • milestones     = `activity_events` category='status_change' + metadata{milestone,...} (category enum has no
//                      'milestone' value; we tag via metadata — zero schema change)
//   • economics      = the domain (dia/gov) record + `lcc_cre_bov_extraction.record`
// Writes go to `activity_events` (touchpoints/milestones). SF writes go via sf-writeback.js → sf_sync_queue.
//
// Wired in server.js:
//   import { makeDealDossierTools, makeDealDossierHttpRoutes } from './api/deal-dossier-tools.js';
//   const dd = makeDealDossierTools({ opsQuery, textResult, withTiming, enc, WORKSPACE_ID: PRIMARY_WORKSPACE_ID });
//   Object.assign(TOOL_DEFINITIONS, dd.defs); Object.assign(TOOL_HANDLERS, dd.handlers);
//   const ddh = makeDealDossierHttpRoutes({ opsQuery, enc, WORKSPACE_ID: PRIMARY_WORKSPACE_ID });
//   app.get ('/api/deal/dossier',     authenticate, ddh.getDossier);
//   app.get ('/api/deal/checkpoints', authenticate, ddh.listCheckpoints);
// ============================================================================

const VIS = 'shared';                         // activity_events.visibility enum: private|assigned|shared
const TOUCH_CATEGORY = { note: 'note', call: 'call', email: 'email', meeting: 'meeting' };

// Resolve a deal reference → the entities 'asset' row. Refuse-to-guess on ambiguity.
async function resolveEntity(deal, { opsQuery, enc }) {
  const key = String(deal || '').trim();
  if (!key) return { error: 'deal (name / address / entity id) is required' };
  // direct entity id?
  if (/^[0-9a-f-]{36}$/i.test(key)) {
    const r = await opsQuery('GET', `entities?id=eq.${enc(key)}&select=id,name,entity_type,address,city,state,asset_type,domain,metadata&limit=1`);
    if (r.data?.[0]) return { entity: r.data[0] };
  }
  const like = `*${enc(key)}*`;
  const r = await opsQuery('GET',
    `entities?entity_type=eq.asset&or=(name.ilike.${like},address.ilike.${like},normalized_address.ilike.${like})` +
    `&select=id,name,entity_type,address,city,state,asset_type,domain,metadata&limit=6`);
  const rows = r.data || [];
  if (!rows.length) return { error: `no asset entity matched "${key}"` };
  if (rows.length > 1) return { error: 'ambiguous', candidates: rows.map(x => ({ id: x.id, name: x.name, city: x.city })) };
  return { entity: rows[0] };
}

async function readDossier(deal, { opsQuery, enc }) {
  const rec = await resolveEntity(deal, { opsQuery, enc });
  if (rec.error) return rec;
  const e = rec.entity;
  // Prefer the deal anchor over entity_id ALONE: dual-anchor mail (thread b) and
  // the backfill stamp the deal in metadata.deal_entity_id while entity_id may be
  // the original/other value, so an entity_id-only read misses stamped
  // correspondence. Read BOTH anchors and merge (two simple filters rather than
  // an or() with a JSON accessor, which is PostgREST-version-sensitive), dedupe
  // by id, sort desc, cap 50.
  const sel = 'select=id,occurred_at,category,title,body,source_type,external_url,metadata';
  const [byEntity, byDealAnchor] = await Promise.all([
    opsQuery('GET', `activity_events?entity_id=eq.${enc(e.id)}&${sel}&order=occurred_at.desc&limit=50`),
    opsQuery('GET', `activity_events?metadata->>deal_entity_id=eq.${enc(e.id)}&${sel}&order=occurred_at.desc&limit=50`),
  ]);
  const seen = new Set();
  const acts = [...((byEntity.data) || []), ...((byDealAnchor.data) || [])]
    .filter(a => { const k = a.id || `${a.occurred_at}|${a.external_url}|${a.title}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => String(b.occurred_at || '').localeCompare(String(a.occurred_at || '')))
    .slice(0, 50);
  const milestones = acts.filter(a => a.category === 'status_change' && a.metadata && a.metadata.milestone);
  const correspondence = acts.filter(a => ['email', 'call', 'meeting', 'note'].includes(a.category));
  return {
    entity_id: e.id, name: e.name, address: e.address, city: e.city, state: e.state,
    domain: e.domain, asset_type: e.asset_type,
    correspondence, milestones,
    activity_count: acts.length,
    note: 'Economics (NOI/price/cap) come from the domain record / lcc_cre_bov_extraction — join in the surface if needed.',
  };
}

function checkpointFlags(milestones, within_days) {
  const today = new Date().toISOString().slice(0, 10);
  const within = parseInt(within_days, 10) || 14;
  const out = milestones.map(m => {
    const md = m.metadata || {};
    const due = md.milestone_date || (m.occurred_at ? m.occurred_at.slice(0, 10) : null);
    const status = md.status || 'pending';
    let flag = status;
    if (['pending', 'overdue'].includes(status) && due) {
      const days = Math.round((new Date(due) - new Date(today)) / 86400000);
      flag = days < 0 ? 'overdue' : (days <= within ? 'due-soon' : 'pending');
      md._days_out = days;
    }
    return { milestone: md.milestone, date: due, status, condition: md.condition || null, flag };
  }).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return { next_checkpoint: out.find(c => ['overdue', 'due-soon', 'pending'].includes(c.flag)) || null, checkpoints: out };
}

async function insertActivity(row, { opsQuery }) {
  const r = await opsQuery('POST', 'activity_events', row);
  return r.ok !== false;
}

export function makeDealDossierTools({ opsQuery, textResult, withTiming, enc, WORKSPACE_ID }) {
  const defs = {
    get_deal_dossier: {
      name: 'get_deal_dossier',
      description: "Read a deal's living context — the entity snapshot plus its correspondence/activity timeline and milestones — from LCC (entities + activity_events). Call FIRST when working a specific transaction. Pass the deal name/address/entity id.",
      inputSchema: { type: 'object', properties: { deal: { type: 'string', description: 'Deal name / address / entity id' } }, required: ['deal'] },
    },
    list_deal_checkpoints: {
      name: 'list_deal_checkpoints',
      description: "List a deal's milestone checkpoints (from activity_events status_change + metadata), flagging overdue / due within N days. Feeds the proactive monitor / daily briefing.",
      inputSchema: { type: 'object', properties: { deal: { type: 'string' }, within_days: { type: 'number', description: 'default 14' } }, required: ['deal'] },
    },
    update_deal_dossier: {
      name: 'update_deal_dossier',
      description: "Append a deal touchpoint or milestone to activity_events (LCC's timeline). kind='touchpoint' → a note/call/email/meeting; kind='milestone' → a dated checkpoint (stored as status_change + metadata). Write-gated (MCP/Claude). Also update the _DEAL-DOSSIER.md file in the same step.",
      inputSchema: {
        type: 'object',
        properties: {
          deal: { type: 'string' },
          kind: { type: 'string', enum: ['touchpoint', 'milestone'], description: 'touchpoint | milestone' },
          summary: { type: 'string', description: 'one-line title/summary (required)' },
          body: { type: 'string', description: 'optional detail' },
          channel: { type: 'string', enum: ['note', 'call', 'email', 'meeting'], description: 'touchpoint channel (default note)' },
          occurred_at: { type: 'string', description: 'ISO datetime (default now)' },
          milestone_name: { type: 'string' }, milestone_date: { type: 'string', description: 'YYYY-MM-DD' },
          milestone_status: { type: 'string', enum: ['pending', 'met', 'waived', 'overdue'] },
          milestone_condition: { type: 'string', description: "e.g. 'receipt of final CO from City'" },
        },
        required: ['deal', 'kind', 'summary'],
      },
    },
  };

  const handlers = {
    get_deal_dossier: async ({ deal }) => withTiming('get_deal_dossier', async () => textResult(await readDossier(deal, { opsQuery, enc }))),
    list_deal_checkpoints: async ({ deal, within_days }) => withTiming('list_deal_checkpoints', async () => {
      const d = await readDossier(deal, { opsQuery, enc });
      if (d.error) return textResult(d);
      return textResult({ entity_id: d.entity_id, name: d.name, ...checkpointFlags(d.milestones, within_days) });
    }),
    update_deal_dossier: async (a) => withTiming('update_deal_dossier', async () => {
      const rec = await resolveEntity(a.deal, { opsQuery, enc });
      if (rec.error) return textResult(rec);
      if (!a.summary) return textResult({ error: 'summary is required' });
      const now = new Date().toISOString();
      const base = { workspace_id: WORKSPACE_ID, entity_id: rec.entity.id, visibility: VIS, domain: rec.entity.domain, source_type: 'claude', title: String(a.summary).slice(0, 300), body: a.body || null };
      let row;
      if (a.kind === 'milestone') {
        row = { ...base, category: 'status_change', occurred_at: a.milestone_date ? `${a.milestone_date}T00:00:00Z` : now,
          metadata: { milestone: a.milestone_name || a.summary, milestone_date: a.milestone_date || null, status: a.milestone_status || 'pending', condition: a.milestone_condition || null } };
      } else {
        row = { ...base, category: TOUCH_CATEGORY[a.channel] || 'note', occurred_at: a.occurred_at || now, metadata: { via: 'update_deal_dossier' } };
      }
      const ok = await insertActivity(row, { opsQuery });
      return textResult({ ok, entity_id: rec.entity.id, kind: a.kind, logged: base.title });
    }),
  };
  return { defs, handlers };
}

export function makeDealDossierHttpRoutes({ opsQuery, enc }) {
  return {
    getDossier: async (req, res) => { const out = await readDossier(req.body?.deal ?? req.query.deal, { opsQuery, enc }); res.status(out.error ? (out.candidates ? 409 : 400) : 200).json(out); },
    listCheckpoints: async (req, res) => {
      const d = await readDossier(req.body?.deal ?? req.query.deal, { opsQuery, enc });
      if (d.error) return res.status(d.candidates ? 409 : 400).json(d);
      res.json({ entity_id: d.entity_id, name: d.name, ...checkpointFlags(d.milestones, req.body?.within_days ?? req.query.within_days) });
    },
  };
}
