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

// SF-BRIDGE1 (2026-09-23) — bd_opportunities.type for a Salesforce-synced deal.
// Before this, the sync never wrote `type`, so all 610 SF deals read NULL and
// every LCC surface that asks "is there a deal here?" (they all key on
// type='prospect' / 'government_buyer') saw nothing — the property panel
// offered "Create the lead" on our own listings.
//
// The record type alone does not say which side we are on: every staged deal
// is `IS CM` (Investment Sales – Capital Markets) or `D&E`. So the type is
// derived from what IS stated, most specific first:
//   buy_side — the record type / deal type literally says buy side
//   bov      — SF stage BOV
//   listing  — a listing stage (Listing Signed / Off-Market / ELA), OR a
//              Salesforce Listing__c exists for this Opportunity (sell side,
//              carried through escrow and close)
//   sf_deal  — a Salesforce deal whose side is not stated. Honest, not a guess.
// Never 'prospect' / 'government_buyer': those are LCC-owned lanes and the
// upsert RPC refuses to overwrite them.
export const SF_DEAL_TYPES = Object.freeze(['listing', 'bov', 'buy_side', 'sf_deal']);
const LISTING_STAGES = new Set(['listing_signed', 'off_market_listing', 'ela']);
export function deriveDealType({ stage, recordType, hasListing } = {}) {
  if (/buy[\s_-]*side/i.test(String(recordType || ''))) return 'buy_side';
  if (stage === 'bov') return 'bov';
  if (LISTING_STAGES.has(stage)) return 'listing';
  if (hasListing === true) return 'listing';
  return 'sf_deal';
}

// SF-BRIDGE1 — the Salesforce property address. The PA flow's payload has never
// carried Property2__r (0 of 610 deals had an address), but the Salesforce
// staging tables on the domain DBs (sf_deal_staging, written by the
// intake-salesforce edge function) DO hold the Opportunity's property address,
// record type and the linked Listing__c. `lookupStagedDeals(ids)` (injected)
// returns Map<sf_opp_id, {property_address, deal_type, has_listing, source}>.
// Precedence: the payload's own address > the staged one > (the RPC keeps the
// stored value, fill-forward). A deal that is in neither stays NULL — never
// invented from the deal name.
export async function loadStagedDeals(lookupStagedDeals, ids) {
  if (typeof lookupStagedDeals !== 'function' || !ids.length) return new Map();
  try {
    const m = await lookupStagedDeals(ids);
    return m instanceof Map ? m : new Map();
  } catch (_e) {
    return new Map();   // enrichment only; the sync must never fail on it
  }
}

// Shared by server.js (api/_shared/domain-db.js domainQuery) and mcp/server.js
// (its own dia/gov clients): reads BOTH domains' staging, chunked, latest row
// per sf_deal_id. `query(domain, path)` → { ok, data }.
export async function lookupStagedDealsVia(query, ids) {
  const out = new Map();
  const uniq = [...new Set(ids.filter(Boolean).map(String))];
  for (const domain of ['dialysis', 'government']) {
    for (let i = 0; i < uniq.length; i += 100) {
      const inList = uniq.slice(i, i + 100).map((x) => encodeURIComponent(x)).join(',');
      const d = await query(domain,
        `sf_deal_staging?sf_deal_id=in.(${inList})&select=sf_deal_id,deal_type,property_address,imported_at&order=imported_at.desc`);
      const l = await query(domain,
        `sf_listing_staging?sf_deal_id=in.(${inList})&select=sf_deal_id`);
      const listed = new Set((l?.ok && Array.isArray(l.data) ? l.data : []).map((r) => r.sf_deal_id));
      for (const r of (d?.ok && Array.isArray(d.data) ? d.data : [])) {
        const prev = out.get(r.sf_deal_id);
        if (prev && prev.property_address) continue;     // latest-with-address wins
        out.set(r.sf_deal_id, {
          property_address: (r.property_address && String(r.property_address).trim()) || prev?.property_address || null,
          deal_type: r.deal_type || prev?.deal_type || null,
          has_listing: listed.has(r.sf_deal_id) || !!prev?.has_listing,
          source: domain === 'dialysis' ? 'dia.sf_deal_staging' : 'gov.sf_deal_staging',
        });
      }
      for (const id of listed) {
        if (!out.has(id)) out.set(id, { property_address: null, deal_type: null, has_listing: true, source: null });
        else out.get(id).has_listing = true;
      }
    }
  }
  return out;
}

// A5b: the property address lives on the related Property object (Opportunity.Property2__c lookup); the
// Property_Address__c formula that concatenates it is FLS-hidden from the integration user, so we pull the
// source relationship fields (Property2__r.Street__c / City__c / State_Province__c / Zip_Code__c) instead.
// PA returns parent-relationship fields nested (record.Property2__r.Street__c); tolerate flattened keys too.
function dealAddress(d) {
  if (d.property_address) return d.property_address;
  if (d.Property_Address__c) return d.Property_Address__c;                 // if FLS is ever granted
  const p = d.Property2__r || {};
  const g = (k) => p[k] ?? d['Property2__r.' + k] ?? null;
  const street = g('Street__c'), city = g('City__c'), state = g('State_Province__c'), zip = g('Zip_Code__c');
  const line2 = [city, state].filter(Boolean).join(', ');
  const parts = [street, line2, zip].map(s => s && String(s).trim()).filter(Boolean);
  return parts.length ? parts.join(', ') : (d.Property_Address_Line_1__c ?? null);
}

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
    // SF-BRIDGE1: record type, if the flow ever sends it (RecordType.Name).
    record_type: d.record_type ?? d.RecordType?.Name ?? d['RecordType.Name'] ?? null,
    // A5b: address comes from the related Property object (see dealAddress) — FLS-safe.
    property_address: dealAddress(d),
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
  // SF-BRIDGE1: else the domain whose Salesforce staging holds the deal (the
  // intake-salesforce crawl files it per vertical). Never guessed from the name.
  const stagedDom = deps.stagedDeals instanceof Map ? deps.stagedDeals.get(b.sf_opp_id)?.source : null;
  if (!vertical && stagedDom) vertical = stagedDom.startsWith('dia.') ? 'dia' : stagedDom.startsWith('gov.') ? 'gov' : null;

  // is_open is GENERATED = (closed_at IS NULL). 'Closed' (mapped) = won; lost/terminated = closed-lost.
  const isLost = /(lost|dead|dropped|withdrawn|terminat|cancel|expired|no[ _-]?sale)/i.test(String(b.stage_name));
  const isWon = !isLost && (stage === 'closed' || /(closed|sold|won|settled)/i.test(String(b.stage_name)));
  const isClosed = isWon || isLost;
  const meta = {};
  // SF-BRIDGE1: staged Salesforce facts (address / record type / Listing__c).
  const staged = (deps.stagedDeals instanceof Map ? deps.stagedDeals.get(b.sf_opp_id) : null) || null;
  const recordType = b.record_type || staged?.deal_type || null;
  const type = deriveDealType({ stage, recordType, hasListing: staged?.has_listing === true });
  let propertyAddress = b.property_address || null;
  if (propertyAddress) meta.address_source = 'sf_payload';
  else if (staged?.property_address) { propertyAddress = staged.property_address; meta.address_source = staged.source; }
  if (recordType) meta.sf_record_type = recordType;
  if (b.owner_sf_user_id && !owner_user_id) meta.owner_sf_user_id = b.owner_sf_user_id;
  if (unmappedStage) { meta.unmapped_stage = true; meta.sf_stage_label = b.stage_name; }
  if (rec.ambiguous) meta.ambiguous_resolution = true;
  const row = {
    workspace_id: WORKSPACE_ID, entity_id: rec.entity_id, sf_opp_id: b.sf_opp_id,
    deal_name: b.name || null,   // A4: keep the SF Opportunity Name on the backbone (was parsed then discarded)
    property_address: propertyAddress,   // A5b + SF-BRIDGE1: payload, else SF staging; RPC keeps a stored one
    type,                                // SF-BRIDGE1: never NULL from this writer again
    stage,
    amount: (b.amount ?? null), expected_close_date: (b.close_date || null),
    closed_at: isClosed ? new Date().toISOString() : null,
    closed_won: isClosed ? isWon : null,
    owner_user_id, vertical, last_synced_at: new Date().toISOString(),
    metadata: meta,
  };
  // HP1-P1a-fix: this used to be a PostgREST upsert
  // (`bd_opportunities?on_conflict=...` + `Prefer: resolution=merge-duplicates`).
  // That Prefer header never took effect on the standalone MCP deploy — its
  // opsQuery(method, path, body, prefer) signature expects `prefer` as a
  // plain STRING, and was being handed an OBJECT, which undici's Headers
  // coerces to the literal "[object Object]". PostgREST cannot parse that as
  // a Prefer directive, so it silently fell back to a plain INSERT with no
  // ON CONFLICT handling — every re-sync of an already-seen sf_opp_id 502'd
  // on the unique key, and no stage/close ever propagated. Routed through an
  // RPC instead: one INSERT ... ON CONFLICT DO UPDATE, no header to mangle,
  // and an honest per-row inserted/updated/skipped outcome.
  const up = await opsQuery('POST', 'rpc/lcc_upsert_bd_opportunities', { p_deals: [row] });
  if (up.ok === false) return { status: 502, body: { ok: false, error: 'upsert_failed', detail: up.data, sf_opp_id: b.sf_opp_id } };
  const result = Array.isArray(up.data) ? up.data[0] : up.data;
  if (!result || result.outcome === 'skipped') {
    return { status: 502, body: { ok: false, error: 'upsert_skipped', detail: result?.reason || 'no_result_row', sf_opp_id: b.sf_opp_id } };
  }
  const saved = { id: result.bd_opportunity_id };

  return { status: 200, body: {
    ok: true, entity_id: rec.entity_id, created_entity: rec.created,
    bd_opportunity_id: saved?.id || null, stage, unmapped_stage: unmappedStage,
    ambiguous_resolution: !!rec.ambiguous, closed: isClosed, regime: stageRegime(stage),
    needs_psa_timeline: CONTRACTUAL.has(stage), sf_opp_id: b.sf_opp_id,
    type, address_source: meta.address_source || null,
    // HP1-P1d: the RPC's own write outcome (inserted/updated), read straight
    // through so ingestBatch can log a real facts_written delta to
    // producer_runs instead of the "succeeded" tally, which counts entity
    // resolution + write success together and is not itself the write delta.
    outcome: result.outcome,
  } };
}

// HP1-P1d — producer_runs lifecycle for this feed. `ingestBatch` runs the
// whole batch synchronously inside one request (unlike the tick-style
// producers, which open a row before a long-running background pass), so
// ONE row is written at the end carrying started_at/finished_at/duration
// together, rather than open-then-PATCH-by-run_id. This deliberately avoids
// re-reading the RPC's own OUT/`Prefer: return=representation` id back
// through opsQuery: that "read the id back" shape is exactly what the
// standalone MCP's positional opsQuery(method, path, body, prefer) mangled
// (P1a-fix's own root cause). Every opsQuery call in this file stays 3-arg.
const PRODUCER_SF_OPPORTUNITY_SYNC = 'sf_opportunity_sync';

async function logIngestRun(deps, { summary, allFailed, startedAt, finishedAt }) {
  const durationMs = finishedAt - startedAt;
  const status = summary.total === 0 ? 'skipped' : (allFailed ? 'failed' : 'completed');
  const payload = {
    producer: PRODUCER_SF_OPPORTUNITY_SYNC,
    lane: null,
    started_at: new Date(startedAt).toISOString(),
    finished_at: new Date(finishedAt).toISOString(),
    duration_ms: durationMs,
    status,
    skip_reason: summary.total === 0 ? 'empty_batch' : null,
    trigger_source: 'ingest',
    // The state delta the RPC itself reports (inserted+updated), never the
    // "succeeded" tally, which also counts entity-resolution work that made
    // no write (P159a: judge a worker by the delta, not its own tally).
    facts_written: (summary.inserted || 0) + (summary.updated || 0),
    facts_superseded: 0,
    facts_expired: 0,
    error_count: summary.failed || 0,
    detail: summary,
  };
  try {
    await deps.opsQuery('POST', 'producer_runs', payload);
  } catch (_e) {
    // Logging must never break the response the caller (Power Automate) reads.
  }
}

export function makeOpportunitySyncRoute({ opsQuery, enc, WORKSPACE_ID, lookupStagedDeals = null }) {
  const deps = { opsQuery, enc, WORKSPACE_ID };
  const idOf = (d) => d && (d.sf_opp_id ?? d.Id ?? d.id) || null;
  return {
    // Single deal — used by Copilot / manual calls.
    ingest: async (req, res) => {
      try {
        const stagedDeals = await loadStagedDeals(lookupStagedDeals, [idOf(req.body || {})].filter(Boolean));
        const r = await processDeal(req.body || {}, { ...deps, stagedDeals });
        return res.status(r.status).json(r.body);
      } catch (e) {
        return res.status(500).json({ ok: false, error: String(e?.message || e) });
      }
    },

    // Batch — Power Automate posts the whole Get-records array in ONE call; the engine
    // loops server-side with bounded concurrency and per-deal timeouts, so no single
    // record can stall the run (the failure mode of the PA Apply-to-each loop).
    ingestBatch: async (req, res) => {
      const startedAt = Date.now();
      const body = req.body || {};
      const deals = Array.isArray(body) ? body : (body.deals || body.value || []);
      if (!Array.isArray(deals)) {
        return res.status(400).json({ ok: false, error: 'expected { deals: [ ... ] }' });
      }
      const summary = {
        total: deals.length, succeeded: 0, created: 0, resolved: 0,
        ambiguous: 0, closed: 0, unmapped_stage: 0, failed: 0,
        // HP1-P1d: the RPC's own per-row write outcome, tallied separately
        // from `succeeded` (which also counts a row that resolved an entity
        // but made no DB write). This is what producer_runs.facts_written reads.
        inserted: 0, updated: 0, errors: [],
      };
      // SF-BRIDGE1: one bulk read of the staged SF facts for the whole batch.
      const stagedDeals = await loadStagedDeals(lookupStagedDeals, deals.map(idOf).filter(Boolean));
      summary.staged_matched = stagedDeals.size;
      summary.address_filled = 0;
      summary.by_type = {};
      const batchDeps = { ...deps, stagedDeals };
      const CONC = 8;
      let i = 0;
      async function worker() {
        while (i < deals.length) {
          const d = deals[i++];
          try {
            const r = await withTimeout(processDeal(d, batchDeps), 20000, 'processDeal');
            if (r.status === 200 && r.body.ok) {
              summary.succeeded++;
              if (r.body.created_entity) summary.created++; else summary.resolved++;
              if (r.body.ambiguous_resolution) summary.ambiguous++;
              if (r.body.closed) summary.closed++;
              if (r.body.unmapped_stage) summary.unmapped_stage++;
              if (r.body.address_source) summary.address_filled++;
              if (r.body.type) summary.by_type[r.body.type] = (summary.by_type[r.body.type] || 0) + 1;
              if (r.body.outcome === 'inserted') summary.inserted++;
              else if (r.body.outcome === 'updated') summary.updated++;
            } else {
              summary.failed++;
              if (summary.errors.length < 50) {
                // Unit 3: carry `detail` through, not just the label — `upsert_failed`
                // alone cost a whole diagnosis cycle that the PostgREST/DB detail
                // would have ended immediately.
                summary.errors.push({ sf_opp_id: r.body.sf_opp_id ?? (d && (d.Id || d.sf_opp_id)) ?? null, status: r.status, error: r.body.error || 'unknown', detail: r.body.detail ?? null });
              }
            }
          } catch (e) {
            summary.failed++;
            if (summary.errors.length < 50) {
              summary.errors.push({ sf_opp_id: (d && (d.Id || d.sf_opp_id)) ?? null, error: String(e?.message || e), detail: null });
            }
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONC, deals.length) }, worker));
      // Unit 3: a batch endpoint must not return 200 when it wrote nothing.
      // `ingestBatch` used to end here unconditionally, so 608/608 failures
      // still reported `{"ok":true,"total":608,"succeeded":0,...}` and Power
      // Automate read the 200 status code and marked the run Succeeded — that
      // is why six weeks of total failure was invisible from both ends. A
      // fully-failed batch is loud (502, ok:false); a partial one stays 200
      // but is flagged so `succeeded`/`failed` are never the only signal.
      const allFailed = summary.total > 0 && summary.failed === summary.total;
      const partial = summary.failed > 0 && summary.succeeded > 0;
      // HP1-P1d: log the run regardless of outcome (completed/failed/skipped)
      // so producer_runs carries an honest record of every batch this feed
      // ever ran — never awaited into the response path, so a logging hiccup
      // cannot turn a real sync into a 500 for Power Automate.
      logIngestRun(deps, { summary, allFailed, startedAt, finishedAt: Date.now() });
      return res.status(allFailed ? 502 : 200).json({ ok: !allFailed, partial, ...summary });
    },
  };
}
