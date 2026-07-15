// api/_handlers/owner-reconcile.js
// ============================================================================
// ORE Phase B — B1: the owner-reconcile worker (assemble + reconcile)
// ----------------------------------------------------------------------------
// Phase A lands the authoritative NAME + address layer (deeds, SOS-direct, GSA
// lessor, CoStar owner phone/email) into the DBs. Phase B is the RECONCILE step
// Scott does manually: for each owner, COMPARE the authoritative record against
// what the system already holds (Salesforce presence, a resolved control
// contact) and resolve each owner to ONE traceable source-of-truth state.
//
//   GET  → dry-run: assemble the value-ranked owner universe, classify each,
//          report the reconcile-state distribution + a sample. NO writes.
//   POST → drain: classify + UPSERT lcc_owner_reconcile (the traceable output),
//          bounded by `limit` + a wall-clock budget.
//
// B1 does NOT re-implement contact acquisition. It CLASSIFIES + RECORDS the
// reconcile decision (with a `sources` trace) and ROUTES each owner to the
// EXISTING engine — it is a router + recorder, not a new pipeline:
//   confirmed_connected  → nothing (SF + a human contact agree)
//   resolvable_contact   → owner-contact-enrich (attach the pivot-resolved person)
//   sf_no_contact        → contact-acquisition (pull the SF Account's contacts)
//   contact_ready_no_sf  → the B2 SF push (net-new owner to add to Salesforce)
//   needs_enrichment     → owner-contact-enrich (run the SOS/address/deed action)
//   unresolvable         → surfaced, never guessed
//
// Conflicts between an authoritative source and a curated field are NOT
// re-litigated here — they ride the field_provenance ladder + the Decision-
// Center resolve_ownership / owner_source_conflict lanes. Reversible: drop
// lcc_owner_reconcile → zero trace. LCC-Opps only; no dia/gov writes.
// ============================================================================

import { authenticate } from '../_shared/auth.js';
import { opsQuery, pgFilterVal } from '../_shared/ops-db.js';
import { routeFromArchetype } from '../_shared/institution-registry.js';

const WALL_CLOCK_MS = 20000;

// Which existing engine consumes each reconcile state (for the record + the
// operator surface). A state with no downstream engine is a terminal record.
// ORE Tier A (Unit 4): the enrichment tail (needs_enrichment / unresolvable) is
// no longer a null/generic residual — it is routed by OWNER ARCHETYPE:
//   institutional + registry contact → institution_registry (attach the sponsor
//                                       contact; fans out — the highest lever)
//   institutional + no contact        → resolve_parent_then_registry (add ONE
//                                       contact for the sponsor → resolves many)
//   local (terminal owner)            → fetch_public_records (SOS/deed/address)
export const RECONCILE_ROUTES = {
  confirmed_connected: null,
  resolvable_contact: 'owner_contact_enrich',
  sf_no_contact: 'contact_acquisition',
  contact_ready_no_sf: 'sf_push_b2',
  needs_enrichment: 'owner_contact_enrich',
  unresolvable: null,
};

// The enrichment-tail states whose route is decided by owner archetype (Unit 4).
const ARCHETYPE_ROUTED_STATES = new Set(['needs_enrichment', 'unresolvable']);

/**
 * Classify ONE owner's reconcile state from the assembled compare-signals, and
 * build the ids-only `sources` trace. Pure — no I/O. This is the reconcile
 * comparison Scott does manually: SF presence vs a resolved human contact.
 *
 * @param row row from v_lcc_owner_reconcile_candidates
 * @returns {{entity_id, reconcile_state, authoritative_name, control_contact_entity_id,
 *   control_contact_name, control_contact_source, sf_account_id, has_person_contact,
 *   rank_value, workspace_id, routed_to, sources}}
 */
export function reconcileOwnerRow(row) {
  const hasSf = !!row.sf_account_id;
  const hasContact = !!row.has_person_contact;
  // A pivot-resolved control contact that is a real NAMED person but NOT yet
  // attached (no active_contact_entity_id) is "resolvable": the CONTACT-SELECTION
  // hypothesis exists, the attach hasn't run. When it IS attached
  // (active_contact_entity_id set), has_person_contact is already true.
  const pivotName = (typeof row.active_contact_name === 'string') ? row.active_contact_name.trim() : '';
  const pivotAttached = !!row.active_contact_entity_id;
  const pivotResolvedName = !!pivotName && !pivotAttached;
  // enrichment_action that routes to an automated/manual lookup engine
  const enrich = (typeof row.enrichment_action === 'string') ? row.enrichment_action.trim() : '';
  const hasEnrichmentPath = !!enrich && enrich !== 'manual_research';

  let state;
  if (hasSf && hasContact) {
    state = 'confirmed_connected';
  } else if (hasContact && !hasSf) {
    // We hold a human contact; Salesforce doesn't have the Account. Net-new
    // owner to push to SF (the ~100% goal — B2).
    state = 'contact_ready_no_sf';
  } else if (hasSf && !hasContact) {
    // Salesforce has the Account but no human is pulled into LCC. Pull its
    // contacts (contact-acquisition, R16).
    state = 'sf_no_contact';
  } else if (pivotResolvedName) {
    // No attached contact + no SF, but the pivot resolved a named control
    // contact — attach it (owner-contact-enrich).
    state = 'resolvable_contact';
  } else if (hasEnrichmentPath) {
    state = 'needs_enrichment';
  } else {
    state = 'unresolvable';
  }

  const control_contact_entity_id = pivotAttached ? row.active_contact_entity_id : null;
  const control_contact_name = pivotName || null;
  const control_contact_source = control_contact_entity_id ? 'pivot'
    : (pivotResolvedName ? 'pivot_unattached' : null);

  // ORE Tier A (Unit 4) — archetype-aware routing of the enrichment tail.
  // owner_archetype ('institutional' | 'local') + has_institution_contact are
  // overlaid onto the row by the worker (from v_owner_archetype). When present
  // and the state is an enrichment-tail state, the route is the directed
  // archetype route (institution_registry / resolve_parent_then_registry /
  // fetch_public_records) instead of the generic owner_contact_enrich / null.
  const archetype = (typeof row.owner_archetype === 'string') ? row.owner_archetype : null;
  let routed_to = RECONCILE_ROUTES[state] || null;
  if (archetype && ARCHETYPE_ROUTED_STATES.has(state)) {
    routed_to = routeFromArchetype(archetype, !!row.has_institution_contact);
  }

  const sources = {
    sf_account: hasSf ? { id: row.sf_account_id, n_accounts: row.n_sf_accounts || 1 } : null,
    person_contact: hasContact,
    pivot: (pivotAttached || pivotResolvedName)
      ? { name: control_contact_name, role: row.active_contact_role || null,
          authority: row.active_authority_level != null ? Number(row.active_authority_level) : null,
          attached: pivotAttached, source: row.pivot_source || null }
      : null,
    entity_contact: {
      email: !!row.entity_has_email, phone: !!row.entity_has_phone, address: !!row.entity_has_address,
    },
    has_reg_address: !!row.has_reg_address,
    enrichment_action: enrich || null,
    owner_archetype: archetype,
    sponsor_institution: row.sponsor_institution || null,
    has_institution_contact: archetype ? !!row.has_institution_contact : null,
  };

  return {
    entity_id: row.entity_id,
    reconcile_state: state,
    authoritative_name: row.owner_name || null,
    control_contact_entity_id,
    control_contact_name,
    control_contact_source,
    sf_account_id: row.sf_account_id || null,
    has_person_contact: hasContact,
    rank_value: row.rank_value != null ? Number(row.rank_value) : null,
    workspace_id: row.workspace_id || null,
    routed_to,
    sources,
  };
}

// Columns pulled from the candidate view (kept lean).
const CANDIDATE_COLS = 'entity_id,owner_name,workspace_id,rank_value,property_count,'
  + 'primary_domain,is_cross_vertical,sf_account_id,n_sf_accounts,has_person_contact,'
  + 'active_contact_entity_id,active_contact_name,active_contact_role,active_authority_level,'
  + 'pivot_source,pivot_confidence,enrichment_action,entity_has_email,entity_has_phone,'
  + 'entity_has_address,has_reg_address';

/**
 * Overlay `owner_archetype` / `sponsor_institution` / `has_institution_contact`
 * onto the loaded candidate rows (from v_owner_archetype, keyed by entity_id) so
 * reconcileOwnerRow can route the enrichment tail by archetype (Unit 4).
 * Best-effort + in-place — a failed fetch leaves the rows unchanged (pre-Tier-A
 * generic routing). Batched by entity_id to keep it one query per tick.
 */
async function overlayArchetype(rows) {
  if (!Array.isArray(rows) || !rows.length) return;
  const ids = rows.map((x) => x.entity_id).filter(Boolean);
  if (!ids.length) return;
  const inList = ids.map((id) => pgFilterVal(id)).join(',');
  const q = 'v_owner_archetype?select=entity_id,owner_archetype,sponsor_institution,has_registry_contact'
    + '&entity_id=in.(' + inList + ')';
  let ar;
  try { ar = await opsQuery('GET', q); } catch (_e) { return; }
  if (!ar || !ar.ok || !Array.isArray(ar.data)) return;
  const byId = new Map();
  for (const a of ar.data) byId.set(a.entity_id, a);
  for (const row of rows) {
    const a = byId.get(row.entity_id);
    if (!a) continue;
    row.owner_archetype = a.owner_archetype || null;
    row.sponsor_institution = a.sponsor_institution || null;
    row.has_institution_contact = !!a.has_registry_contact;
  }
}

/**
 * Upsert one reconcile record. Effect-first / outcome-truthful — a failed write
 * is reported, never silently swallowed.
 */
async function recordReconcile(rec) {
  const row = {
    entity_id: rec.entity_id,
    reconcile_state: rec.reconcile_state,
    authoritative_name: rec.authoritative_name,
    control_contact_entity_id: rec.control_contact_entity_id,
    control_contact_name: rec.control_contact_name,
    control_contact_source: rec.control_contact_source,
    sf_account_id: rec.sf_account_id,
    has_person_contact: rec.has_person_contact,
    rank_value: rec.rank_value,
    sources: rec.sources,
    routed_to: rec.routed_to,
    workspace_id: rec.workspace_id,
    reconciled_at: new Date().toISOString(),
  };
  // PostgREST upsert on the PK.
  const res = await opsQuery('POST', 'lcc_owner_reconcile', row,
    { headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
  return { ok: !!res.ok, detail: res.ok ? undefined : res.data };
}

export async function handleOwnerReconcileTick(req, res) {
  // Same internal-auth contract as the sibling tick workers (authenticate sends
  // its own 401 and returns null on failure).
  const user = await authenticate(req, res);
  if (!user) return;

  const dryRun = req.method === 'GET';
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
  const minValue = req.query.min_value != null ? Number(req.query.min_value) : 0;

  let sel = 'v_lcc_owner_reconcile_candidates?select=' + CANDIDATE_COLS;
  if (minValue > 0) sel += '&rank_value=gte.' + minValue;
  sel += '&order=rank_value.desc.nullslast&limit=' + limit;

  const r = await opsQuery('GET', sel);
  if (!r.ok) return res.status(r.status || 500).json({ error: 'load_failed', detail: r.data });
  const rows = Array.isArray(r.data) ? r.data : [];

  // ORE Tier A (Unit 4) — overlay owner archetype so the enrichment tail routes
  // by institutional-vs-local (v_owner_archetype, keyed by entity_id). Best-effort
  // overlay (the enrich worker's pivot-overlay pattern); a failed/absent overlay
  // leaves the pre-Tier-A generic routing (deploy-order-safe, no cycle).
  await overlayArchetype(rows);

  const byState = {};
  const routed = {};
  const sample = [];
  for (const row of rows) {
    const rec = reconcileOwnerRow(row);
    byState[rec.reconcile_state] = (byState[rec.reconcile_state] || 0) + 1;
    if (rec.routed_to) routed[rec.routed_to] = (routed[rec.routed_to] || 0) + 1;
    if (sample.length < 20) {
      sample.push({
        owner: rec.authoritative_name,
        rank_value: rec.rank_value != null ? Math.round(rec.rank_value) : null,
        state: rec.reconcile_state,
        routed_to: rec.routed_to,
        control_contact: rec.control_contact_name || null,
        sf_account: rec.sf_account_id || null,
      });
    }
  }

  if (dryRun) {
    return res.status(200).json({ ok: true, dry_run: true, candidates: rows.length,
      by_state: byState, routed_to: routed, sample, min_value: minValue });
  }

  // POST → record the reconcile output (bounded by the wall-clock budget).
  const started = Date.now();
  const summary = { processed: 0, recorded: 0, failed: 0, by_state: byState, routed_to: routed };
  for (const row of rows) {
    if (Date.now() - started > WALL_CLOCK_MS) break;
    const rec = reconcileOwnerRow(row);
    const w = await recordReconcile(rec);
    summary.processed += 1;
    if (w.ok) summary.recorded += 1; else summary.failed += 1;
  }
  return res.status(200).json({ ok: true, ...summary });
}
