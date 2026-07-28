// ============================================================================
// opportunity-sync.js — BUILD 01: inbound SF Opportunity → LCC (deal backbone)
// Place in mcp/opportunity-sync.js (engine deploy context).
//
//   import { makeOpportunitySyncRoute } from './opportunity-sync.js';
//   const oppSync = makeOpportunitySyncRoute({ opsQuery, enc, WORKSPACE_ID: PRIMARY_WORKSPACE_ID });
//   app.post('/api/pipeline/ingest-opportunity',   authenticate, oppSync.ingest);      // single
//   app.post('/api/pipeline/ingest-opportunities', authenticate, oppSync.ingestBatch); // batch
//
// Single body:  { sf_opp_id|Id, name|Name:"Tenant - City, State", stage_name|StageName,
//                 amount|Amount, close_date|CloseDate, owner_sf_user_id|OwnerId, ... }
// Batch body:   { "deals": [ <raw SF Opportunity records> ] }  — engine loops server-side
//               so Power Automate makes ONE call instead of a 590-iteration Apply-to-each.
// ============================================================================

// SF Opportunity StageName -> bd_opportunities.stage
const STAGE_MAP = {
  // Sale Deal record-type stages
  'BOV': 'bov',
  'ELA': 'ela',
  'LOI Executed': 'loi_executed',
  'In Escrow': 'in_escrow',
  'Non-Refundable': 'non_refundable',
  'Non-refundable': 'non_refundable',
  'Closed': 'closed',
  // IS record-type stages (Buy Side / Off-Market / Co-Broke / Referral)
  'Listing Signed': 'listing_signed',
  'Off-Market Listing': 'off_market_listing',
  'Closed IS': 'closed',          // completed investment sale = closed-won
  'Terminated IS': 'terminated',  // dead investment sale = closed-lost
};
const CONTRACTUAL = new Set(['loi_executed', 'in_escrow', 'non_refundable']);

// Cadence regime per stage (shared with cadence-scan + the deal monitor so producer and consumers
// agree). A = active-listing / pursuit (cadence-driven, ball-in-court = us); B = contractual
// (milestone/deadline-driven, NOT touch cadence); C = terminal (low-frequency nurture/revive).
// Derived, never stored. Unknown/new stages default to 'A' — surfaced, not silently ignored.
export const STAGE_REGIME = {
  identified: 'A', bov: 'A', ela: 'A', listing_signed: 'A', off_market_listing: 'A',
  loi_executed: 'B', in_escrow: 'B', non_refundable: 'B',
  closed: 'C', terminated: 'C',
};
export function stageRegime(stage) { return STAGE_REGIME[stage] || 'A'; }

// Accept both the raw SF record shape (Id/Name/StageName/...) and the internal shape.
function normalizeDeal(d) {
  d = d || {};
  return {
    sf_opp_id: d.sf_opp_id ?? d.Id ?? d.id ?? null,
    name: d.name ?? d.Name ?? null,
    stage_name: d.stage_name ?? d.StageName ?? null,
    owner_sf_user_id: d.owner_sf_user_id ?? d.OwnerId ?? null,
    amount: d.amount ?? d.Amount ?? null,
    close_date: d.close_date ?? d.CloseDate ?? null,
    vertical: d.vertical ?? null,
    // A5b: SF Opportunity carries the property address in formula fields — capture it.
    property_address: d.property_address ?? d.Property_Address__c ?? d.Property_Address_Line_1__c ?? null,
  };
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout after ${ms}ms${label ? ' (' + label + ')' : ''}`)), ms)),
  ]);
}

// Parse "Tenant - City, State" -> {tenant, city, state}
function parseDealName(name) {
  const s = String(name || '').trim();
  let tenant = s, city = null, state = null;
  const parts = s.split(/\s+-\s+/);              // "Tenant" | "City, State" | "City" | "State"
  if (parts.length >= 2) {
    tenant = parts[0].trim();
    // Deals come in two shapes: "Tenant - City, State" (comma) AND "Tenant - City - State"
    // (all dashes, e.g. "SSA - Forest - MS"). Normalize the remaining dashes to commas
    // so both forms split into city + state the same way.
    const loc = parts.slice(1).join(' - ').replace(/\s+-\s+/g, ', ').trim();
    const cm = loc.split(',');
    city = (cm[0] || '').trim() || null;
    state = (cm[1] || '').trim() || null;
  }
  return { tenant, city, state };
}

// A5b: address disambiguation key — leading street number + first 2 non-directional street words.
// "2860 S US Highway 83" and "2860 US Highway 83 South" both -> "2860 us highway" (same property).
function addrKey(a) {
  const s = String(a || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const m = s.match(/^(\d+)\s+(.+)$/);
  if (!m) return null;
  const dir = new Set(['n', 's', 'e', 'w', 'north', 'south', 'east', 'west', 'ne', 'nw', 'se', 'sw']);
  const words = m[2].split(' ').filter(w => w && !dir.has(w));
  if (!words.length) return null;
  return m[1] + ' ' + words.slice(0, 2).join(' ');
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
  const tok = String(tenant || '').split(/\s+/)[0].toLowerCase();
  let ambiguousCandidates = null;   // set when city+state has multiple assets the tenant token can't disambiguate
  // 2. Resolve by city + state. LCC assets are frequently named by ADDRESS
  //    (e.g. "2155 Main Street East, Snellville, GA") with no tenant string on
  //    the row, so the tenant token is used ONLY to break collisions — never as
  //    a hard pre-filter (that would miss address-named assets and duplicate them).
  if (city) {
    let q = `entities?entity_type=eq.asset&city=ilike.${enc(city)}`;
    if (state) q += `&state=eq.${enc(state)}`;
    q += `&select=id,name,address,canonical_name,domain&limit=60`;
    const r = await opsQuery('GET', q);
    const rows = r.data || [];
    if (rows.length === 1) return { entity_id: rows[0].id, created: false };
    if (rows.length > 1) {
      // A5b: property address is the strongest disambiguator. If the deal's address keys to exactly one
      // candidate asset, take it — no ambiguous flag. (Falls through to tenant/flag when absent or unclear.)
      const dealKey = addrKey(body.property_address);
      if (dealKey) {
        const aHits = rows.filter(x => addrKey(x.address) === dealKey);
        if (aHits.length === 1) return { entity_id: aHits[0].id, created: false };
      }
      // Collision: prefer the asset whose name/address/canonical_name contains the tenant token.
      const hits = tok
        ? rows.filter(x => `${x.name} ${x.address || ''} ${x.canonical_name || ''}`.toLowerCase().includes(tok))
        : [];
      if (hits.length === 1) return { entity_id: hits[0].id, created: false };
      // Ambiguous: NEVER block the sync. Fall through to create a flagged entity and
      // record the candidates in metadata for later merge.
      ambiguousCandidates = rows.map(x => ({ id: x.id, name: x.name }));
    }
  }
  // 3. Create the deal entity (source-tagged).
  const id = globalThis.crypto.randomUUID();
  const eMeta = { source: 'salesforce', sf_opp_id, provenance: 'opportunity_sync' };
  if (ambiguousCandidates) eMeta.ambiguous_resolution = ambiguousCandidates;
  const ins = await opsQuery('POST', 'entities', {
    id, workspace_id: WORKSPACE_ID, entity_type: 'asset',
    name, canonical_name: name, city, state, domain: body.vertical || null,
    owner_role: 'unknown', address: body.property_address || null,
    metadata: eMeta,
  });
  if (ins.ok === false) return { error: 'entity_create_failed', detail: ins.data };
  return { entity_id: id, created: true, ambiguous: !!ambiguousCandidates };
}

// Core per-deal logic. Returns { status, body } — never sends a response itself, so it is
// reused by both the single route and the batch loop.
async function processDeal(raw, deps) {
  const { opsQuery, enc, WORKSPACE_ID } = deps;
  const b = normalizeDeal(raw);
  if (!b.sf_opp_id || !b.name || !b.stage_name) {
    return { status: 400, body: { ok: false, error: 'sf_opp_id, name, stage_name required', sf_opp_id: b.sf_opp_id } };
  }
  // Map the SF stage. Unknown stages are normalized to a slug and flagged, never dropped.
  let stage = STAGE_MAP[b.stage_name];
  let unmappedStage = false;
  if (!stage) {
    unmappedStage = true;
    stage = String(b.stage_name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown';
  }

  const rec = await resolveDealEntity(b, deps);
  if (rec.error) return { status: 502, body: { ok: false, ...rec, sf_opp_id: b.sf_opp_id } };

  // Owner: map SF user -> lcc_users.salesforce_owner_id (graceful if unmapped).
  let owner_user_id = null;
  if (b.owner_sf_user_id) {
    const u = await opsQuery('GET',
      `lcc_users?salesforce_owner_id=eq.${enc(b.owner_sf_user_id)}&select=lcc_user_id&limit=1`);
    owner_user_id = u.data?.[0]?.lcc_user_id || null;
  }

  // Vertical: use what the flow sent, else inherit the resolved entity's domain.
  let vertical = b.vertical || null;
  if (!vertical && rec.entity_id) {
    const e = await opsQuery('GET', `entities?id=eq.${enc(rec.entity_id)}&select=domain&limit=1`);
    vertical = e.data?.[0]?.domain || null;
  }

  // is_open is GENERATED = (closed_at IS NULL). 'Closed' (mapped) = won; lost/terminated = closed-lost.
  const isLost = /(lost|dead|dropped|withdrawn|terminat|cancel|expired|no[ _-]?sale)/i.test(String(b.stage_name));
  const isWon = !isLost && (stage === 'closed' || /(closed|sold|won|settled)/i.test(String(b.stage_name)));
  const isClosed = isWon || isLost;
  const meta = {};
  if (b.owner_sf_user_id && !owner_user_id) meta.owner_sf_user_id = b.owner_sf_user_id;
  if (unmappedStage) { meta.unmapped_stage = true; meta.sf_stage_label = b.stage_name; }
  if (rec.ambiguous) meta.ambiguous_resolution = true;
  const row = {
    workspace_id: WORKSPACE_ID, entity_id: rec.entity_id, sf_opp_id: b.sf_opp_id,
    deal_name: b.name || null,   // A4: keep the SF Opportunity Name on the backbone (was parsed then discarded)
    property_address: b.property_address || null,   // A5b: store the property address for reconcile + matching
    stage,
    amount: (b.amount ?? null), expected_close_date: (b.close_date || null),
    closed_at: isClosed ? new Date().toISOString() : null,
    closed_won: isClosed ? isWon : null,
    owner_user_id, vertical, last_synced_at: new Date().toISOString(),
    metadata: meta,
  };
  const up = await opsQuery('POST',
    'bd_opportunities?on_conflict=workspace_id,sf_opp_id', row,
    'resolution=merge-duplicates,return=representation');   // prefer must be a STRING (see govQuery/comps upserts)
  if (up.ok === false) return { status: 502, body: { ok: false, error: 'upsert_failed', detail: up.data, sf_opp_id: b.sf_opp_id } };
  const saved = Array.isArray(up.data) ? up.data[0] : up.data;

  return { status: 200, body: {
    ok: true, entity_id: rec.entity_id, created_entity: rec.created,
    bd_opportunity_id: saved?.id || null, stage, unmapped_stage: unmappedStage,
    ambiguous_resolution: !!rec.ambiguous, closed: isClosed, regime: stageRegime(stage),
    needs_psa_timeline: CONTRACTUAL.has(stage), sf_opp_id: b.sf_opp_id,
  } };
}

export function makeOpportunitySyncRoute({ opsQuery, enc, WORKSPACE_ID }) {
  const deps = { opsQuery, enc, WORKSPACE_ID };
  return {
    // Single deal — used by Copilot / manual calls.
    ingest: async (req, res) => {
      try {
        const r = await processDeal(req.body || {}, deps);
        return res.status(r.status).json(r.body);
      } catch (e) {
        return res.status(500).json({ ok: false, error: String(e?.message || e) });
      }
    },

    // Batch — Power Automate posts the whole Get-records array in ONE call; the engine
    // loops server-side with bounded concurrency and per-deal timeouts, so no single
    // record can stall the run (the failure mode of the PA Apply-to-each loop).
    ingestBatch: async (req, res) => {
      const body = req.body || {};
      const deals = Array.isArray(body) ? body : (body.deals || body.value || []);
      if (!Array.isArray(deals)) {
        return res.status(400).json({ ok: false, error: 'expected { deals: [ ... ] }' });
      }
      const summary = {
        total: deals.length, succeeded: 0, created: 0, resolved: 0,
        ambiguous: 0, closed: 0, unmapped_stage: 0, failed: 0, errors: [],
      };
      const CONC = 8;
      let i = 0;
      async function worker() {
        while (i < deals.length) {
          const d = deals[i++];
          try {
            const r = await withTimeout(processDeal(d, deps), 20000, 'processDeal');
            if (r.status === 200 && r.body.ok) {
              summary.succeeded++;
              if (r.body.created_entity) summary.created++; else summary.resolved++;
              if (r.body.ambiguous_resolution) summary.ambiguous++;
              if (r.body.closed) summary.closed++;
              if (r.body.unmapped_stage) summary.unmapped_stage++;
            } else {
              summary.failed++;
              if (summary.errors.length < 50) {
                summary.errors.push({ sf_opp_id: r.body.sf_opp_id ?? (d && (d.Id || d.sf_opp_id)) ?? null, status: r.status, error: r.body.error || 'unknown' });
              }
            }
          } catch (e) {
            summary.failed++;
            if (summary.errors.length < 50) {
              summary.errors.push({ sf_opp_id: (d && (d.Id || d.sf_opp_id)) ?? null, error: String(e?.message || e) });
            }
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONC, deals.length) }, worker));
      return res.status(200).json({ ok: true, ...summary });
    },
  };
}
