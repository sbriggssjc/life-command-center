// ============================================================================
// api/_shared/market-brief-render.js — MB-b: pure fact-selection/diff helpers
// + the DB-touching fetch/freeze functions for the daily "Lane Briefs" email
// block (spec §1/MB3) and the homepage Market Briefs tab (spec §2/MB4).
//
// SELECTION AND HTML ARE SEPARATE. This module never renders HTML — it
// decides WHICH facts a render should show and freezes the fact-set an
// issue used. The HTML itself is built by the caller (briefing-email-
// handler.js's renderMarketBriefLanes, or the /api/market-brief-issue
// handler for the homepage tab) using its own escaping/styling helpers —
// keeping ONE copy of those, per CLAUDE.md's normaliser-drift rule, rather
// than a second styled copy living in this shared module.
//
// EVERY NUMBER RENDERED MUST COME FROM A FACT OBJECT. This module never
// computes a new number from a fact's `value` — it only selects, sorts and
// diffs fact ROWS as returned by v_market_brief_live / market_brief_facts.
// ============================================================================

import { opsQuery } from './ops-db.js';

// Mirrors the EB1 migration's chk_mbf_lane CHECK constraint — the only
// lanes a fact/issue row can carry. Only 'dialysis' has a live producer
// today (MB-a); the others render as omitted-empty lanes until their
// producers exist (spec §3 "What NOT to do": no new gov/NL lanes here).
export const KNOWN_LANES = ['dialysis', 'government', 'net_lease', 'broad_net_lease'];

export const LANE_LABELS = {
  dialysis: 'Dialysis',
  government: 'Government-Leased',
  net_lease: 'Net Lease',
  broad_net_lease: 'Broad Net Lease',
};

// Ranks which section's facts lead the "2-3 most material" selection (spec
// exemplar order §2: operators, policy, capital markets, trades,
// implications). A gap_marker fact (unit='gap_marker', see
// market-brief-facts.js::buildCmsOperatorFacts) is never a "top fact" — it
// is a named absence, rendered in its own freshness-badge slot instead.
export const TOP_FACT_SECTION_WEIGHT = {
  capital_markets: 4,
  operators: 3,
  trades: 2,
  policy: 2,
  implications: 1,
};

export const TOP_FACTS_LIMIT = 3;

/** True for a fact whose unit marks it as a named gap rather than a live claim. */
export function isGapFact(fact) {
  return !!fact && fact.unit === 'gap_marker';
}

/**
 * Select the 2-3 most material live, non-gap facts for a lane's email
 * block — section-weighted, most-recently-fetched first within a weight
 * tier. Pure: takes the fact rows already read from v_market_brief_live,
 * returns a SUBSET of those same objects (never a derived/computed one).
 */
export function selectTopFacts(facts, limit = TOP_FACTS_LIMIT) {
  const real = (facts || []).filter((f) => !isGapFact(f));
  return real
    .slice()
    .sort((a, b) => {
      const wa = TOP_FACT_SECTION_WEIGHT[a.section] || 0;
      const wb = TOP_FACT_SECTION_WEIGHT[b.section] || 0;
      if (wb !== wa) return wb - wa;
      const ta = a.fetched_at ? new Date(a.fetched_at).getTime() : 0;
      const tb = b.fetched_at ? new Date(b.fetched_at).getTime() : 0;
      return tb - ta;
    })
    .slice(0, limit);
}

/** Every named gap in a lane's live facts (spec §1: "freshness badges — named gaps render plainly"). */
export function selectGapFacts(facts) {
  return (facts || []).filter(isGapFact);
}

/**
 * Fact-set diff between today's candidate fact ids and the prior daily
 * issue's frozen fact ids (spec §1/contract: "a fact-set diff, not an LLM
 * guess"). Pure — takes two arrays of {fact_id, claim_text} already resolved
 * by the caller (a superseded/expired fact's claim_text still has to come
 * from a real row lookup, never invented here).
 *
 * The contract's `action` enum is `added|superseded|expired`; this diff
 * cannot distinguish superseded from expired from the fact_id sets alone
 * (both simply drop out of "currently live"), so it reports the honest,
 * coarser `superseded_or_expired` rather than guessing which — stated
 * explicitly rather than silently picking one.
 */
export function diffFactSets({ priorFacts = [], currentFacts = [] }) {
  const priorIds = new Set((priorFacts || []).map((f) => f.fact_id));
  const currentIds = new Set((currentFacts || []).map((f) => f.fact_id));
  const changes = [];
  for (const f of currentFacts || []) {
    if (!priorIds.has(f.fact_id)) changes.push({ fact_id: f.fact_id, claim_text: f.claim_text, section: f.section, action: 'added' });
  }
  for (const f of priorFacts || []) {
    if (!currentIds.has(f.fact_id)) changes.push({ fact_id: f.fact_id, claim_text: f.claim_text, section: f.section, action: 'superseded_or_expired' });
  }
  return changes;
}

// ---------------------------------------------------------------------------
// DB-touching reads/writes. Every function below fails soft (empty result),
// never throws — this feeds an email render, and one lane's DB hiccup must
// never blank the whole briefing (the same `safe()` fail-soft contract every
// other briefing-data.js fetcher follows).
// ---------------------------------------------------------------------------

/** Live, non-expired facts for one lane, newest-fetched first. Reads v_market_brief_live ONLY — never recomputes anything. */
export async function fetchLaneLiveFacts(lane, limit = 200) {
  const r = await opsQuery('GET',
    `v_market_brief_live?lane=eq.${encodeURIComponent(lane)}&order=fetched_at.desc&limit=${limit}`,
    undefined, { countMode: 'none' }).catch(() => null);
  if (!r || !r.ok || !Array.isArray(r.data)) return [];
  return r.data;
}

/** The most recent FROZEN daily issue for a lane, strictly before `beforeDate` (YYYY-MM-DD). */
async function fetchPriorDailyIssue(lane, beforeDate) {
  const r = await opsQuery('GET',
    `market_brief_issues?lane=eq.${encodeURIComponent(lane)}&issue_type=eq.daily`
    + `&issue_date=lt.${encodeURIComponent(beforeDate)}&order=issue_date.desc&limit=1`
    + '&select=id,issue_date,fact_ids',
    undefined, { countMode: 'none' }).catch(() => null);
  if (!r || !r.ok || !Array.isArray(r.data) || !r.data.length) return null;
  return r.data[0];
}

/** Resolve a list of fact ids to {fact_id, claim_text, section} rows (any status — a superseded fact still has a claim_text). */
async function resolveFactIdsToClaims(factIds) {
  const ids = Array.from(new Set((factIds || []).filter(Boolean)));
  if (!ids.length) return [];
  const r = await opsQuery('GET',
    `market_brief_facts?id=in.(${ids.map(encodeURIComponent).join(',')})&select=id,claim_text,section`,
    undefined, { countMode: 'none' }).catch(() => null);
  if (!r || !r.ok || !Array.isArray(r.data)) return [];
  return r.data.map((row) => ({ fact_id: row.id, claim_text: row.claim_text, section: row.section }));
}

/**
 * Build one lane's context for the daily Lane Briefs block: live facts,
 * top facts, gap facts, and the diff against the prior daily issue.
 * `asOfDate` is YYYY-MM-DD (the run's own "today", so the diff and the
 * freeze below use the SAME date consistently).
 */
export async function buildLaneBriefContext(lane, asOfDate) {
  const liveFacts = await fetchLaneLiveFacts(lane);
  if (!liveFacts.length) return { lane, hasFacts: false };

  const currentFacts = liveFacts.map((f) => ({ fact_id: f.id, claim_text: f.claim_text, section: f.section }));
  const priorIssue = await fetchPriorDailyIssue(lane, asOfDate);
  const priorFacts = priorIssue ? await resolveFactIdsToClaims(priorIssue.fact_ids) : [];

  return {
    lane,
    hasFacts: true,
    liveFacts,
    topFacts: selectTopFacts(liveFacts),
    gapFacts: selectGapFacts(liveFacts),
    changedSinceYesterday: diffFactSets({ priorFacts, currentFacts }),
    factIds: liveFacts.map((f) => f.id),
  };
}

/**
 * Freeze a `market_brief_issues` row for (lane, 'daily', issueDate) with
 * the fact ids this render used (spec §1: "Each render freezes a
 * market_brief_issues row"). Upserts on the EB1 unique index
 * (lane, issue_type, issue_date) — a second render the SAME day replaces
 * the frozen set rather than duplicating (issue-freeze idempotency,
 * spec §4 guard list). Never called for a lane with no live facts — an
 * empty-lane render is omitted, not frozen as an empty issue.
 */
export async function freezeDailyIssue({ lane, issueDate, factIds, generatedBy = 'renderer_market_brief_lane_briefs' }) {
  if (!factIds || !factIds.length) return { ok: false, skipped: 'no_facts' };
  const r = await opsQuery('POST', 'market_brief_issues?on_conflict=lane,issue_type,issue_date', {
    lane, issue_type: 'daily', issue_date: issueDate, fact_ids: factIds, generated_by: generatedBy,
  }, { headers: { Prefer: 'resolution=merge-duplicates,return=representation' } }).catch((err) => ({ ok: false, error: err?.message || String(err) }));
  return r;
}

/**
 * Build every lane's context (spec §3: "no new gov/NL lanes until their
 * producers exist" — a lane with no live facts is simply not included,
 * never rendered as an empty section). Used by both the email block and
 * the homepage tab.
 */
export async function buildAllLaneBriefContexts(asOfDate, lanes = KNOWN_LANES) {
  const results = await Promise.all(lanes.map((lane) => buildLaneBriefContext(lane, asOfDate).catch(() => ({ lane, hasFacts: false }))));
  return results.filter((r) => r && r.hasFacts);
}

// ---------------------------------------------------------------------------
// MB-b — homepage Market Briefs tab (spec §2/MB4). Read-only: shares the
// same live-facts fetch as the email block, plus the issue archive.
// ---------------------------------------------------------------------------

// Exemplar section order (spec §2): operators, policy, capital markets,
// trades, implications.
export const LANE_SECTIONS_ORDER = ['operators', 'policy', 'capital_markets', 'trades', 'implications'];

/**
 * Live facts for one lane, grouped by section, each carrying its own
 * citation (`source_url`/`source_title`/`source_date`) and staleness
 * (`is_stale`, computed by v_market_brief_live, never re-derived here).
 */
export function groupFactsBySection(facts) {
  const bySection = {};
  for (const s of LANE_SECTIONS_ORDER) bySection[s] = [];
  for (const f of facts || []) {
    if (!bySection[f.section]) bySection[f.section] = [];
    bySection[f.section].push(f);
  }
  return bySection;
}

/** The issue archive for one lane (both daily and weekly issues), newest first. */
export async function fetchIssueArchive(lane, limit = 30) {
  const r = await opsQuery('GET',
    `market_brief_issues?lane=eq.${encodeURIComponent(lane)}&order=issue_date.desc&limit=${limit}`
    + '&select=id,issue_type,issue_date,fact_ids,summary,generated_by,created_at',
    undefined, { countMode: 'none' }).catch(() => null);
  if (!r || !r.ok || !Array.isArray(r.data)) return [];
  return r.data;
}

/**
 * Full homepage-tab context for one lane: live facts by section, the issue
 * archive, and a "changed since" highlight between the two most recent
 * daily issues (the same diffFactSets the email block uses — one diff
 * implementation, not two).
 */
export async function buildLaneTabContext(lane) {
  const [liveFacts, archive] = await Promise.all([
    fetchLaneLiveFacts(lane),
    fetchIssueArchive(lane),
  ]);
  const dailyIssues = archive.filter((i) => i.issue_type === 'daily');
  let changedSinceLastIssue = [];
  if (dailyIssues.length >= 2) {
    const [current, prior] = dailyIssues;
    const [currentFacts, priorFacts] = await Promise.all([
      resolveFactIdsToClaims(current.fact_ids),
      resolveFactIdsToClaims(prior.fact_ids),
    ]);
    changedSinceLastIssue = diffFactSets({ priorFacts, currentFacts });
  }
  return {
    lane,
    hasFacts: liveFacts.length > 0,
    sections: groupFactsBySection(liveFacts),
    archive,
    changedSinceLastIssue,
  };
}
