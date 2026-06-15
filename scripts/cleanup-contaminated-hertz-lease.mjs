#!/usr/bin/env node
// ============================================================================
// scripts/cleanup-contaminated-hertz-lease.mjs
//
// GATED, DRY-RUN-FIRST cleanup of the ONE contaminated lease surfaced by the
// at-scale gate on the Stage B lease BACKFILL (PR #1193, 2026-06-15).
//
// THE FINDING (exact receipts — these are the only targets this script touches):
//   • dia  leases.lease_id = 25312, property_id = 40041
//       tenant    = 'THE HERTZ CORPORATION'        ← CORRECT for the doc
//       guarantor = 'Total Renal Care, Inc.'       ← CONTAMINATION (DaVita's
//                   operating entity bled from the "DaVita Anchored" deal folder
//                   onto a Hertz car-rental lease).
//   • LCC Opps  entity_relationships: a guaranteed_by edge from the canonical
//       DaVita operator entity → the asset entity for dia property 40041, built
//       off the contaminated guarantor. MUST be removed.
//   • LCC Opps  field_provenance: source='folder_feed_lease',
//       target_table='dia.leases', record_pk_value='25312', field_name='guarantor'
//       — the contaminated provenance row. Superseded (never hard-deleted).
//
// SURGICAL, NOT DESTRUCTIVE (option A — recommended). The Hertz tenant / rent /
// dates are REAL and stay; ONLY the contaminated guarantor + the edge built from
// it are removed. Every write is idempotent + guarded on the contaminated state,
// so a re-run after --apply is a no-op. Nothing is hard-deleted except the single
// contaminated graph edge (an edge is a relationship, not a curated row; removing
// it is the correct reversal of a bad inference — the guarantor scrub + the
// superseded provenance row are the audit trail).
//
// UNIT 3 (optional, --sweep): flag dia property 40041 (a whole_center_multitenant
// unit mis-ingested into the single-tenant book) into the FROZEN mis-ingestion
// sweep candidate set (public._sweep_candidates_2026_06_11) for the
// exclude_from_market_metrics review — provenance-tagged, never hard-deleted.
// This is a candidate INSERT (review queue), NOT the exclusion itself (that
// remains Scott-gated per the sweep's §7).
//
// Usage:
//   node scripts/cleanup-contaminated-hertz-lease.mjs                 # dry-run JSON, 0 writes
//   node scripts/cleanup-contaminated-hertz-lease.mjs --apply         # Unit 2 surgical scrub
//   node scripts/cleanup-contaminated-hertz-lease.mjs --apply --sweep # + Unit 3 sweep candidate
//
// Env (Scott's workstation): DIA_SUPABASE_URL + DIA_SUPABASE_SERVICE_KEY (or
// DIA_SUPABASE_KEY), OPS_SUPABASE_URL + OPS_SUPABASE_KEY.
// ============================================================================

import { loadEnvForScripts } from './_env-file.mjs';

const env = loadEnvForScripts();
const APPLY = process.argv.includes('--apply');
const SWEEP = process.argv.includes('--sweep');

const LEASE_ID = 25312;
const PROPERTY_ID = 40041;
const CONTAMINATED_GUARANTOR = 'Total Renal Care, Inc.';
const EXPECTED_TENANT = 'THE HERTZ CORPORATION';

const DIA_URL = env.DIA_SUPABASE_URL;
const DIA_KEY = env.DIA_SUPABASE_SERVICE_KEY || env.DIA_SUPABASE_KEY;
const OPS_URL = env.OPS_SUPABASE_URL;
const OPS_KEY = env.OPS_SUPABASE_KEY;
if (!DIA_URL || !DIA_KEY) { console.error('Missing DIA creds (DIA_SUPABASE_URL / DIA_SUPABASE_SERVICE_KEY)'); process.exit(1); }
if (!OPS_URL || !OPS_KEY) { console.error('Missing OPS creds (OPS_SUPABASE_URL / OPS_SUPABASE_KEY)'); process.exit(1); }

function client(baseUrl, key) {
  return async (method, path, body, extraHeaders = {}) => {
    const res = await fetch(`${baseUrl}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
        Prefer: 'return=representation', ...extraHeaders,
      },
      body: body == null ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { ok: res.ok, status: res.status, data };
  };
}
const dia = client(DIA_URL, DIA_KEY);
const ops = client(OPS_URL, OPS_KEY);

async function main() {
  const out = { mode: APPLY ? 'apply' : 'dry_run', sweep: SWEEP, unit2: {}, unit3: {} };

  // ── Receipts: read the current state (read-only) ──────────────────────────
  const leaseRes = await dia('GET',
    `leases?lease_id=eq.${LEASE_ID}&select=lease_id,property_id,tenant,guarantor,annual_rent,leased_area,rent_per_sf,expense_structure,lease_start,lease_expiration,renewal_options,data_source`);
  const lease = leaseRes.data?.[0] || null;
  out.unit2.lease = lease;

  // Resolve the asset entity for dia property 40041 (canonical identity).
  const idRes = await ops('GET',
    `external_identities?source_system=eq.dia&source_type=eq.asset&external_id=eq.${PROPERTY_ID}&select=entity_id`);
  const assetEntityId = idRes.data?.[0]?.entity_id || null;
  out.unit2.asset_entity_id = assetEntityId;

  // The contaminated guaranteed_by edge(s) to that asset, tagged folder_feed_lease.
  let edges = [];
  if (assetEntityId) {
    const edgeRes = await ops('GET',
      `entity_relationships?to_entity_id=eq.${assetEntityId}&relationship_type=eq.guaranteed_by` +
      `&select=id,from_entity_id,to_entity_id,relationship_type,metadata`);
    edges = (edgeRes.data || []).filter(e => (e.metadata?.source || '') === 'folder_feed_lease');
  }
  out.unit2.guaranteed_by_edges = edges;

  // The contaminated field_provenance guarantor row(s).
  const provRes = await ops('GET',
    `field_provenance?target_database=eq.dia_db&target_table=eq.dia.leases&record_pk_value=eq.${LEASE_ID}` +
    `&field_name=eq.guarantor&source=eq.folder_feed_lease&select=id,decision,value,recorded_at&order=recorded_at.desc`);
  const provRows = provRes.data || [];
  out.unit2.field_provenance_rows = provRows;

  // ── Guards: only act on the EXACT contaminated state ──────────────────────
  const guarantorContaminated = lease && String(lease.guarantor || '') === CONTAMINATED_GUARANTOR;
  const tenantAsExpected = lease && String(lease.tenant || '') === EXPECTED_TENANT;
  out.unit2.guards = {
    lease_present: !!lease,
    tenant_as_expected: tenantAsExpected,
    guarantor_contaminated: guarantorContaminated,
    edges_to_remove: edges.length,
    provenance_rows_to_supersede: provRows.filter(p => p.decision !== 'superseded').length,
  };

  if (!lease) { out.unit2.note = 'lease 25312 not found — nothing to do (already reverted or wrong DB)'; }
  else if (!guarantorContaminated) { out.unit2.note = `guarantor is "${lease.guarantor}" — not the contaminated value; surgical scrub is a no-op (idempotent)`; }
  else if (!tenantAsExpected) { out.unit2.note = `tenant "${lease.tenant}" ≠ "${EXPECTED_TENANT}" — REFUSING to scrub (state does not match the receipts; investigate)`; }

  // ── Plan (always printed) ─────────────────────────────────────────────────
  out.unit2.plan = guarantorContaminated && tenantAsExpected ? [
    `dia: UPDATE leases SET guarantor=NULL WHERE lease_id=${LEASE_ID} (keep tenant/rent/dates)`,
    `LCC Opps: DELETE ${edges.length} guaranteed_by edge(s) to asset ${assetEntityId} tagged folder_feed_lease`,
    `LCC Opps: supersede ${provRows.filter(p => p.decision !== 'superseded').length} field_provenance guarantor row(s) for record ${LEASE_ID}`,
  ] : [];

  // ── Apply (Unit 2) — guarded + idempotent ─────────────────────────────────
  if (APPLY && guarantorContaminated && tenantAsExpected) {
    const r1 = await dia('PATCH', `leases?lease_id=eq.${LEASE_ID}&guarantor=eq.${encodeURIComponent(CONTAMINATED_GUARANTOR)}`,
      { guarantor: null });
    out.unit2.applied_lease_scrub = { ok: r1.ok, status: r1.status, rows: Array.isArray(r1.data) ? r1.data.length : null };

    out.unit2.applied_edges_removed = [];
    for (const e of edges) {
      const rd = await ops('DELETE', `entity_relationships?id=eq.${e.id}`);
      out.unit2.applied_edges_removed.push({ id: e.id, ok: rd.ok, status: rd.status });
    }

    out.unit2.applied_provenance_superseded = [];
    for (const p of provRows.filter(x => x.decision !== 'superseded')) {
      const rp = await ops('PATCH', `field_provenance?id=eq.${p.id}`, {
        decision: 'superseded',
        decision_reason: 'multitenant cross-attribution: Hertz lease guarantor bled from DaVita-Anchored deal folder; scrubbed 2026-06-15',
      });
      out.unit2.applied_provenance_superseded.push({ id: p.id, ok: rp.ok, status: rp.status });
    }
  }

  // ── Unit 3 — flag property 40041 into the frozen sweep candidate set ───────
  // Read-only by default; only inserts the candidate row on --apply --sweep.
  const salesRes = await dia('GET',
    `sales_transactions?property_id=eq.${PROPERTY_ID}&select=sale_id,sale_date,sold_price,exclude_from_market_metrics,data_source`);
  out.unit3.sales = salesRes.data || [];
  out.unit3.note = 'property 40041 = "DaVita-Anchored Center - Springfield - IL" (whole_center_multitenant unit in the dia single-tenant book). Flag its sale(s) into the frozen sweep candidate set for exclude_from_market_metrics REVIEW — never the exclusion itself (that stays Scott-gated per the sweep §7).';

  if (APPLY && SWEEP) {
    // Append candidate rows to the frozen review table IF it exists. The exclusion
    // itself is applied by the sweep's gated remediation, not here.
    out.unit3.candidate_inserts = [];
    for (const s of (salesRes.data || [])) {
      const ins = await dia('POST', '_sweep_candidates_2026_06_11', {
        sale_id: s.sale_id, property_id: PROPERTY_ID,
        proposed_class: 'whole_center_multitenant',
        review_notes: 'added 2026-06-15 by lease-contamination guard: Hertz co-tenant in /Multi/DaVita Anchored - Springfield, IL; whole_center_multitenant unit mis-ingested into the dia single-tenant book',
      }, { Prefer: 'return=minimal,resolution=ignore-duplicates' }).catch((e) => ({ ok: false, status: e?.message }));
      out.unit3.candidate_inserts.push({ sale_id: s.sale_id, ok: ins.ok, status: ins.status });
    }
    if (!out.unit3.candidate_inserts.some(c => c.ok)) {
      out.unit3.candidate_note = 'no candidate rows inserted — the _sweep_candidates_2026_06_11 table may not be materialized in this dia DB yet; see audit/mis-ingestion-sweep-2026-06-11/candidates_dia_augment_40041.sql';
    }
  }

  console.log(JSON.stringify(out, null, 2));
  if (!APPLY) console.log('\nDRY RUN — 0 writes. Re-run with --apply (Unit 2) and optionally --sweep (Unit 3) after the gate.');
}

main().catch(err => { console.error('FATAL', err); process.exit(1); });
