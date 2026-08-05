// api/_shared/deal-milestone-collapse.js
// ============================================================================
// W7.2c — the CANONICAL, testable spec of the milestone same-key collapse rule.
//
// The SQL functions `lcc_deal_record_milestone()` (live writer) and
// `lcc_collapse_comms_tick_milestones()` (the one-shot backfill collapse) MIRROR
// this logic. Keep them in lock-step; this module is the single source of truth
// for the decision and is what the unit tests exercise (the SQL can't run in the
// sandbox). Same discipline as dia `census_plausibility` ↔ its SQL guard.
//
// The rule (per (entity_id, milestone_key)):
//   • The FIRST occurrence is THE milestone row.
//   • A later re-occurrence normally ROLLS UP into that row's metadata
//     (occurrence_count, last_seen_on, last_detail_ref, occurrences[≤20]) — no
//     new row.
//   • A re-occurrence opens a genuinely NEW row ONLY when BOTH hold:
//       1. the prior same-key row is > STALE_DAYS (90) stale (the gap between the
//          prior row's last_seen_on and the new occurrence date), AND
//       2. the deal stage REGRESSED — the deal had already advanced PAST this
//          stage (its max milestone rank exceeds this key's rank), so a fresh
//          touch of an earlier stage (a second LOI round after a fell-through
//          deal) is a new milestone, not a repeat of the old one.
//   • Re-feeding the exact same evidence (detail_ref already recorded) is a NOOP
//     (idempotent — the tick's ledger already prevents reprocessing, this is a
//     belt-and-suspenders guard for force/dry re-runs).
// ============================================================================

export const STALE_DAYS = 90;

// Canonical stage order. Higher = later in the deal lifecycle. Unknown keys → 0
// (an unknown key never counts as "advanced past", so it only ever rolls up).
const STAGE_RANK = {
  prospecting: 10,
  bov: 20,
  ela: 30,
  marketing: 40,
  offers: 50,
  loi: 60,
  psa: 70,
  escrow: 80,
  diligence: 90,
  financing: 95,
  close: 100,
};

/** Canonical rank for a milestone_key (0 for unknown). */
export function stageRank(key) {
  if (!key) return 0;
  return STAGE_RANK[String(key).trim().toLowerCase()] || 0;
}

function daysBetween(a, b) {
  const ta = a ? new Date(a).getTime() : NaN;
  const tb = b ? new Date(b).getTime() : NaN;
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
  return Math.floor((tb - ta) / 86_400_000);
}

/**
 * Decide what a re-occurrence of a same-key milestone should do.
 * @param {object|null} prior  the existing same-key row:
 *   { occurred_on, last_seen_on, status, detail_refs:Set|Array, key }
 * @param {object} next  the incoming cue: { on (date), detail_ref }
 * @param {number} dealMaxRank  max stageRank across ALL of the deal's milestones
 *   (any source), captured BEFORE this write.
 * @param {number} [thresholdDays=STALE_DAYS]
 * @returns {'insert'|'roll_up'|'new_round'|'noop'}
 *   insert    — no prior row exists; create the first one.
 *   roll_up   — fold into the prior row's metadata.
 *   new_round — stale + regressed → a legitimately new milestone row.
 *   noop      — this exact evidence is already recorded.
 */
export function collapseDecision(prior, next, dealMaxRank, thresholdDays = STALE_DAYS) {
  if (!prior) return 'insert';

  // Idempotency: same evidence already folded in.
  const refs = prior.detail_refs instanceof Set
    ? prior.detail_refs
    : new Set(Array.isArray(prior.detail_refs) ? prior.detail_refs : []);
  if (next?.detail_ref && refs.has(next.detail_ref)) return 'noop';

  const priorSeen = prior.last_seen_on || prior.occurred_on || null;
  const gap = daysBetween(priorSeen, next?.on);
  const stale = gap != null && gap > thresholdDays;

  const keyRank = stageRank(prior.key || next?.key);
  const regressed = Number.isFinite(dealMaxRank) && dealMaxRank > keyRank;

  return (stale && regressed) ? 'new_round' : 'roll_up';
}

export const __test__ = { STAGE_RANK, daysBetween };
