// UX-T1b — research workbench lane definitions (2026-09-08).
//
// Four `research_type`s (or groups of them) are genuine human queues today
// and get their own workbench TAB, distinct from the raw ~18-entry
// `research_type` chip picker (`researchLanePickerHTML` in ops.js). The
// remaining lanes are excluded here on a STATED basis, never silently:
//
//   owner_needs_salesforce / true_owner_needs_salesforce -- C1a-e disposed
//     these `lane_no_consumer` / retire, but the retirement sweep
//     (`lcc_c1c_retire_sf_lanes`) is dry-run-default and was never applied
//     live (verified 2026-09-08: both still 100% status='queued'). "Merged
//     is not running" -- filed UX-T1b-g2, not executed here.
//   property_missing_recorded_owner / _county_record / _true_owner --
//     `answerable=false`, 0 real completions ever, no capture path, no
//     C-series disposition. Filed UX-T1b-g1.
//   trace_ownership_to_developer -- has an automated closer already; the open
//     count may not need a human at all. Filed UX-T1b-g3.
//
// ⚠️ EVERY LANE HERE READS AN EXISTING SIGNAL. `owner_contact` reads
// `v_lcc_owner_contact_decidability.decidable` (P131); `npi` is the
// already-mint-time-gated P181 population (there is no further threshold to
// invent without a producer change, which is out of scope for this unit);
// `followups` is a plain research_type allowlist. None of this is a new
// name-matching / lexical classifier — the banned-for-identity class.
//
// This vocabulary MUST match `supabase/migrations/20261017120000_lcc_uxt1b_
// research_workbench.sql`'s `lane_defs` CTE exactly — a JS mirror of a SQL
// classifier is the normaliser-drift footgun this repo has been bitten by
// repeatedly (`lcc_normalize_entity_name`, the P134 re-derived GROUP BY).
// Parity is enforced by test/uxt1b-workbench-lane-parity.test.mjs, which
// re-parses the migration's array literals and diffs them against these
// exports — so the two cannot drift silently.

export const WORKBENCH_OWNER_CONTACT_VIEW = 'v_lcc_owner_contact_decidability';

export const WORKBENCH_OWNERSHIP_HISTORY_TYPES = Object.freeze(['establish_ownership_history']);
export const WORKBENCH_OWNER_CONTACT_TYPES = Object.freeze(['owner_contact_manual']);
export const WORKBENCH_NPI_TYPES = Object.freeze(['npi_missing_inventory', 'npi_new_registration']);
export const WORKBENCH_FOLLOWUP_TYPES = Object.freeze([
  'confirm_tenant_mismatch',
  'state_lease_distress_review',
  'person_email_merge_review',
  'confirm_deed_transfer_sale',
  'confirm_true_owner',
  'merge_duplicate_entities',
  'systemic_findings_report',
  'news_alert_development_followup',
]);

export const WORKBENCH_LANES = Object.freeze(['ownership_history', 'owner_contact', 'npi', 'followups']);

export function isWorkbenchLane(v) {
  return WORKBENCH_LANES.includes(String(v || ''));
}

/** research_type value(s) a workbench lane maps onto, for the direct-filter lanes. */
export function workbenchLaneResearchTypes(lane) {
  switch (String(lane || '')) {
    case 'ownership_history': return WORKBENCH_OWNERSHIP_HISTORY_TYPES;
    case 'owner_contact': return WORKBENCH_OWNER_CONTACT_TYPES;
    case 'npi': return WORKBENCH_NPI_TYPES;
    case 'followups': return WORKBENCH_FOLLOWUP_TYPES;
    default: return null;
  }
}

/**
 * Page one workbench lane and return task ids in lane order.
 *
 * SERVER-SIDE ON PURPOSE, mirroring `fetchOwnershipLaneTaskIds` (A1) exactly:
 * count=exact on the WHOLE filtered set, never a client-side slice of the
 * current page (the P139 badge-that-lies shape). Only `owner_contact` needs a
 * second view (the decidability gate); `npi`/`followups` filter directly on
 * `research_tasks.research_type` and the caller builds that path itself
 * (there is no narrower view to page against for those two today).
 */
export async function fetchWorkbenchLaneTaskIds(opsQuery, { lane, status = '', limit = 50, offset = 0 } = {}) {
  if (lane !== 'owner_contact') {
    return { ok: false, status: 400, error: `fetchWorkbenchLaneTaskIds: no id-fetcher for lane "${lane}" (only owner_contact needs one)`, ids: [], count: 0 };
  }
  let path = `${WORKBENCH_OWNER_CONTACT_VIEW}?select=research_task_id&decidable=eq.true`;
  if (status && status !== 'active' && status !== 'all') path += `&status=eq.${encodeURIComponent(status)}`;
  else path += `&status=neq.completed`;
  path += `&order=rank_value.desc.nullslast,created_at.asc&limit=${limit}&offset=${offset}`;
  const r = await opsQuery('GET', path, undefined, { countMode: 'exact' });
  if (!r.ok) {
    return { ok: false, status: r.status || 500, error: r.data?.message || 'Failed to fetch owner-contact decidability', ids: [], count: 0 };
  }
  const ids = (Array.isArray(r.data) ? r.data : []).map((x) => x && x.research_task_id).filter(Boolean);
  return { ok: true, ids, count: r.count == null ? ids.length : r.count, status: 200, error: null };
}
