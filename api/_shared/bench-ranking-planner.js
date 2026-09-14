// api/_shared/bench-ranking-planner.js
// ============================================================================
// ACI-phase2-unitC — AC2, rank the owner_contact_pivot bench.
// ----------------------------------------------------------------------------
// PURE, no I/O — mirrors `entity-parent-inheritance-planner.js`: this module
// takes already-fetched candidate + correspondence data and returns a ranked
// plan. It never queries the DB and never calls Ollama itself (that is AC3,
// `bench-role-inference-planner.js`, run BEFORE this and its output fed in via
// `inferred_function`/`inferred_function_confidence`).
//
// SHAPE — EXTENDS THE EXISTING `bench` COLUMN, DOES NOT REDEFINE IT.
// Read live 2026-09-10 (`owner_contact_pivot.bench`, `xengecqvemvfknjvbvrq`):
//   [{ "name", "role", "source", "n_props", "authority", "contact_entity_id",
//      "is_named_individual" }]
// (`authority` here is the SQL bench's own P188 ladder — 1 signatory > 2
// controlling > 3 economic > 4 agent > 5 captured > 6 works_at/related_person;
// LOWER is more authoritative — a completely different scale from this
// module's own `seniority_score`, which is a correspondence/title signal, not
// a legal-control one. They are kept as separate fields on purpose; conflating
// them would silently redefine what `authority` has meant since Slice 2.)
// Every field above is carried through UNCHANGED. This module only APPENDS:
//   correspondence_volume, last_email_date, two_way, inferred_function,
//   inferred_function_confidence, inferred_function_basis, seniority_known,
//   seniority_score, rank, rank_reason.
//
// WHY THE BENCH IS NEVER COLLAPSED TO ONE WINNER (Scott, 2026-08-26, quoted in
// `account-based-contact-intelligence.md` §4 Tier 1): "the active contact must
// be the current head of a re-derived ranking, not a decision recorded once,
// because roles/firms/funds change." `rankBench()` therefore always returns
// every input candidate, ordered — it never drops anyone the caller handed it.
//
// SORT ORDER, AND WHY FUNCTION OUTRANKS RAW VOLUME (§3a's whole point —
// "correspondence volume is NOT the selector"):
//   1. two_way (an inbound/reply signal exists)        — absolute: a real
//      two-way relationship beats a one-way blast of any size.
//   2. inferred function priority (acquisitions > disposition > transaction_dd
//      > broker; unknown treated as neutral, NOT penalized to broker level and
//      NOT assumed to be a BD target — P181: don't fabricate a judgement from
//      an absence of one)
//   3. correspondence volume
//   4. recency (this is where "recency beats volume ON A TIE" lives — it is
//      the tiebreak immediately below volume, so it decides only when 1–3 tie)
//   5. seniority signal (title-derived, 0 when title absent — silence, not a
//      claim of junior status)
//   6. name, ascending — stable, deterministic tiebreak of last resort
// ============================================================================

/** The §3a four-bucket taxonomy. Keep in sync with bench-role-inference-planner.js. */
export const BENCH_FUNCTION_TAXONOMY = ['acquisitions', 'disposition', 'transaction_dd', 'broker'];

const FUNCTION_PRIORITY = { acquisitions: 3, disposition: 2, transaction_dd: 1, broker: 0 };
/** Unknown/null function: neutral — same priority as transaction_dd, never assumed acquisitions-grade. */
const UNKNOWN_FUNCTION_PRIORITY = 1;

function functionPriority(fn) {
  if (fn && Object.prototype.hasOwnProperty.call(FUNCTION_PRIORITY, fn)) return FUNCTION_PRIORITY[fn];
  return UNKNOWN_FUNCTION_PRIORITY;
}

const SENIOR_RE = /\b(ceo|coo|cfo|president|founder|managing director|partner|principal|chairman)\b/i;
const MID_RE = /\b(evp|svp|vp|vice[\s-]?president|director|head\s+of)\b/i;
const JUNIOR_RE = /\b(manager|analyst|coordinator|associate|specialist)\b/i;

/**
 * Score a title into a 0–3 seniority signal. Absence of a title returns
 * `known:false` and `score:0` — that is SILENCE, never a claim the person is
 * junior (title coverage is only 5.2%; most of the bench simply has none).
 * @param {string|null|undefined} title
 * @returns {{score:number, known:boolean}}
 */
export function seniorityScoreFromTitle(title) {
  const t = String(title || '').trim();
  if (!t) return { score: 0, known: false };
  if (SENIOR_RE.test(t)) return { score: 3, known: true };
  if (MID_RE.test(t)) return { score: 2, known: true };
  if (JUNIOR_RE.test(t)) return { score: 1, known: true };
  return { score: 1, known: true }; // present but unmapped — neutral, still "known"
}

function daysSince(dateStr, nowMs) {
  if (!dateStr) return null;
  const t = Date.parse(dateStr);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (nowMs - t) / 86400000);
}

/**
 * @typedef {object} BenchCandidateInput
 * @property {string} [contact_entity_id]
 * @property {string} name
 * @property {string} [role]
 * @property {string} [source]
 * @property {number} [n_props]
 * @property {number} [authority]              - the SQL bench's own P188 ladder (unchanged, passthrough)
 * @property {boolean} [is_named_individual]
 * @property {string|null} [title]
 * @property {number|null} [total_emails_sent]
 * @property {string|null} [last_email_date]    - ISO timestamp
 * @property {number|null} [inbound_count]      - `email_bodies where is_sent=false`, the reply/two-way signal
 * @property {'acquisitions'|'disposition'|'transaction_dd'|'broker'|null} [inferred_function] - from AC3
 * @property {'high'|'medium'|'low'|null} [inferred_function_confidence]                        - from AC3
 * @property {string|null} [inferred_function_basis]                                             - from AC3
 */

/**
 * @param {BenchCandidateInput} c
 * @param {number} nowMs
 * @returns {{twoWay:number, fnP:number, volume:number, recencyScore:number, sen:number}}
 */
function sortFields(c, nowMs) {
  const twoWay = Number(c?.inbound_count) > 0 ? 1 : 0;
  const fnP = functionPriority(c?.inferred_function);
  const volume = Number.isFinite(Number(c?.total_emails_sent)) ? Number(c.total_emails_sent) : 0;
  const d = daysSince(c?.last_email_date, nowMs);
  // More recent = higher score; no date at all = worst possible recency, never
  // treated as "most recent" (which -Infinity guards against).
  const recencyScore = d == null ? -Infinity : -d;
  const sen = seniorityScoreFromTitle(c?.title).score;
  return { twoWay, fnP, volume, recencyScore, sen };
}

function compareCandidates(a, b, nowMs) {
  const sa = sortFields(a, nowMs);
  const sb = sortFields(b, nowMs);
  if (sa.twoWay !== sb.twoWay) return sb.twoWay - sa.twoWay;
  if (sa.fnP !== sb.fnP) return sb.fnP - sa.fnP;
  if (sa.volume !== sb.volume) return sb.volume - sa.volume;
  if (sa.recencyScore !== sb.recencyScore) return sb.recencyScore - sa.recencyScore;
  if (sa.sen !== sb.sen) return sb.sen - sa.sen;
  return String(a?.name || '').localeCompare(String(b?.name || ''));
}

function rankReason(c, nowMs) {
  const f = sortFields(c, nowMs);
  const reasons = [];
  if (f.twoWay) reasons.push('two_way_correspondence');
  if (f.fnP >= FUNCTION_PRIORITY.acquisitions) reasons.push('inferred_acquisitions_function');
  else if (f.fnP >= FUNCTION_PRIORITY.disposition && c?.inferred_function === 'disposition') reasons.push('inferred_disposition_function');
  if (f.volume > 0) reasons.push('correspondence_volume');
  if (Number.isFinite(f.recencyScore) && f.recencyScore !== -Infinity) reasons.push('recent_correspondence');
  if (f.sen >= 2) reasons.push('senior_title');
  return reasons.length ? reasons.join(',') : 'no_signal';
}

/**
 * Rank an owner's bench. NEVER drops a candidate the caller handed it — the
 * bench is a re-derivable ranking, not a single winner (Scott, 08-26).
 *
 * @param {BenchCandidateInput[]} candidates
 * @param {{now?: number|Date}} [opts]
 * @returns {Array<BenchCandidateInput & {
 *   correspondence_volume:number, last_email_date:string|null, two_way:boolean,
 *   inferred_function:string|null, inferred_function_confidence:string|null,
 *   inferred_function_basis:string|null, seniority_known:boolean,
 *   seniority_score:number, rank:number, rank_reason:string
 * }>}
 */
export function rankBench(candidates, opts = {}) {
  const nowMs = opts.now instanceof Date ? opts.now.getTime()
    : Number.isFinite(opts.now) ? opts.now : Date.now();
  const list = Array.isArray(candidates) ? candidates.filter((c) => c && String(c.name || '').trim()) : [];
  const sorted = [...list].sort((a, b) => compareCandidates(a, b, nowMs));
  return sorted.map((c, i) => {
    const sen = seniorityScoreFromTitle(c.title);
    return {
      ...c,
      correspondence_volume: Number.isFinite(Number(c.total_emails_sent)) ? Number(c.total_emails_sent) : 0,
      last_email_date: c.last_email_date || null,
      two_way: Number(c.inbound_count) > 0,
      inferred_function: c.inferred_function || null,
      inferred_function_confidence: c.inferred_function_confidence || null,
      inferred_function_basis: c.inferred_function_basis || null,
      seniority_known: sen.known,
      seniority_score: sen.score,
      rank: i + 1,
      rank_reason: rankReason(c, nowMs),
    };
  });
}

/** Honest counts — never a re-discovery tally, never a claim about what wasn't ranked. */
export function summarizeBenchPlan(ranked) {
  const list = Array.isArray(ranked) ? ranked : [];
  return {
    total: list.length,
    two_way: list.filter((r) => r.two_way).length,
    function_known: list.filter((r) => !!r.inferred_function).length,
    function_high_confidence: list.filter((r) => r.inferred_function_confidence === 'high').length,
    title_known: list.filter((r) => r.seniority_known).length,
    top_name: list.length ? list[0].name : null,
    top_rank_reason: list.length ? list[0].rank_reason : null,
  };
}

/**
 * The value gate (P161/P180 doctrine, AC10/A5c/C2a/B1's `$500k` floor pattern).
 * Reuses `cadenceSignalFloor()` from `cadence-engine.js` (env
 * `CADENCE_SIGNAL_MIN_VALUE`, default 500000) — the caller passes that value in
 * (this module stays pure, no `process.env` read here) rather than this file
 * inventing a second threshold knob.
 * @param {number|null|undefined} ownerValue - owner's connected/portfolio rent
 * @param {number} floor
 * @returns {boolean}
 */
export function ownerPassesBenchValueGate(ownerValue, floor) {
  const v = Number(ownerValue);
  const f = Number(floor);
  if (!Number.isFinite(f)) return true; // no floor configured -> admit (fail open on config, not on data)
  if (!Number.isFinite(v)) return false; // unknown value is gated, not admitted — P161's "unknown is not small"
  return v >= f;
}

export default rankBench;
