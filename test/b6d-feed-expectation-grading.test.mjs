// B6d — retiring an expectation must CLOSE its alert, and must not be inferred
// from ABSENCE.
//
// WHAT THIS PINS, AND WHY IT IS ANCHORED THE WAY IT IS.
//
// B6a made producers visible; B6a-follow-up made them alertable; B6b restarted
// the one worth restarting and B6b-lead deliberately refused the other. That
// refusal is what created the defect this guards: an expectation nobody chose
// describes a DECISION, and lcc_check_feed_freshness could not close it. Its
// auto-resolve arm requires the feed to be PRESENT in _ff_cur and not stale, so
// a feed whose expectation is retired -- and which therefore leaves the surface
// -- can never satisfy it. B6c-dup retired property_sale_events by setting
// is_active = false on 2026-08-29 and stranded alert 5376 permanently.
//
// The three failures below are DIFFERENT and a naive fix trips one of them:
//
//   * Resolve on ABSENCE and a feed that vanished because its query ERRORED, or
//     because its domain mirror went blind, closes as "fine" -- "I cannot see
//     this feed" rendering as "this feed is healthy", the exact confusion the
//     _ff_blind machinery exists to prevent. Hence the arm keys on a POSITIVE
//     NULL bound in a snapshot we currently trust.
//   * Read the NULL bound from a STALE mirror and a retirement someone reverted
//     hours ago still closes today's alert. Hence the synced_at freshness guard
//     inside _ff_unwatched.
//   * Auto-resolve the residual (deregistered / hard-deleted) case and a
//     disappearance closes identically to a decision. Hence it is COUNTED as
//     alerts_orphaned and never updated.
//
// (!) COMMENTS ARE STRIPPED BEFORE MATCHING. Both B6d migration headers quote
// the OLD resolve arm, the phrase "is_active = false" and the words
// "auto-resolve" at length while EXPLAINING the fix, so a naive grep would match
// the prose documenting the guard and pass over its deletion. That is the
// A5c/N18 defect (a source detector reporting the bug it just removed), inside a
// test.
//
// Assertions anchor on FUNCTION, TABLE and COLUMN names and on stable
// structural boundaries (a function's own CREATE ... $function$), never on a
// line number and never on a banner-delimited region (the block-slice footgun).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const LCC_DIR = 'supabase/migrations';
const lccFiles = readdirSync(LCC_DIR).filter((f) => f.includes('b6d'));
assert.ok(lccFiles.length >= 2, 'the two B6d LCC migrations must be committed');

const RAW = lccFiles.map((f) => readFileSync(`${LCC_DIR}/${f}`, 'utf8')).join('\n');

// Executable SQL only -- see the header.
const strip = (s) => s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const SQL = strip(RAW);

// A function body bounded by its own CREATE and its terminating $function$ --
// a STABLE structural boundary, not a banner comment.
function bodyOf(fnName, sql = SQL) {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fnName}`);
  assert.notEqual(start, -1, `${fnName} is not defined in the B6d migrations`);
  const end = sql.indexOf('$function$;', start);
  assert.notEqual(end, -1, `${fnName} body is not terminated`);
  return sql.slice(start, end);
}

test('a retired expectation is a NULL bound on an EMITTED row, never a deletion', () => {
  const body = bodyOf('compute_feed_freshness');
  assert.ok(/IF r\.expected_max_age_days IS NULL THEN/.test(body),
    'compute_feed_freshness must branch on a NULL bound; without it a retired feed '
    + 'either vanishes from the surface or is reported as stale against a NULL');
  assert.ok(/status := 'unwatched'/.test(body),
    "an unwatched feed must SAY so; a silent NULL is_stale is the absence problem again");

  // The retirement mechanism B6d replaces. is_active = false drops the feed off
  // v_feed_freshness entirely, which is what stranded alert 5376.
  assert.ok(!/is_active\s*=\s*false/i.test(SQL),
    'a B6d migration must not retire a feed with is_active = false -- that removes it '
    + 'from the surface and strands its open alert with no reason attached');
});

test('an ERRORING feed keeps its bound, so it can never be read as retired', () => {
  const body = bodyOf('compute_feed_freshness');
  const assignIdx = body.indexOf('expected_max_age_days := r.expected_max_age_days');
  const tryIdx = body.indexOf('BEGIN', body.indexOf('LOOP'));
  assert.notEqual(assignIdx, -1, 'the bound must be carried onto the output row');
  assert.ok(assignIdx < tryIdx,
    'the bound must be assigned BEFORE the per-feed exception block. If a feed whose '
    + 'query throws came out with a NULL bound it would be indistinguishable from a '
    + 'deliberately retired one, and the unwatched-resolve arm would close its alert');
});

test('the unwatched-resolve arm exists and keys on a POSITIVE NULL bound', () => {
  const body = bodyOf('lcc_check_feed_freshness');
  assert.ok(/CREATE TEMP TABLE _ff_unwatched/.test(body),
    'the set of deliberately-unwatched feeds must be built explicitly');
  assert.ok(/expected_max_age_days IS NULL/.test(body),
    'retirement is signalled by a NULL bound, never inferred from absence');
  assert.ok(/_ff_unwatched u WHERE u\.source_key = a\.source/.test(body),
    'the resolve arm must key on the unwatched set');
  assert.ok(/unwatched_alerts_resolved/.test(body),
    'the count must be reported -- a resolve nobody can see is the failure this arc exists to remove');
  assert.ok(/resolved_note = 'Auto-resolved \(B6d\)/.test(body),
    'the note must say WHY the alert closed; closing with the generic '
    + '"feed refreshed within SLA" note would be a false statement about the feed');
});

test('the unwatched set is read only from a mirror we currently trust', () => {
  const body = bodyOf('lcc_check_feed_freshness');
  const start = body.indexOf('CREATE TEMP TABLE _ff_unwatched');
  const end = body.indexOf('CREATE TEMP TABLE _ff_blind');
  assert.ok(start !== -1 && end > start, '_ff_unwatched must precede _ff_blind');
  const block = body.slice(start, end);
  assert.ok(/synced_at > now\(\) - p_mirror_max_age/.test(block),
    'the domain arm must require a FRESH mirror row. Reading a NULL bound out of a '
    + 'stale snapshot would close today alert on a retirement that may since have been reverted');
  assert.ok(/feed_freshness_registry/.test(block),
    'the lcc_local arm reads the registry directly -- an unwatched LCC-local feed carries '
    + "status = 'unwatched', so the lcc_local arm of _ff_cur (which filters status = 'ok') "
    + 'cannot see it');
});

test('the residual case is COUNTED, never auto-resolved', () => {
  const body = bodyOf('lcc_check_feed_freshness');
  assert.ok(/alerts_orphaned/.test(body) && /orphaned_alerts/.test(body),
    'an alert whose feed is neither evaluable nor explicitly unwatched must be reported');

  // It must be a SELECT ... INTO, not an UPDATE. A decision and a disappearance
  // are not the same fact and must not close identically.
  const orphanIdx = body.indexOf('INTO v_orphaned, v_orphans');
  assert.notEqual(orphanIdx, -1, 'the orphan count must be selected into a variable');
  const stmtStart = body.lastIndexOf('SELECT count(*)', orphanIdx);
  assert.ok(stmtStart !== -1 && stmtStart < orphanIdx,
    'the orphan census must be a SELECT');
  assert.ok(!/SET resolved_at = now\(\)[\s\S]{0,400}NOT EXISTS \(SELECT 1 FROM _ff_unwatched/.test(body),
    'the orphaned set must never be auto-resolved: we cannot tell a deliberate '
    + 'deregistration from a row that silently disappeared');
});

test('B6a-follow-up invariants survive the rewrite', () => {
  const body = bodyOf('lcc_check_feed_freshness');
  // B6d rewrites this whole function, so it is exactly where B6a's two halves
  // could be dropped by accident.
  // (!) ANCHORED ON THE CTE. B6d added _ff_unwatched, which legitimately carries
  // the same freshness predicate, so after this change the body contains it THREE
  // times and a whole-body grep stays green when the one in domain_mirror is
  // deleted -- verified: that exact mutation passed. Same defect as the
  // feed_mirror_stale literal above, found the same way.
  const mirrorCte = body.slice(body.indexOf('domain_mirror AS ('),
                               body.indexOf('SELECT u.dom, u.feed_name'));
  assert.ok(mirrorCte.length > 0, 'the domain_mirror CTE must exist');
  assert.ok(/synced_at > now\(\) - p_mirror_max_age/.test(mirrorCte),
    'the 3-day mirror exclusion must survive INSIDE domain_mirror -- evaluating an '
    + 'untrustworthy mirror emits alerts about ages it cannot vouch for');
  // (!) ANCHORED ON THE BRANCH, NOT ON THE LITERAL. 'feed_mirror_stale' appears
  // in BOTH the insert and its auto-resolve arm, so a file-wide grep for it stays
  // green when the INSERT is deleted -- verified: that exact mutation passed the
  // first cut of this test. This is the B6c-dup finding (a grep for a predicate
  // that legitimately appears twice is not a guard) reproduced inside a guard
  // written after it was documented.
  assert.ok(/INSERT INTO public\.lcc_health_alerts[^;]*?SELECT 'feed_mirror_stale'/s.test(body),
    'the monitor must still INSERT its own-blindness alert; keeping the 3-day exclusion '
    + 'without it is how the surface went silent for 33 days');
  assert.ok(/a\.alert_kind = 'feed_mirror_stale' AND a\.resolved_at IS NULL/.test(body),
    'and it must still auto-resolve when a fresh snapshot lands, or the blindness alert '
    + 'becomes the permanently-open row this round exists to remove');
  assert.ok(/feeds_excluded_stale_mirror/.test(body),
    'the excluded count must still be reported');
});

test('a bound must be justified and an absent bound explained', () => {
  assert.ok(/chk_ffr_expectation_is_reasoned/.test(SQL),
    'a numeric bound with no expectation_basis is a default wearing a decision clothes');
  assert.ok(/expected_max_age_days IS NULL\s+AND unwatched_reason\s+IS NOT NULL/.test(SQL),
    'retiring an expectation must record WHY, or the retirement is a silent deletion');
  assert.ok(/chk_ffr_operator_driven_unwatched/.test(SQL),
    'rule 3a: an operator-driven surface cannot carry a calendar bound');
});
