// api/_shared/tier0-domain-demote.js
// ============================================================================
// ACI-phase1-2 Unit A(c) — learning from `lcc_tier0_confirm_log` REJECTS.
// ----------------------------------------------------------------------------
// PURE, no I/O. Scott's ask (`account-based-contact-intelligence.md` §7c Phase 1,
// AC1d(c)): "a reject should demote that domain for other owners sharing the weak
// token" — not the one card it was rejected on.
//
// ⚠️ MEASURED BEFORE BUILDING (2026-09-10, xengecqvemvfknjvbvrq):
//   select count(*) from lcc_tier0_confirm_log;                       -> 27
//   select count(*) from lcc_tier0_confirm_log where verdict='reject'; -> 0
//
// `lcc_tier0_confirm_log` holds 27 rows and **zero** are `verdict='reject'` — this
// matches P194's own finding ("27 attaches and zero rejects... a demotion engine
// there is a consumer with no producer"), re-measured here and still true. This
// module is therefore built as PURE LOGIC ONLY, ready the moment a reject lands,
// and is NOT wired into any cron or write path in this change — there is nothing
// yet to learn from, and wiring an unexercised demotion path is exactly the kind
// of unmeasured automation this repo's doctrine forbids (P196/P198: a rule
// calibrated on zero rows is not calibrated).
//
// ⚠️ READ `tier0-owner-contact-system.md` §5 TRAP 4 BEFORE TOUCHING THIS —
// P194 already measured and REFUTED the closest substitute (a shared domain
// across owners as evidence AGAINST one of them): 16 open cards collided with an
// attached domain and 0 of 16 were contradictions (13 NGP SPEs sharing
// `ngpv.com`, sponsor↔SPE families). **A domain being attached to owner A is
// CORROBORATION for owner B on the same domain, not evidence against it.** So
// this demotion logic must key on the SPECIFIC (domain, token, owner-shape) a
// human explicitly rejected — never on "this domain has been used before" —
// or it recreates the exact false-positive class P194 already closed.
//
// TRAP 2 (P196/P198): a lexical sponsor/domain rule graded at ~25% precision on
// this bench, twice. This module never proposes a NEW attach — it only narrows
// the ranking/visibility of a specific (domain, match_arm) pair a human already
// rejected, for OTHER owners using the identical match_arm+domain combination
// (not merely "same domain" — the P194 corroboration trap).
// ============================================================================

/**
 * One row of `lcc_tier0_confirm_log` for a REJECT verdict.
 * @typedef {object} Tier0RejectRow
 * @property {string} domain
 * @property {string} [match_arm]   - e.g. 'exact', 'domain_is_core_prefix'
 * @property {string} [match_key]   - the specific token/prefix that matched
 */

/**
 * One open Tier 0 candidate row a demotion could apply to.
 * @typedef {object} Tier0CandidateRow
 * @property {string} domain
 * @property {string} [match_arm]
 * @property {string} [match_key]
 */

/**
 * Build a demotion index from the confirm log's reject rows.
 *
 * Keyed on (domain, match_arm, match_key) — the EXACT signal a human rejected,
 * never the bare domain (P194's corroboration trap) and never the bare owner
 * (that already happened when the card was rejected).
 *
 * @param {Tier0RejectRow[]} rejectRows
 * @returns {Set<string>} keys of the form `${domain}::${match_arm}::${match_key}`
 */
export function buildTier0DemotionIndex(rejectRows) {
  const idx = new Set();
  for (const r of Array.isArray(rejectRows) ? rejectRows : []) {
    const domain = String(r?.domain || '').trim().toLowerCase();
    const arm = String(r?.match_arm || '').trim().toLowerCase();
    const key = String(r?.match_key || '').trim().toLowerCase();
    if (!domain || !arm || !key) continue; // never demote on a partial signal
    idx.add(`${domain}::${arm}::${key}`);
  }
  return idx;
}

/**
 * Decide whether a candidate row should be demoted (never dropped — demotion is
 * a RANKING signal, not an exclusion; a wrong reject on one owner must not make
 * a different, correct owner unreachable — see the P194 corroboration trap).
 *
 * @param {Tier0CandidateRow} candidate
 * @param {Set<string>} demotionIndex - from buildTier0DemotionIndex()
 * @returns {{demoted: boolean, reason: string|null}}
 */
export function tier0DemotionVerdict(candidate, demotionIndex) {
  const domain = String(candidate?.domain || '').trim().toLowerCase();
  const arm = String(candidate?.match_arm || '').trim().toLowerCase();
  const key = String(candidate?.match_key || '').trim().toLowerCase();
  if (!domain || !arm || !key) return { demoted: false, reason: null };
  const k = `${domain}::${arm}::${key}`;
  if (demotionIndex instanceof Set && demotionIndex.has(k)) {
    return { demoted: true, reason: 'rejected_same_domain_arm_key' };
  }
  return { demoted: false, reason: null };
}

/**
 * Honest population check — call this before wiring the above into any cron or
 * SQL view. Returns whether there is ANYTHING to learn from yet.
 *
 * @param {Tier0RejectRow[]} rejectRows
 * @returns {{ readyToWire: boolean, rejectCount: number }}
 */
export function tier0DemotionReadiness(rejectRows) {
  const n = Array.isArray(rejectRows) ? rejectRows.length : 0;
  return { readyToWire: n > 0, rejectCount: n };
}
