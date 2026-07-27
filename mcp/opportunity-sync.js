// ============================================================================
// opportunity-sync.js — BUILD 01: inbound SF Opportunity → LCC (deal backbone)
// Place in mcp/opportunity-sync.js (engine deploy context). Register in mcp/server.js
// next to sf-writeback, and add a proxy route in root server.js (ai-read pattern).
//
//   import { makeOpportunitySyncRoute } from './opportunity-sync.js';
//   const oppSync = makeOpportunitySyncRoute({ opsQuery, enc, WORKSPACE_ID: PRIMARY_WORKSPACE_ID });
//   app.post('/api/pipeline/ingest-opportunity', authenticate, oppSync.ingest);
//
// Body (per Opportunity, from the "SF -> LCC Opportunity Sync" PA flow):
//   { sf_opp_id, name:"Tenant - City, State", stage_name, amount, close_date,
//     owner_sf_user_id?, property_address?, vertical? }
// ============================================================================

// SF Opportunity StageName -> bd_opportunities.stage (confirm the picklist matches exactly)
const STAGE_MAP = {
  'BOV': 'bov',
  'ELA': 'ela',
  'LOI Executed': 'loi_executed',
  'In Escrow': 'in_escrow',
  'Non-Refundable': 'non_refundable',
  'Closed': 'closed',
};
const CONTRACTUAL = new Set(['loi_executed', 'in_escrow', 'non_refundable']);

// Parse "Tenant - City, State" -> {tenant, city, state}
function parseDealName(name) {
  const s = String(name || '').trim();
  let tenant = s, city = null, state = null;
  const parts = s.split(/\s+-\s+/);              // "Tenant" | "City, State"
  if (parts.length >= 2) {
    tenant = parts[0].trim();
    const loc = parts.slice(1).join(' - ').trim();
    const cm = loc.split(',');
    city = (cm[0] || '').trim() || null;
    state = (cm[1] || '').trim() || null;
  }
  return { tenant, city, state };
}

async function resolveDealEntity(body, { opsQuery, enc, WORKSPACE_ID }) {
  const { sf_opp_id, name } = body;
  // 1. Already linked via a prior sync?
  if (sf_opp_id) {
    const linked = await opsQuery('GET',
      `bd_opportunities?workspace_id=eq.${enc(WORKSPACE_ID)}&sf_opp_id=eq.${enc(sf_opp_id)}&select=entity_id&limit=1`);
    if (linked.data?.[0]?.entity_id) return { entity_id: linked.data[0].entity_id, created: false };
  }
  const { tenant, city, state } = parseDealName(name);
  // 2. Match an existing asset by city + state + tenant token (robust to name-format differences)
  if (city) {
    let q = `entities?entity_type=eq.asset&city=ilike.${enc('*' + city + '*')}`;
    if (state) q += `&state=eq.${enc(state)}`;
    if (tenant) q += `&name=ilike.${enc('*' + tenant.split(/\s+/)[0] + '*')}`;
    q += `&select=id,name,city,state&limit=6`;
    const r = await opsQuery('GET', q);
    const rows = r.data || [];
    if (rows.length === 1) return { entity_id: rows[0].id, created: false };
    if (rows.length > 1) return { ambiguous: true, candidates: rows.map(x => ({ id: x.id, name: x.name })) };
  }
  // 3. Create the deal entity (source-tagged; FP: convert to lcc_merge_field when the fact-fabric writer lands)
  const id = globalThis.crypto.randomUUID();
  const ins = await opsQuery('POST', 'entities', {
    id, workspace_id: WORKSPACE_ID, entity_type: 'asset',
    name, canonical_name: name, city, state, domain: body.vertical || null,
    owner_role: 'unknown', address: body.property_address || null,
    metadata: { source: 'salesforce', sf_opp_id, provenance: 'opportunity_sync' },
  });
  if (ins.ok === false) return { error: 'entity_create_failed', detail: ins.data };
  return { entity_id: id, created: true };
}

export function makeOpportunitySyncRoute({ opsQuery, enc, WORKSPACE_ID }) {
  return {
    ingest: async (req, res) => {
      const b = req.body || {};
      if (!b.sf_opp_id || !b.name || !b.stage_name) {
        return res.status(400).json({ ok: false, error: 'sf_opp_id, name, stage_name required' });
      }
      const stage = STAGE_MAP[b.stage_name];
      if (!stage) return res.status(400).json({ ok: false, error: `unknown stage_name "${b.stage_name}"` });

      const rec = await resolveDealEntity(b, { opsQuery, enc, WORKSPACE_ID });
      if (rec.ambiguous) return res.status(409).json({ ok: false, ambiguous: true, candidates: rec.candidates });
      if (rec.error) return res.status(502).json({ ok: false, ...rec });

      // Owner: map SF user -> lcc_users (graceful if unmapped)
      // lcc_users PK is lcc_user_id; the SF owner id lives in salesforce_owner_id (all 4 users mapped)
      let owner_user_id = null;
      if (b.owner_sf_user_id) {
        const u = await opsQuery('GET',
          `lcc_users?salesforce_owner_id=eq.${enc(b.owner_sf_user_id)}&select=lcc_user_id&limit=1`);
        owner_user_id = u.data?.[0]?.lcc_user_id || null;
      }

      // Upsert bd_opportunities on sf_opp_id (idempotent — H5)
      const row = {
        workspace_id: WORKSPACE_ID, entity_id: rec.entity_id, sf_opp_id: b.sf_opp_id,
        stage, is_open: stage !== 'closed',
        amount: (b.amount ?? null), expected_close_date: (b.close_date || null),
        owner_user_id, vertical: (b.vertical || null), last_synced_at: new Date().toISOString(),
        metadata: b.owner_sf_user_id && !owner_user_id ? { owner_sf_user_id: b.owner_sf_user_id } : {},
      };
      const up = await opsQuery('POST',
        'bd_opportunities?on_conflict=workspace_id,sf_opp_id', row,
        { Prefer: 'return=representation,resolution=merge-duplicates' });
      if (up.ok === false) return res.status(502).json({ ok: false, error: 'upsert_failed', detail: up.data });
      const saved = Array.isArray(up.data) ? up.data[0] : up.data;

      return res.status(200).json({
        ok: true, entity_id: rec.entity_id, created_entity: rec.created,
        bd_opportunity_id: saved?.id || null, stage,
        needs_psa_timeline: CONTRACTUAL.has(stage),   // signal for FP/E5 milestone population
      });
    },
  };
}
