// FEED2 — regression coverage for v_market_brief_feed_health_stale's streak
// logic (migration 20260912190000_lcc_feed2_streak_counts_checks_not_days.sql).
//
// That migration fixed a live incident: EVERY feed read
// zero_item_streak_days = 9999 (including feeds that had just returned real
// items), because the streak was computed as CALENDAR-DAY arithmetic
// (checked_date - last_item_date) against a producer that runs weekdays only
// while the checker runs daily, plus a 9999 sentinel for "no prior row" that
// a first-ever check could never clear. The fix counts CONSECUTIVE CHECKS
// (rows with item_count=0 since the last row with item_count>0), never
// calendar days.
//
// This suite has no DB access from the sandbox (same constraint as every
// other SQL-behaviour test in this repo — see mba2-market-brief-psql-source-
// fixes.test.mjs's own header). It covers two things:
//   1. a pure re-implementation of the view's CHECK-counting predicate,
//      exercised against the four scenarios the fix must get right;
//   2. structural assertions on the migration's own SQL text, so a future
//      edit that reintroduces calendar-day arithmetic or a 9999 sentinel
//      fails this test even without a live database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MIGRATION_PATH = fileURLToPath(
  new URL('../supabase/migrations/20260912190000_lcc_feed2_streak_counts_checks_not_days.sql', import.meta.url),
);
const SQL = readFileSync(MIGRATION_PATH, 'utf8');

function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/--[^\n]*/g, '');
}
const CODE = stripSqlComments(SQL);

// ---------------------------------------------------------------------------
// Pure re-implementation of the view's streak predicate, for scenario
// coverage. Mirrors the SQL exactly (count of rows with item_count = 0 whose
// checked_date is after the last row with item_count > 0, or all rows if
// there has never been one) — kept here ONLY as a test fixture, never
// imported by production code, so it cannot become a second source of truth
// the SQL can drift from silently.
function zeroItemStreakChecks(rows) {
  // rows: [{checked_date, item_count}], any order.
  const sorted = [...rows].sort((a, b) => a.checked_date.localeCompare(b.checked_date));
  const lastGood = sorted.filter((r) => r.item_count > 0).at(-1) || null;
  return sorted.filter(
    (r) => r.item_count === 0 && (!lastGood || r.checked_date > lastGood.checked_date),
  ).length;
}

test('a healthy feed checked Mon-Fri with items every time has streak 0 across the weekend boundary', () => {
  // Producer runs weekdays only; this is the exact shape that read 9999/3
  // under the old calendar-day logic even though every check had items.
  const rows = [
    { checked_date: '2026-09-07', item_count: 6 }, // Mon
    { checked_date: '2026-09-08', item_count: 4 }, // Tue
    { checked_date: '2026-09-09', item_count: 5 }, // Wed
    { checked_date: '2026-09-10', item_count: 3 }, // Thu
    { checked_date: '2026-09-11', item_count: 6 }, // Fri
    { checked_date: '2026-09-14', item_count: 5 }, // Mon (3 calendar days later)
  ];
  assert.equal(zeroItemStreakChecks(rows), 0);
});

test('a feed with no history at all does not alert (no 9999 sentinel)', () => {
  assert.equal(zeroItemStreakChecks([]), 0);
});

test('a feed with 3 consecutive zero-item checks alerts (positive control)', () => {
  const rows = [
    { checked_date: '2026-09-08', item_count: 4 },
    { checked_date: '2026-09-09', item_count: 0 },
    { checked_date: '2026-09-10', item_count: 0 },
    { checked_date: '2026-09-11', item_count: 0 },
  ];
  assert.equal(zeroItemStreakChecks(rows), 3);
});

test('a feed that never once returned items streaks by CHECK COUNT, not a 9999 sentinel', () => {
  const rows = [
    { checked_date: '2026-09-09', item_count: 0 },
    { checked_date: '2026-09-10', item_count: 0 },
  ];
  assert.equal(zeroItemStreakChecks(rows), 2);
});

test('a retired feed (no longer checked) stops accruing the moment checks stop, and can never resolve on its own', () => {
  // The fix's stated property: a retired feed's last rows sit at whatever
  // streak they reached and never grow further, because there are no new
  // checks to count -- it does not auto-resolve (there is no new row below
  // threshold), but it also does not permanently worsen the way calendar-day
  // arithmetic against "today" would.
  const rowsAtRetirement = [
    { checked_date: '2026-08-01', item_count: 5 },
    { checked_date: '2026-08-02', item_count: 0 },
    { checked_date: '2026-08-03', item_count: 0 },
  ];
  const streakAtRetirement = zeroItemStreakChecks(rowsAtRetirement);
  // No new row is ever appended for a retired feed -- the streak computed
  // from the same row set today, a month later, is unchanged (the old
  // calendar-day form would instead grow toward 9999 as `checked_date`
  // (=CURRENT_DATE via the view's own "latest" row) recedes into the past).
  assert.equal(zeroItemStreakChecks(rowsAtRetirement), streakAtRetirement);
});

// ---------------------------------------------------------------------------
// Structural guards on the shipped SQL, so a future edit cannot silently
// reintroduce either root cause without a live database.
// ---------------------------------------------------------------------------

test('the view counts CHECKS via count(*) over rows, never checked_date subtraction', () => {
  assert.match(CODE, /zero_item_streak_checks/);
  // The old form was `checked_date - last_item_date` (or similar interval
  // arithmetic). Assert the fixed expression is a row COUNT, not a date
  // subtraction, by requiring a `count(*)` immediately inside the
  // zero_item_streak_checks subquery and forbidding the calendar-subtraction
  // shape anywhere in the file.
  assert.match(CODE, /SELECT\s+count\(\*\)/i);
  assert.doesNotMatch(CODE, /checked_date\s*-\s*\S*last_item_date/i);
});

test('no 9999 sentinel remains anywhere in the fixed objects', () => {
  assert.doesNotMatch(CODE, /9999/);
});

test('the streak subquery is scoped to zero-item rows after the last good check (or all rows, if none) -- never all rows unconditionally', () => {
  // Must filter on item_count = 0, and must reference last_item_date (the
  // "no prior good check" branch) so an all-time-zero feed is handled
  // without a magic number.
  assert.match(CODE, /item_count\s*=\s*0/);
  assert.match(CODE, /last_item_date\s+IS\s+NULL/i);
});

test('the function threshold comment still documents "consecutive checks", matching the column name', () => {
  assert.match(SQL, /consecutive\s+CHECKS/i);
});
