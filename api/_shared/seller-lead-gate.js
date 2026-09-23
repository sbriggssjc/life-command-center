// ============================================================================
// api/_shared/seller-lead-gate.js — GOV-UX1-D5-gate (2026-09-23)
//
// THE ONE DEFINITION of "this owner should become a seller lead". The review
// lane (GET /api/seller-lead-gate) and the auto-create tick
// (/api/seller-lead-autocreate-tick) both call evaluateSellerLeadGate() over
// v_lcc_seller_lead_gate_candidates, so the two cannot disagree about who
// qualifies.
//
// The SQL view carries each condition as a column and decides nothing; this
// module combines them and adds the owner-name guards that have no SQL twin.
// Every guard here is REUSED — no new regex list:
//   * isJunkEntityName        (entity-link.js)   — phone/email/contacts bleed,
//                                                   placeholders, prospect junk
//   * isAddressAsName         (junk-prescreen.js) — "4238 Washington Street"
//   * isOwnerNameRestated     (entity-link.js)   — P164: the "person" is the
//                                                   owner's own firm name restated
//   * lcc_owner_name_is_junk  (SQL, via the view's owner_name_sql_junk)
//   * lcc_is_seller_lead_decision_role (SQL) — the P161 rule, stricter: no
//     works_at / associated_with / contact / parent_of / broker-ish role counts
//   * lcc_resolve_buyer_parent (SQL) — the same test bridgeCreateLead refuses on
//   * lcc_cadence_point_person (SQL) — the lead owner for an unattended write
//
// Pure: no I/O in the gate or eligibility functions (the loaders take opsQuery
// as a dependency so tests can stub it).
// ============================================================================

import { isJunkEntityName, isOwnerNameRestated } from './entity-link.js';
import { isAddressAsName } from './junk-prescreen.js';

/** Feature flag that switches auto-create on (default OFF in feature_flags_registry). */
export const SELLER_LEAD_AUTOCREATE_FLAG = 'SELLER_LEAD_AUTOCREATE';

/** The lead_source / metadata tag every auto-created lead carries. */
export const SELLER_LEAD_AUTOCREATE_SOURCE = 'seller_lead_autocreate';
/** The lead_source a lane "Create lead" carries (distinct, so the two are listable apart). */
export const SELLER_LEAD_LANE_SOURCE = 'seller_lead_gate';

/**
 * The "Not a lead" picklist. MIRRORS chk_seller_lead_reject_reason in
 * supabase/migrations/20261102260000_lcc_gov_ux1_d5_gate_seller_lead_review_lane.sql
 * (test/gov-ux1-d5-gate.test.mjs compares the two lists).
 */
export const SELLER_LEAD_REJECT_REASONS = [
  { key: 'not_a_seller', label: 'Not a seller' },
  { key: 'bank_or_lender', label: 'Bank / lender' },
  { key: 'tenant_or_operator', label: 'Tenant / operator, not the landlord' },
  { key: 'repeat_buyer_or_reit', label: 'Repeat buyer / REIT' },
  { key: 'wrong_or_weak_contact', label: 'Wrong or weak contact' },
  { key: 'address_or_junk_name', label: 'Address or junk name' },
  { key: 'already_working_it', label: 'Already working it' },
  { key: 'other', label: 'Other' },
];
const REJECT_KEYS = new Set(SELLER_LEAD_REJECT_REASONS.map((r) => r.key));
export function isValidRejectReason(key) { return REJECT_KEYS.has(String(key || '')); }

/** Condition keys, in the order the funnel reports them. */
export const GATE_CONDITIONS = [
  'reason_measured',        // in the doctrine seller queue with a measured reason to sell
  'decision_maker_linked',  // a linked person through a decision-maker role (not the owner restated)
  'owner_name_ok',          // owner name passes the junk / address guards
  'not_repeat_buyer',       // bridgeCreateLead's R5 refusal, applied up front
  'no_open_lead',           // no open bd_opportunity of any type on the owner
  'point_person_resolved',  // lcc_cadence_point_person gives a lead owner
  'not_already_decided',    // no live lane/auto decision (a "Not a lead" suppresses it)
];

/** The decision-maker people who survive the P164 own-name check. */
export function decisionMakerPeople(row) {
  const people = Array.isArray(row?.dm_people) ? row.dm_people : [];
  return people.filter((p) => p && p.name && !isOwnerNameRestated(p.name, row?.owner_name));
}

/** True when the owner name is not junk and not a bare address. */
export function ownerNamePasses(row) {
  const name = String(row?.owner_name || '').trim();
  if (!name) return false;
  if (row?.owner_name_sql_junk === true) return false;
  if (isJunkEntityName(name)) return false;
  if (isAddressAsName(name)) return false;
  return true;
}

/**
 * Evaluate one v_lcc_seller_lead_gate_candidates row.
 * @returns {{ qualifies: boolean, failed: string[], contact: object|null }}
 */
export function evaluateSellerLeadGate(row) {
  const checks = {
    reason_measured: row?.reason_measured === true,
    decision_maker_linked: decisionMakerPeople(row).length > 0,
    owner_name_ok: ownerNamePasses(row),
    not_repeat_buyer: !row?.repeat_buyer_parent,
    no_open_lead: row?.has_open_opportunity !== true,
    point_person_resolved: !!row?.point_person_user_id,
    not_already_decided: !row?.prior_decision,
  };
  const failed = GATE_CONDITIONS.filter((k) => !checks[k]);
  const dm = decisionMakerPeople(row);
  return { qualifies: failed.length === 0, failed, contact: dm[0] || null };
}

/** Split candidates into the gated list (value-ranked) and a per-condition funnel. */
export function applySellerLeadGate(rows) {
  const funnel = { candidates: 0, qualifies: 0, failed_by: {} };
  GATE_CONDITIONS.forEach((k) => { funnel.failed_by[k] = 0; });
  const gated = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    funnel.candidates += 1;
    const v = evaluateSellerLeadGate(row);
    v.failed.forEach((k) => { funnel.failed_by[k] += 1; });
    if (v.qualifies) { funnel.qualifies += 1; gated.push({ ...row, gate_contact: v.contact }); }
  }
  gated.sort((a, b) => (Number(b.rank_value) || 0) - (Number(a.rank_value) || 0));
  return { gated, funnel };
}

/**
 * Is auto-create allowed right now? BOTH must hold: the flag is on, and the lane's
 * own decisions prove the gate (>= threshold over a FULL window). Window size and
 * threshold come from v_lcc_seller_lead_gate_precision, the single place they live.
 * `precision` null (no decisions) is "unproven", never 0 and never eligible.
 */
export function autoCreateEligibility({ flagOn, precisionRow }) {
  const p = precisionRow || {};
  const window = Number(p.window_size) || 25;
  const threshold = p.precision_threshold != null ? Number(p.precision_threshold) : 0.9;
  const decided = Number(p.decided) || 0;
  const precision = p.precision == null ? null : Number(p.precision);
  const proven = decided >= window && precision != null && precision >= threshold;
  let reason = null;
  if (!flagOn) reason = 'flag_off';
  else if (decided < window) reason = 'too_few_decisions';
  else if (!proven) reason = 'precision_below_threshold';
  return {
    eligible: !!flagOn && proven,
    reason,
    flag_on: !!flagOn,
    decided, window, threshold, precision,
    creates: Number(p.creates) || 0,
    rejects: Number(p.rejects) || 0,
    auto_created: Number(p.auto_created) || 0,
    auto_reversed: Number(p.auto_reversed) || 0,
  };
}

/** "18/20 accepted, 90% — auto-create eligible" */
export function precisionMeterLabel(elig) {
  if (!elig || !elig.decided) return 'No decisions yet — auto-create unlocks at 90% over 25';
  const pct = elig.precision == null ? '—' : Math.round(elig.precision * 100) + '%';
  const head = elig.creates + '/' + elig.decided + ' accepted, ' + pct;
  if (elig.decided < elig.window) return head + ' — ' + (elig.window - elig.decided) + ' more decisions before auto-create can unlock';
  if (elig.precision < elig.threshold) return head + ' — below 90%, auto-create stays off';
  return head + (elig.flag_on ? ' — auto-create ON' : ' — auto-create eligible (flag off)');
}

/** The bridgeCreateLead request body for a gated owner (its top-value property). */
export function buildCreateLeadBody(row, source) {
  return {
    domain: row.source_domain,
    property_id: row.source_property_id,
    entity_id: row.entity_id,
    owner_name: row.owner_name,
    label: row.owner_name,
    property_address: [row.address, row.city, row.state].filter(Boolean).join(', ') || null,
    source,
    notes: 'Seller-lead gate: ' + String(row.reason_to_sell || '').replace(/_/g, ' ')
      + (row.gate_contact ? ' · contact ' + row.gate_contact.name + ' (' + row.gate_contact.role + ')' : ''),
  };
}

// ---------------------------------------------------------------------------
// Loaders (I/O injected).
// ---------------------------------------------------------------------------
export const GATE_CANDIDATES_PATH = 'v_lcc_seller_lead_gate_candidates?select=*&order=rank_value.desc.nullslast';

export async function loadGateCandidates(opsQuery) {
  const r = await opsQuery('GET', GATE_CANDIDATES_PATH, undefined, { countMode: 'none', timeoutMs: 25000 });
  if (!r || !r.ok) return { ok: false, rows: [], detail: r ? r.data : null };
  return { ok: true, rows: Array.isArray(r.data) ? r.data : [] };
}

export async function loadPrecision(opsQuery) {
  const r = await opsQuery('GET', 'v_lcc_seller_lead_gate_precision?select=*', undefined, { countMode: 'none' });
  return r && r.ok && Array.isArray(r.data) ? (r.data[0] || null) : null;
}
