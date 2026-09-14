// A2 — apply the `agrees` ownership chains (2026-08-27).
//
// A1 split `establish_ownership_history` into four jobs. `agrees` (380 tasks /
// 450 links) is the one that is not a question: the drafted chain's last
// recorded grantee IS the owner we already hold, so the chain corroborates
// current state. A2 writes each link's GRANTOR into
// `lcc_entity_portfolio_facts` as historical ownership and completes the task.
//
// ⚠️ THE APPLIER IS SQL, AND ONLY SQL. Everything it needs already lives in LCC
// Opps — A1's view supplies the bucket, `lcc_clean_assist_proposals` supplies
// the links (P131 wrote them), `entities` supplies the parties — so no gov read
// happens at apply time and no Railway deploy sits on the critical path. This
// module carries the NAMES and the read-side query shapes only. It contains no
// second copy of the bucket test, the identity comparator, the disposition CASE
// or the completion rule: a JS mirror of a SQL classifier is the normaliser
// drift this repo keeps paying for (P134 re-derived a view's GROUP BY and got
// 150 members for a 2-member group).
//
// ⚠️ AND THE BUCKET IS READ, NEVER RE-DERIVED. A2 selects
// `v_lcc_ownership_history_lane_split.action = 'agrees'`. It never re-tests
// `terminates_at_current_owner` and never greps the drafter's `reason` prose
// (P182: a text detector over generated prose, and structurally blind to the
// no_records/all_guarded split).

import { OWNERSHIP_LANE_SPLIT_VIEW } from './ownership-lane-split.js';

/** The one A1 action A2 consumes. A2 must never touch the other three. */
export const A2_ACTION = 'agrees';

export const A2_APPLY_FN = 'lcc_a2_apply_ownership_chains';
export const A2_UNAPPLY_FN = 'lcc_a2_unapply_ownership_chains';
export const A2_PLAN_VIEW = 'v_lcc_ownership_chain_apply_plan';
export const A2_OWNER_START_VIEW = 'v_lcc_ownership_chain_apply_owner_start_plan';
export const A2_CONFLICT_VIEW = 'v_lcc_ownership_chain_apply_conflict';
export const A2_BLOCKED_VIEW = 'v_lcc_ownership_chain_apply_blocked';
export const A2_RUN_HEALTH_VIEW = 'v_lcc_ownership_chain_apply_run_health';
export const A2_LEDGER_TABLE = 'lcc_ownership_chain_apply_log';
export const A2_LANE_SPLIT_VIEW = OWNERSHIP_LANE_SPLIT_VIEW;

/** `ownership_source` prefix every fact A2 writes carries, with the citation. */
export const A2_OWNERSHIP_SOURCE_PREFIX = 'gov_ownership_chain:';

/** Registered in `field_source_priority` for the two date fields A2 fills. */
export const A2_PROVENANCE_SOURCE = 'gov_ownership_chain';

/**
 * Why a link could not be applied. Every one is REPORTED with its own name —
 * "we could not find the party" and "the record repeats one conveyance" are
 * different facts and folding them into one bucket is the P181 failure.
 */
export const A2_BLOCKED_REASONS = Object.freeze([
  // The grantor is a placeholder cell, not a party ("Previous Owner Name").
  'placeholder',
  // A brokerage is the agent, never the principal.
  'brokerage_is_agent_not_principal',
  'undated_link',
  'uncited_link',
  // No live entity carries the grantor's name key.
  'no_entity',
  // Two or more live entities do — LCC holds duplicates. A2 never picks a
  // winner; merging them is what unblocks the link (P195).
  'ambiguous_entity',
  'survivor_unresolved',
  // The PK is (entity, domain, property): one interval per party per property.
  // Two links naming the same grantor on one property are one conveyance
  // recorded twice (gsa_lease_diff lessor flicker), and choosing a date would
  // be a guess, so the pair is surfaced with its alternate dates instead.
  'repeat_transfer_unrepresentable',
]);

/**
 * What A2 did (or would do) with a link. `insert` / `fill_start_date` are
 * writes; `already_present` is a re-discovery tally that reads exactly like
 * throughput (P159a); `conflict_*` is surfaced and NEVER auto-resolved.
 */
export const A2_DISPOSITIONS = Object.freeze([
  'insert', 'fill_start_date', 'already_present', 'blocked',
  'conflict_reads_current', 'conflict_end_date_differs', 'conflict_start_date_differs',
]);

/** The keys worth quoting from a run. Everything else is state, not throughput. */
export const A2_THROUGHPUT_KEYS = Object.freeze(['facts_inserted', 'tasks_completed']);

/** The key that must never be quoted as throughput. */
export const A2_REDISCOVERY_KEY = 'links_already_present';

/**
 * The stamp A2 leaves on a completed task. The lane's acceptance test is
 * `status='completed'`, so the outcome has to say what "completed" meant.
 */
export const A2_OUTCOME_SOURCE = 'a2_ownership_chain';
export const A2_OUTCOME_REASON = 'ownership_chain_applied';

/**
 * PostgREST path for the open `agrees` rows A2 will consider, value-ranked.
 * Read-only; the write path is the SQL function.
 */
export function a2AgreesPath({ limit = 100, offset = 0 } = {}) {
  return `${A2_LANE_SPLIT_VIEW}?select=research_task_id,entity_id,domain,source_record_id,priority`
    + `&action=eq.${A2_ACTION}`
    + `&order=priority.asc,created_at.asc&limit=${limit}&offset=${offset}`;
}

/** PostgREST path for the blocked residue, highest-value owner first. */
export function a2BlockedPath({ reason = null, limit = 100, offset = 0 } = {}) {
  let p = `${A2_BLOCKED_VIEW}?select=*`;
  if (reason) {
    if (!A2_BLOCKED_REASONS.includes(reason)) return null;
    p += `&blocked_reason=eq.${encodeURIComponent(reason)}`;
  }
  return `${p}&order=owner_annual_rent.desc.nullslast,source_property_id.asc&limit=${limit}&offset=${offset}`;
}

/** PostgREST path for the surfaced conflicts. Never auto-resolved. */
export function a2ConflictPath({ scope = null, limit = 200 } = {}) {
  let p = `${A2_CONFLICT_VIEW}?select=*`;
  if (scope) p += `&scope=eq.${encodeURIComponent(scope)}`;
  return `${p}&limit=${limit}`;
}

/**
 * Read the honest result of the most recent runs.
 *
 * Reads `facts_inserted` / `tasks_completed`, and carries `lane_completed_ever`
 * — the only number that settles whether this lane is consuming anything.
 */
export async function fetchA2RunHealth(opsQuery, { limit = 5 } = {}) {
  const r = await opsQuery('GET', `${A2_RUN_HEALTH_VIEW}?select=*&limit=${limit}`,
    undefined, { countMode: 'none' });
  if (!r.ok) {
    // Surface the DB's own message (the P132 lesson, on this exact endpoint).
    return { ok: false, status: r.status || 500, error: r.data?.message || 'Failed to read A2 run health', runs: [] };
  }
  return { ok: true, status: 200, error: null, runs: Array.isArray(r.data) ? r.data : [] };
}
