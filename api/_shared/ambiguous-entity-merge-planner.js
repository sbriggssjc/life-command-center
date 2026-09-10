// api/_shared/ambiguous-entity-merge-planner.js
// ============================================================================
// PDR1 / P13 fork 1 — score a placeholder entity's `metadata.ambiguous_resolution`
// candidate list and decide auto-merge vs needs_human. PURE FUNCTIONS ONLY — no
// DB access here. Two consumers share this module:
//   1. api/_handlers/ambiguous-entity-automerge-tick.js — the flag-gated sweep
//      that calls rpc/reconcile_entity for planner-approved auto-mergeable rows.
//   2. The `ambiguous_entity_resolution` Decision Center lane (api/admin.js /
//      dc-lanes.js) — renders the SAME scored candidate list, best-to-worst,
//      for the needs_human population, so a human sees exactly what the
//      planner saw and why it abstained.
//
// ⚠️ DB ACCESS WAS UNAVAILABLE WHEN THIS WAS WRITTEN (sandboxed build session,
// no egress to Supabase). The population split (N auto-mergeable / N
// needs_human out of the documented 189 `ambiguous_resolution` entities) is
// UNKNOWN and NOT reported as a real number anywhere in this codebase — see
// docs/claude-code/STATUS.md and PLANNED-BACKLOG.md P17/P13#1 for the explicit
// "pending live verification" status. Everything below is built against the
// DOCUMENTED shape of the population (PLANNED-BACKLOG.md §P17, §P13#1) and
// tested against FIXTURE data, not live rows.
//
// CANDIDATE SHAPE. `entities.metadata.ambiguous_resolution` on the placeholder
// itself only ever stores `{id, name}` per candidate (mcp/opportunity-sync.js
// `ambiguousCandidates = rows.map(x => ({id: x.id, name: x.name}))`) — no
// address/relationship signal rides on the placeholder row. The TICK (not this
// module) is responsible for enriching each `{id, name}` into the fuller shape
// this planner scores:
//
//   {
//     id: string,                       // entities.id of the candidate asset
//     name: string,
//     address: string | null,           // entities.address (raw, as captured)
//     normalized_address: string | null,// entities.normalized_address
//     entity_relationships_count: number | null,   // signal, if fetched
//     portfolio_facts_count: number | null,         // lcc_entity_portfolio_facts
//     external_identities_count: number | null,     // external_identities
//   }
//
// Any signal field the tick did not fetch is simply absent/null and scores as
// zero — the planner never treats "field missing" as "field disqualifying".
// ============================================================================

// ---------------------------------------------------------------------------
// Scoring rule (documented, not measured — see header). Each term is additive
// and capped so no single signal alone can promote a bare-placeholder
// candidate above an addressed one:
//
//   +100  candidate has ANY non-empty address at all
//         (a bare city-name placeholder like "Donna, TX" carries no address
//          field — this term alone is what keeps it from ever outscoring a
//          real property record)
//   +50   candidate's address is NORMALIZED (normalized_address IS NOT NULL
//         and non-empty) — on top of the +100, so a normalized address beats
//         an un-normalized one even when both are "has an address"
//   +min(signal_count, 20) * 2, capped at +40 total
//         real relationship/portfolio/identity signal, summed across the
//         three optional counters, credited only as a TIE-BREAK among
//         candidates that already cleared the address bar — never enough on
//         its own (max +40) to outweigh the +100/+150 address terms
//
// Maximum possible score: 100 + 50 + 40 = 190. A bare placeholder with zero
// signal anywhere scores exactly 0.
// ---------------------------------------------------------------------------

const ADDRESS_PRESENT_POINTS = 100;
const ADDRESS_NORMALIZED_POINTS = 50;
const SIGNAL_POINTS_PER_UNIT = 2;
const SIGNAL_POINTS_CAP = 40;

// ---------------------------------------------------------------------------
// Auto-mergeable threshold (documented rule, stated explicitly per the task
// spec — this repo's convention is to name a concrete number rather than
// leave "high confidence" undefined):
//
//   A candidate list is AUTO-MERGEABLE when, after scoring:
//     (a) at least one candidate has a non-empty address (score > 0), AND
//     (b) exactly one candidate is the top scorer (no tie for first place),
//         AND
//     (c) the top scorer clears MIN_AUTO_SCORE (must itself have at least a
//         present address — i.e. score >= ADDRESS_PRESENT_POINTS), AND
//     (d) the top scorer LEADS the next-best candidate by at least
//         MIN_AUTO_MARGIN points — the margin exists specifically to catch
//         the "two real, comparably-good addresses" case (a genuine
//         judgement call) and route it to needs_human instead of guessing.
//
// MIN_AUTO_MARGIN = ADDRESS_NORMALIZED_POINTS (50) — the margin is deliberately
// set to the value of the normalization bonus itself: the winner must be at
// least "one normalization step" ahead of the runner-up, which in practice
// means either (i) the winner has an address and the runner-up does not
// (margin >= 100), or (ii) the winner is normalized and the runner-up is not
// AND ties on everything else, or (iii) the winner clearly out-signals the
// runner-up on real relationship/portfolio/identity counts. A margin smaller
// than this would auto-merge on noise; the exact 50-point figure is a
// judgement call stated plainly here so a future re-grade with live data can
// adjust it, not a measured optimum (DB access unavailable at build time).
// ---------------------------------------------------------------------------
const MIN_AUTO_SCORE = ADDRESS_PRESENT_POINTS;
const MIN_AUTO_MARGIN = ADDRESS_NORMALIZED_POINTS;

function hasNonEmptyAddress(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function signalCount(candidate) {
  const a = Number(candidate?.entity_relationships_count) || 0;
  const b = Number(candidate?.portfolio_facts_count) || 0;
  const c = Number(candidate?.external_identities_count) || 0;
  return Math.max(0, a) + Math.max(0, b) + Math.max(0, c);
}

/**
 * Score one candidate. Pure, deterministic, no DB access.
 * Returns { candidate, score, has_address, has_normalized_address, signal }.
 */
export function scoreCandidate(candidate) {
  const c = candidate || {};
  const hasAddr = hasNonEmptyAddress(c.address);
  const hasNorm = hasNonEmptyAddress(c.normalized_address);
  const signal = signalCount(c);

  let score = 0;
  if (hasAddr) score += ADDRESS_PRESENT_POINTS;
  if (hasNorm) score += ADDRESS_NORMALIZED_POINTS;
  score += Math.min(signal * SIGNAL_POINTS_PER_UNIT, SIGNAL_POINTS_CAP);

  return {
    candidate: c,
    score,
    has_address: hasAddr,
    has_normalized_address: hasNorm,
    signal,
  };
}

/**
 * Score a full candidate list and rank it best-to-worst.
 * Returns an array of scoreCandidate() results, sorted descending by score,
 * ties broken by original array order (stable).
 */
export function rankCandidates(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  return list
    .map((c, idx) => ({ ...scoreCandidate(c), _idx: idx }))
    .sort((a, b) => (b.score - a.score) || (a._idx - b._idx))
    .map(({ _idx, ...rest }) => rest);
}

/**
 * The one function both consumers call.
 *
 * @param {object} entity - the placeholder entity row, at minimum
 *   { id, name, metadata: { ambiguous_resolution: [...] } } — or pass
 *   `candidates` directly (see below) if the caller has already unwrapped it.
 * @param {object[]} [candidates] - optional pre-enriched candidate array
 *   (overrides entity.metadata.ambiguous_resolution when supplied — this is
 *   how the tick passes in candidates it has fetched address/signal data
 *   for, since the raw metadata array on the entity itself only ever carries
 *   {id, name}).
 *
 * @returns {{
 *   eligible: boolean,               // true => auto-mergeable
 *   placeholder_id: string|null,
 *   winner: object|null,             // the scored top candidate, if eligible
 *   ranked: object[],                // full scored/ranked candidate list
 *   reason: string,                  // 'auto_mergeable' | 'needs_human:<why>' | 'no_candidates'
 * }}
 */
export function planAmbiguousEntityMerge(entity, candidates) {
  const placeholderId = entity?.id ?? null;
  const rawList = Array.isArray(candidates)
    ? candidates
    : (entity?.metadata?.ambiguous_resolution || null);

  if (!Array.isArray(rawList) || rawList.length === 0) {
    return {
      eligible: false, placeholder_id: placeholderId, winner: null, ranked: [],
      reason: 'no_candidates',
    };
  }

  const ranked = rankCandidates(rawList);
  const top = ranked[0];
  const runnerUp = ranked[1] || null;

  if (!top || top.score < MIN_AUTO_SCORE) {
    return {
      eligible: false, placeholder_id: placeholderId, winner: null, ranked,
      reason: 'needs_human:no_candidate_clears_min_score',
    };
  }

  const margin = runnerUp ? (top.score - runnerUp.score) : top.score;
  if (runnerUp && margin < MIN_AUTO_MARGIN) {
    return {
      eligible: false, placeholder_id: placeholderId, winner: null, ranked,
      reason: 'needs_human:margin_too_close',
    };
  }

  return {
    eligible: true, placeholder_id: placeholderId, winner: top.candidate, ranked,
    reason: 'auto_mergeable',
  };
}

/**
 * The Decision Center federated-lane subject_ref for a placeholder entity.
 * Keyed on the placeholder alone — one open question per ambiguous entity,
 * matching the population `PLANNED-BACKLOG.md` counts (one row per entity,
 * not per candidate).
 */
export function ambiguousEntitySubjectRef(placeholderId) {
  return placeholderId ? 'amb:' + String(placeholderId) : null;
}

/**
 * Build the Decision Center card for a needs_human ambiguous entity: the
 * placeholder plus its scored candidates, best-to-worst — the SAME ranking
 * the auto-merge tick's planner produced, so a human sees exactly what the
 * planner saw and why it abstained.
 */
export function buildAmbiguousEntityCard(entity, plan) {
  return {
    placeholder_id: entity?.id || null,
    placeholder_name: entity?.name || null,
    city: entity?.city || null,
    state: entity?.state || null,
    reason: plan?.reason || null,
    ranked: Array.isArray(plan?.ranked) ? plan.ranked : [],
  };
}

/**
 * Verdict shape gate — mirrors the house pattern (validateTier0Verdict,
 * validateEntityRetypeVerdict): re-run at write time against a FRESHLY
 * re-read card, never trust the client's payload alone.
 *   * 'merge'    requires a `candidate_id` that appears in the card's ranked
 *                candidate list (never an arbitrary id the client supplies).
 *   * 'keep_new' requires nothing further — it marks the placeholder as a
 *                genuinely new asset (reconcile_entity's p_keep_new path).
 *   * 'research' spawns a research_task, no entity write.
 */
export function validateAmbiguousEntityVerdict(card, verdict, payload) {
  const v = String(verdict || '').toLowerCase();
  if (v === 'keep_new' || v === 'research') return { ok: true, verdict: v };
  if (v === 'merge') {
    const candidateId = payload?.candidate_id || null;
    if (!candidateId) return { ok: false, error: 'candidate_id_required' };
    const ranked = Array.isArray(card?.ranked) ? card.ranked : [];
    const match = ranked.find((r) => r?.candidate?.id === candidateId);
    if (!match) return { ok: false, error: 'candidate_not_on_card' };
    return { ok: true, verdict: v, candidate: match.candidate };
  }
  return { ok: false, error: 'unknown_verdict' };
}

export const AMBIGUOUS_MERGE_SCORING = Object.freeze({
  ADDRESS_PRESENT_POINTS,
  ADDRESS_NORMALIZED_POINTS,
  SIGNAL_POINTS_PER_UNIT,
  SIGNAL_POINTS_CAP,
  MIN_AUTO_SCORE,
  MIN_AUTO_MARGIN,
});

export default planAmbiguousEntityMerge;
