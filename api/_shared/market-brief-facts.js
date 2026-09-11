// ============================================================================
// api/_shared/market-brief-facts.js — MB-a: pure fact builders + the
// supersede/conflict/small-n decision rules for the P-SQL (on-box structured)
// market-brief producer.
//
// Everything in this module is PURE (no DB, no network) so it can be
// unit-tested against fixtures per the spec's own guard list: fact builders,
// supersede chain, small-n suppression, conflict marking. The tick handler
// (market-brief-psql-tick.js) is the only place that talks to Supabase; it
// calls decideFactWrite() to decide what to do with a candidate fact against
// whatever is currently live, then performs the write.
//
// STALENESS (spec §3, EB1 migration comment): stale_after is computed by the
// WRITER at insert time as fetched_at + the section's TTL — never a bare
// interval column. This module owns the TTL table so the tick and its tests
// share one definition instead of two drifting copies.
//
// FACT IDENTITY. A fact with a source_url + source_date already dedupes on
// the EB1 migration's uq_mbf_source_identity index (lane, section, source_url,
// source_date, claim_text). An on-box SQL derivation has NEITHER — its
// identity is the DERIVATION itself (e.g. "the dialysis TTM cap-rate band"),
// which is what `fact_key` is for (MB-a migration adds the column + a partial
// unique index scoped to status='live'). RSS facts never set fact_key; P-SQL
// facts always do.
//
// CONFLICT (spec §2/§4.MB1): "Conflicts with seeded web facts -> mark status
// 'conflict' on both, don't pick." Scoped narrowly: a conflict is only ever
// raised against an EXISTING LIVE fact whose origin is 'web_research' (a
// seeded/P-WEB fact) when the values disagree beyond CONFLICT_TOLERANCE.
// Two onbox_sql facts for the same fact_key disagreeing across runs is the
// ORDINARY case (the market moved) and is a supersede, not a conflict.
// ============================================================================

export const MIN_N_CAP_BAND = 5;         // spec: "by operator where n suffices" — small-n suppression floor
export const CONFLICT_TOLERANCE = 0.10;  // 10% relative difference before two facts are treated as disagreeing
export const CONFLICT_ORIGIN = 'web_research';

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// TTL (spec §3)
// ---------------------------------------------------------------------------

/**
 * @param {{origin: string, subtype?: string}} o
 * @returns {number} days until stale
 */
export function sectionTtlDays({ origin, subtype } = {}) {
  if (origin === 'rss') return 7; // "Sector news ... daily ... stale_after 7 days"
  if (origin === 'onbox_sql') {
    if (subtype === 'on_market_count') return 2; // "On-market counts ... 2 days"
    return 30; // "Our comps, cap-rate bands, trades ... 30 days (re-derived nightly)"
  }
  return 30;
}

/** ISO timestamp = fetchedAtIso + N days. */
export function staleAfterIso(fetchedAtIso, days) {
  const t = new Date(fetchedAtIso).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t + days * DAY_MS).toISOString();
}

// ---------------------------------------------------------------------------
// Numeric helpers
// ---------------------------------------------------------------------------

export function median(nums) {
  const xs = nums.filter((n) => Number.isFinite(n)).slice().sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

function quantile(sortedXs, q) {
  if (!sortedXs.length) return null;
  const pos = (sortedXs.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sortedXs[base + 1] !== undefined) {
    return sortedXs[base] + rest * (sortedXs[base + 1] - sortedXs[base]);
  }
  return sortedXs[base];
}

/** @returns {{n:number, median:number, q1:number, q3:number, iqr:number}|null} */
export function iqrStats(nums) {
  const xs = nums.filter((n) => Number.isFinite(n)).slice().sort((a, b) => a - b);
  if (!xs.length) return null;
  const q1 = quantile(xs, 0.25);
  const q3 = quantile(xs, 0.75);
  return { n: xs.length, median: median(xs), q1, q3, iqr: q3 - q1 };
}

function round(v, dp) {
  if (!Number.isFinite(v)) return null;
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

function pct1(v) {
  return round(v, 4); // cap rates stored as decimals per CLAUDE.md (7.5% -> 0.075)
}

// ---------------------------------------------------------------------------
// Fact builders — each returns a fact object (no id yet) or null when the
// input does not clear the emission bar (small-n, no data). Every returned
// fact carries fact_key (P-SQL identity), lane, section, origin='onbox_sql'.
// ---------------------------------------------------------------------------

/**
 * TTM cap-rate band (whole-market, or one operator segment).
 * @param {object} o
 * @param {string} o.lane
 * @param {number[]} o.capRates  decimal cap rates (0.0747 = 7.47%)
 * @param {string|null} [o.operator]  segment label, or null for whole-market
 * @param {string} o.sourceLabel  e.g. "cm_dialysis_cap_ttm_m" — internal citation
 * @param {string} o.asOfIso     fetched_at
 * @param {number} [o.minN]
 */
export function buildCapRateBandFact({ lane, capRates, operator = null, sourceLabel, asOfIso, minN = MIN_N_CAP_BAND }) {
  const stats = iqrStats(capRates || []);
  if (!stats || stats.n < minN) return null; // small-n suppression — never emit a thin band
  const segLabel = operator ? ` (${operator})` : '';
  const factKey = operator ? `cap_rate_ttm_band:${normKey(operator)}` : 'cap_rate_ttm_band';
  return {
    lane,
    section: 'capital_markets',
    claim_text: `TTM dialysis cap-rate band${segLabel}: median ${(stats.median * 100).toFixed(2)}%, `
      + `IQR ${(stats.q1 * 100).toFixed(2)}%–${(stats.q3 * 100).toFixed(2)}% (n=${stats.n}).`,
    value: pct1(stats.median),
    unit: 'decimal_cap_rate',
    source_url: null,
    source_title: sourceLabel,
    source_date: asOfIso.slice(0, 10),
    origin: 'onbox_sql',
    fact_kind: 'derived',
    fact_key: factKey,
    confidence: stats.n >= minN * 2 ? 0.85 : 0.6,
    _subtype: 'cap_rate_band',
    _n: stats.n,
  };
}

/** On-market count + median ask cap for the lane. */
export function buildOnMarketFacts({ lane, count, medianAskCap, sourceLabel, asOfIso }) {
  const facts = [];
  if (Number.isFinite(count)) {
    facts.push({
      lane,
      section: 'capital_markets',
      claim_text: `${count} dialysis properties currently on-market.`,
      value: count,
      unit: 'count',
      source_url: null,
      source_title: sourceLabel,
      source_date: asOfIso.slice(0, 10),
      origin: 'onbox_sql',
      fact_kind: 'reported',
      fact_key: 'on_market_count',
      confidence: 0.9,
      _subtype: 'on_market_count',
    });
  }
  if (Number.isFinite(medianAskCap)) {
    facts.push({
      lane,
      section: 'capital_markets',
      claim_text: `Median asking cap rate on-market: ${(medianAskCap * 100).toFixed(2)}%.`,
      value: pct1(medianAskCap),
      unit: 'decimal_cap_rate',
      source_url: null,
      source_title: sourceLabel,
      source_date: asOfIso.slice(0, 10),
      origin: 'onbox_sql',
      fact_kind: 'derived',
      fact_key: 'on_market_median_ask_cap',
      confidence: 0.8,
      _subtype: 'on_market_count',
    });
  }
  return facts;
}

/**
 * Trades since the producer's last run — one summary fact per run day (dated
 * identity, so re-running the same day supersedes rather than duplicating,
 * and a new day's window is naturally a new fact).
 */
export function buildTradesSinceLastRunFact({ lane, trades, sinceIso, sourceLabel, asOfIso }) {
  const list = Array.isArray(trades) ? trades : [];
  // A genuine zero is a real fact too, but it is a DIFFERENT claim shape
  // (buildTradesZeroFact) — kept separate so a caller cannot accidentally
  // template "0 sales" through the same interpolation as N>=1 sales.
  if (!list.length) return null;
  const prices = list.map((t) => Number(t.sold_price)).filter(Number.isFinite);
  const caps = list.map((t) => Number(t.cap_rate)).filter(Number.isFinite);
  const medPrice = median(prices);
  const medCap = median(caps);
  const dateStr = asOfIso.slice(0, 10);
  const windowStr = sinceIso ? ` since ${sinceIso.slice(0, 10)}` : '';
  let claim = `${list.length} dialysis sale${list.length === 1 ? '' : 's'} recorded${windowStr}.`;
  if (medPrice != null) claim += ` Median price $${Math.round(medPrice).toLocaleString('en-US')}.`;
  if (medCap != null) claim += ` Median cap ${(medCap * 100).toFixed(2)}%.`;
  return {
    lane,
    section: 'trades',
    claim_text: claim,
    value: list.length,
    unit: 'count',
    source_url: null,
    source_title: sourceLabel,
    source_date: dateStr,
    origin: 'onbox_sql',
    fact_kind: 'reported',
    fact_key: `trades_since_last_run:${dateStr}`,
    confidence: 0.9,
    _subtype: 'trades',
  };
}

/** Handles the genuine zero case honestly, separate from the "no trades array at all" guard above. */
export function buildTradesZeroFact({ lane, sinceIso, sourceLabel, asOfIso }) {
  const dateStr = asOfIso.slice(0, 10);
  const windowStr = sinceIso ? ` since ${sinceIso.slice(0, 10)}` : '';
  return {
    lane,
    section: 'trades',
    claim_text: `No dialysis sales recorded${windowStr}.`,
    value: 0,
    unit: 'count',
    source_url: null,
    source_title: sourceLabel,
    source_date: dateStr,
    origin: 'onbox_sql',
    fact_kind: 'reported',
    fact_key: `trades_since_last_run:${dateStr}`,
    confidence: 0.9,
    _subtype: 'trades',
  };
}

/**
 * CMS clinic counts by top operator, + a net-change fact vs. the prior run's
 * count (only emitted when a prior count exists — no baseline is not a "0
 * change" claim, it is missing data, and missing data is never fabricated as
 * zero).
 * @param {object} o
 * @param {{operator:string, count:number}[]} o.counts
 * @param {Map<string,number>} [o.priorCounts]  operator -> the count from the
 *   fact this run's fact will supersede, resolved by the caller (tick reads
 *   the currently-live fact's value before writing).
 */
export function buildCmsOperatorFacts({ lane, counts, priorCounts, sourceLabel, asOfIso }) {
  const facts = [];
  const dateStr = asOfIso.slice(0, 10);
  for (const row of counts || []) {
    const operator = String(row.operator || '').trim();
    const count = Number(row.count);
    if (!operator || !Number.isFinite(count)) continue;
    facts.push({
      lane,
      section: 'operators',
      claim_text: `${operator} operates ${count} dialysis clinic${count === 1 ? '' : 's'} in our CMS census.`,
      value: count,
      unit: 'count',
      source_url: null,
      source_title: sourceLabel,
      source_date: dateStr,
      origin: 'onbox_sql',
      fact_kind: 'reported',
      fact_key: `cms_clinic_count:${normKey(operator)}`,
      confidence: 0.9,
      _subtype: 'cms_clinic_count',
    });
    const prior = priorCounts instanceof Map ? priorCounts.get(operator) : undefined;
    if (Number.isFinite(prior) && prior !== count) {
      const delta = count - prior;
      facts.push({
        lane,
        section: 'operators',
        claim_text: `${operator}'s CMS clinic count ${delta > 0 ? 'grew' : 'fell'} by `
          + `${Math.abs(delta)} vs. the prior period (${prior} → ${count}).`,
        value: delta,
        unit: 'count_delta',
        source_url: null,
        source_title: sourceLabel,
        source_date: dateStr,
        origin: 'onbox_sql',
        fact_kind: 'derived',
        fact_key: `cms_clinic_net_change:${normKey(operator)}`,
        confidence: 0.75,
        _subtype: 'cms_clinic_net_change',
      });
    }
  }
  return facts;
}

function normKey(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

// ---------------------------------------------------------------------------
// Supersede / skip / conflict decision — pure, DB-free.
// ---------------------------------------------------------------------------

/**
 * Decide what to do with a candidate fact given whatever is currently LIVE
 * for the same (lane, section, fact_key).
 *
 * @param {object} o
 * @param {object|null} o.existingLive  the current live fact row for this
 *   fact_key (or null if none exists yet)
 * @param {object} o.candidate          the new fact object from a builder
 * @param {number} [o.tolerance]        relative-difference threshold for
 *   "materially different" (used by both the conflict and identical-skip
 *   paths)
 * @returns {{action: 'insert_new'|'skip_duplicate'|'supersede'|'conflict'}}
 */
export function decideFactWrite({ existingLive, candidate, tolerance = CONFLICT_TOLERANCE }) {
  if (!existingLive) return { action: 'insert_new' };

  const sameClaim = existingLive.claim_text === candidate.claim_text;
  const valuesClose = valuesAreClose(existingLive.value, candidate.value, tolerance);

  if (sameClaim && valuesClose) {
    // Re-running the same derivation against unchanged data — never
    // duplicate (P159a: a re-discovery tally is not throughput).
    return { action: 'skip_duplicate' };
  }

  if (existingLive.origin === CONFLICT_ORIGIN && !valuesClose) {
    // A seeded/P-WEB fact disagrees with what our own on-box derivation just
    // computed. Spec: "mark status 'conflict' on both, don't pick."
    return { action: 'conflict' };
  }

  // Ordinary case: our own prior derivation is stale/wrong, replace it.
  return { action: 'supersede' };
}

function valuesAreClose(a, b, tolerance) {
  if (a == null || b == null) return a === b;
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return String(a) === String(b);
  if (na === 0 && nb === 0) return true;
  const denom = Math.max(Math.abs(na), Math.abs(nb), 1e-9);
  return Math.abs(na - nb) / denom <= tolerance;
}

// ---------------------------------------------------------------------------
// RSS number-verbatim check (shared with market-brief-rss.js, kept here so
// both producers use one implementation of "is this number really on the
// page" — the same normaliser-drift rule CLAUDE.md warns about a dozen times).
// ---------------------------------------------------------------------------

/** Extract normalized numeric tokens (digits, optional decimal) from text. */
export function numericTokens(text) {
  const s = String(text || '');
  const matches = s.match(/\d[\d,]*\.?\d*/g) || [];
  return matches
    .map((m) => m.replace(/,/g, ''))
    .filter((m) => m.length > 0 && m !== '.');
}

/**
 * True only when EVERY number that appears in claimText also appears
 * (as a normalized numeric token) somewhere in sourceText. A claim with no
 * numbers at all trivially passes (nothing to verify) — this check exists to
 * catch a fabricated FIGURE, not to reject a qualitative claim.
 */
export function claimNumbersAreVerbatim(claimText, sourceText) {
  const claimNums = numericTokens(claimText);
  if (!claimNums.length) return true;
  const sourceNums = new Set(numericTokens(sourceText));
  return claimNums.every((n) => sourceNums.has(n));
}
