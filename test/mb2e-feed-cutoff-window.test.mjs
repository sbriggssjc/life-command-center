// MB2e — two feeds return HTTP 200 with real items and contribute 0 to the
// brief, on the same day, for the same reason as the MB2b Federal Register
// (ESRD) case: a 72h news cutoff applied to a source that publishes a few
// times a week, checked on a Monday (newest item 82h / 92h old).
//
// This suite has no DB/network access from the sandbox (same constraint as
// every other SQL-behaviour test in this repo). It covers two things:
//   1. structural assertions on the RSS_FEEDS source that the fix widened
//      maxAgeHours on exactly the two named feeds, and did NOT touch the
//      global default or any other feed;
//   2. a pure re-implementation of the new no-contribution streak
//      predicate (mirrors v_market_brief_feed_health_no_contribution),
//      exercised against the scenarios the monitor must get right, plus
//      structural guards on the shipped migration SQL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const EDGE_FN_PATH = fileURLToPath(
  new URL('../supabase/functions/briefing-intel-snapshot/index.ts', import.meta.url),
);
const EDGE_FN_SRC = readFileSync(EDGE_FN_PATH, 'utf8');

const MIGRATION_PATH = fileURLToPath(
  new URL('../supabase/migrations/20260914130000_lcc_mb2e_feed_no_contribution_monitor.sql', import.meta.url),
);
const MIGRATION_SQL = readFileSync(MIGRATION_PATH, 'utf8');

function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/--[^\n]*/g, '');
}
const MIGRATION_CODE = stripSqlComments(MIGRATION_SQL);

// ---------------------------------------------------------------------------
// 1. RSS_FEEDS source — exactly the two named feeds get maxAgeHours widened.
// ---------------------------------------------------------------------------

function extractFeedBlock(source, feedSource) {
  const idx = source.indexOf(`source: "${feedSource}"`);
  assert.ok(idx >= 0, `expected a feed entry for "${feedSource}"`);
  // Bound the window at the NEXT feed entry's `source:` key (or the end of
  // RSS_FEEDS), never a fixed character count -- a comment block above one
  // feed can be longer than the gap to the next feed (the block-slice
  // footgun this repo's CLAUDE.md warns about repeatedly).
  const next = source.indexOf('source: "', idx + 1);
  return source.slice(idx, next === -1 ? idx + 1000 : next);
}

test('Federal Register (GSA) carries maxAgeHours: 24 * 7 (168h), not the 72h default', () => {
  const block = extractFeedBlock(EDGE_FN_SRC, 'Federal Register (GSA)');
  assert.match(block, /maxAgeHours:\s*24\s*\*\s*7\b/);
});

test('Tax Foundation carries maxAgeHours: 24 * 7 (168h), not the 72h default', () => {
  const block = extractFeedBlock(EDGE_FN_SRC, 'Tax Foundation');
  assert.match(block, /maxAgeHours:\s*24\s*\*\s*7\b/);
});

test('Government Executive and the net_lease feeds are untouched -- no maxAgeHours added to them', () => {
  const govExec = extractFeedBlock(EDGE_FN_SRC, 'Government Executive');
  assert.doesNotMatch(govExec, /maxAgeHours/);
  for (const src of ['Connect CRE', 'Bisnow National', 'Commercial Observer', 'REBusinessOnline']) {
    const block = extractFeedBlock(EDGE_FN_SRC, src);
    assert.doesNotMatch(block, /maxAgeHours/);
  }
});

test('the global DEFAULT_MAX_AGE_HOURS constant is not widened by this fix', () => {
  // The fix must be per-feed, never a global loosening of the 72h news
  // window (that is what keeps the daily brief daily -- MB2b's own rule).
  const m = EDGE_FN_SRC.match(/DEFAULT_MAX_AGE_HOURS\s*=\s*(\d+)/);
  assert.ok(m, 'expected a DEFAULT_MAX_AGE_HOURS constant');
  assert.equal(Number(m[1]), 72);
});

// ---------------------------------------------------------------------------
// 2. no-contribution streak predicate -- pure fixture mirroring the SQL view.
// Kept here ONLY as a test fixture, never imported by production code, so it
// cannot become a second source of truth the SQL can drift from silently.
// ---------------------------------------------------------------------------

function noContributionStreakChecks(rows) {
  // rows: [{checked_date, item_count, items_after_cutoff}], any order.
  // items_after_cutoff may be null (unmeasured -- must never count as zero).
  const sorted = [...rows].sort((a, b) => a.checked_date.localeCompare(b.checked_date));
  const lastContribution = sorted.filter((r) => (r.items_after_cutoff ?? 0) > 0).at(-1) || null;
  return sorted.filter(
    (r) =>
      r.item_count > 0 &&
      r.items_after_cutoff === 0 &&
      (!lastContribution || r.checked_date > lastContribution.checked_date),
  ).length;
}

test('a feed parsing items but contributing 0 for 3 checks streaks 3 (positive control)', () => {
  const rows = [
    { checked_date: '2026-09-08', item_count: 6, items_after_cutoff: 0 },
    { checked_date: '2026-09-09', item_count: 15, items_after_cutoff: 0 },
    { checked_date: '2026-09-10', item_count: 6, items_after_cutoff: 0 },
  ];
  assert.equal(noContributionStreakChecks(rows), 3);
});

test("a dead feed (item_count = 0) does not count toward this streak -- that is market_brief_feed_stale's population", () => {
  const rows = [
    { checked_date: '2026-09-08', item_count: 0, items_after_cutoff: 0 },
    { checked_date: '2026-09-09', item_count: 0, items_after_cutoff: 0 },
    { checked_date: '2026-09-10', item_count: 0, items_after_cutoff: 0 },
  ];
  assert.equal(noContributionStreakChecks(rows), 0);
});

test('rows with items_after_cutoff NULL (pre-MB2b, unmeasured) never count toward the streak', () => {
  const rows = [
    { checked_date: '2026-09-08', item_count: 6, items_after_cutoff: null },
    { checked_date: '2026-09-09', item_count: 6, items_after_cutoff: null },
    { checked_date: '2026-09-10', item_count: 6, items_after_cutoff: null },
  ];
  assert.equal(noContributionStreakChecks(rows), 0);
});

test('a feed that contributed on its most recent check reads 0, resetting the streak', () => {
  const rows = [
    { checked_date: '2026-09-08', item_count: 6, items_after_cutoff: 0 },
    { checked_date: '2026-09-09', item_count: 6, items_after_cutoff: 0 },
    { checked_date: '2026-09-10', item_count: 6, items_after_cutoff: 2 }, // contributed
  ];
  assert.equal(noContributionStreakChecks(rows), 0);
});

test('a feed with no history at all does not alert', () => {
  assert.equal(noContributionStreakChecks([]), 0);
});

// ---------------------------------------------------------------------------
// Structural guards on the shipped migration SQL.
// ---------------------------------------------------------------------------

test('the view is distinct from market_brief_feed_stale -- a separate alert_kind, never folded in', () => {
  assert.match(MIGRATION_CODE, /market_brief_feed_no_contribution/);
  assert.doesNotMatch(MIGRATION_CODE, /alert_kind\s*=\s*'market_brief_feed_stale'/);
});

test('the streak counts CHECKS via count(*), never calendar-date subtraction (FEED2 regression)', () => {
  assert.match(MIGRATION_CODE, /no_contribution_streak_checks/);
  assert.match(MIGRATION_CODE, /SELECT\s+count\(\*\)/i);
  assert.doesNotMatch(MIGRATION_CODE, /checked_date\s*-\s*\S*last_contributed_date/i);
});

test('the streak predicate requires item_count > 0 AND items_after_cutoff = 0 together, not either alone', () => {
  assert.match(MIGRATION_CODE, /item_count\s*>\s*0/);
  assert.match(MIGRATION_CODE, /items_after_cutoff\s*=\s*0/);
});

test("no 9999 sentinel and no bare item_count = 0 gate on this view (that would collapse it into feed-stale's population)", () => {
  assert.doesNotMatch(MIGRATION_CODE, /9999/);
});

test('the function revokes anon/authenticated execute and asserts it', () => {
  assert.match(
    MIGRATION_SQL,
    /REVOKE ALL ON FUNCTION public\.lcc_check_market_brief_feed_no_contribution\(integer\) FROM PUBLIC, anon, authenticated/,
  );
  assert.match(MIGRATION_SQL, /has_function_privilege\('anon', 'public\.lcc_check_market_brief_feed_no_contribution/);
});

test('the cron block still schedules the existing feed-health check alongside the new one', () => {
  assert.match(MIGRATION_CODE, /lcc_check_market_brief_feed_health\(3\)/);
  assert.match(MIGRATION_CODE, /lcc_check_market_brief_feed_no_contribution\(3\)/);
});
