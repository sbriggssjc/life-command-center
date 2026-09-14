// B6a-follow-up — the freshness monitor must ALERT ON ITS OWN BLINDNESS.
//
// WHAT THIS PINS, AND WHY IT IS ANCHORED THE WAY IT IS.
//
// For a month, gov's v_feed_freshness was correct, crons 140/141 recorded
// `succeeded` daily, and LCC opened ZERO alerts over five stale gov feeds. Three
// layers, each reporting success:
//
//   * lcc_finalize_feed_freshness consumed only status_code = 200 and dropped
//     everything else, returning (0,0) -- identical to "nothing to do";
//   * lcc_check_feed_freshness excluded mirror rows older than 3 days, so with a
//     frozen mirror it evaluated ZERO domain feeds and returned
//     {"new_alerts":0,"stale":[]}.
//
// The two failures this guards are OPPOSITE, and a naive "fix" trips one of them:
//
//   * DELETE the 3-day exclusion and the check evaluates a month-old mirror,
//     emitting alerts about ages it cannot vouch for. That is why the exclusion is
//     pinned as REQUIRED, not removed.
//   * KEEP the exclusion without alerting on the excluded set and the monitor goes
//     silent again the next time the transport breaks. That is why the
//     feed_mirror_stale insert is pinned beside it.
//
// Both must hold together. Either alone is the bug.
//
// (!) COMMENTS ARE STRIPPED BEFORE MATCHING. Both migration headers quote the
// broken predicate, the 401/500 bodies and the phrase "status_code = 200" at
// length while EXPLAINING the fix -- so a naive grep would match the prose that
// documents the guard and pass over its deletion. That is the A5c/N18 defect (a
// source detector reporting the bug it just removed), inside a test.
//
// Assertions anchor on FUNCTION, COLUMN and ALERT-KIND names and on stable
// structural boundaries (a function's own CREATE ... $fn$), never on a line
// number and never on a banner-delimited region (the block-slice footgun).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const LCC_FILES = readdirSync('supabase/migrations')
  .filter((f) => f.includes('b6a_followup_feed_freshness_loud'));
const DIA_FILES = readdirSync('supabase/migrations/dialysis')
  .filter((f) => f.includes('b6a_followup_restore_feed_freshness'));

const RAW = LCC_FILES.map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n');
const DIA_RAW = DIA_FILES.map((f) => readFileSync(`supabase/migrations/dialysis/${f}`, 'utf8')).join('\n');

// Executable SQL only -- see the header.
const strip = (s) => s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const SQL = strip(RAW);
const DIA_SQL = strip(DIA_RAW);

// A function body bounded by its own CREATE and its terminating $fn$ -- a STABLE
// structural boundary, not a banner comment.
function bodyOf(fnName, sql = SQL) {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fnName}`);
  assert.notEqual(start, -1, `${fnName} is not defined in the B6a-follow-up migration`);
  const end = sql.indexOf('$fn$;', start);
  assert.notEqual(end, -1, `${fnName} body is not terminated`);
  return sql.slice(start, end);
}

test('the migrations exist and strip to executable SQL', () => {
  assert.ok(LCC_FILES.length > 0, 'LCC B6a-follow-up migration not found');
  assert.ok(DIA_FILES.length > 0, 'dia B6a-follow-up grant migration not found');
  // Positive control for the stripper: the headers DO discuss the broken
  // predicate, and the stripped SQL must NOT inherit that prose.
  assert.match(RAW, /indistinguishable from "nothing to do"/,
    'header rationale missing -- this test would be matching the wrong thing');
  assert.doesNotMatch(SQL, /indistinguishable from "nothing to do"/,
    'comment stripping is broken; every assertion below is unreliable');
  assert.match(DIA_RAW, /permission denied for function/);
  assert.doesNotMatch(DIA_SQL, /permission denied for function/);
});

// -- 1a. The finalize must COUNT and SURFACE non-200 outcomes. ---------------

test('finalize classifies FOUR outcomes, not "200 vs silently dropped"', () => {
  const body = bodyOf('lcc_finalize_feed_freshness');
  for (const cls of ['responded_ok', 'responded_bad', 'pending']) {
    assert.ok(body.includes(`'${cls}'`), `finalize lost the ${cls} class`);
  }
  // (!) `'lost'` also appears in the FILTER count below, so includes() alone stays
  // green when the CASE branch itself is changed. Pin the branch.
  assert.ok(/ELSE 'lost'\s*\n\s*END AS class/.test(body),
    "the CASE no longer classifies an unanswered, un-waitable request as `lost`");
  // `lost` is its own class because net._http_response is pruned to ~6h while the
  // inflight row lingered 24h: a response arriving after finalize ran could NEVER
  // be consumed by the next day's pass. Collapsing it into `pending` restores that
  // permanent silent loss.
  assert.ok(/WHEN i\.issued_at > now\(\) - p_grace\s+THEN 'pending'/.test(body),
    'the pending/lost boundary is gone -- a lost request would linger as pending forever');
});

test('finalize returns the failure counts separately from the success counts', () => {
  const body = bodyOf('lcc_finalize_feed_freshness');
  // (!) Assert on the RETURNS TABLE signature, not on the body: the body ASSIGNS
  // these names too, so a body-wide includes() stays green when the signature is
  // renamed and the caller stops seeing them.
  const sig = body.slice(body.indexOf('RETURNS TABLE('), body.indexOf('LANGUAGE plpgsql'));
  for (const col of ['failed_requests', 'lost_requests', 'pending_requests',
                     'domains_failed', 'retried_domains', 'status_codes']) {
    assert.ok(new RegExp(`\\b${col}\\b`).test(sig),
      `finalize no longer RETURNS ${col}; the caller cannot see the failure`);
  }
  // (0,0) meaning both "everything failed" and "nothing to do" IS the bug.
  assert.ok(body.includes('finalized_requests') && body.includes('rows_upserted'),
    'the success counters must survive alongside the failure counters');
});

test('finalize RECORDS every leg outcome -- a failure must have somewhere to be', () => {
  const body = bodyOf('lcc_finalize_feed_freshness');
  // (!) The table name also appears in the ON CONFLICT qualifier and the UPDATE
  // target, so a plain includes() stays green when the INSERTs are broken.
  const inserts = (body.match(/INSERT INTO public\.lcc_feed_freshness_sync_status/g) || []).length;
  assert.ok(inserts >= 3,
    `finalize writes the per-domain watermark from only ${inserts} branch(es); `
    + 'a failed leg leaves no trace again');
  for (const outcome of ['http_error', 'no_response', 'empty_payload']) {
    assert.ok(body.includes(`'${outcome}'`), `finalize stopped recording ${outcome}`);
  }
});

test('a 200 carrying an EMPTY payload is not counted as a success (the P157 shape)', () => {
  const body = bodyOf('lcc_finalize_feed_freshness');
  // PostgREST answers 200 [] for a view anon cannot read under RLS -- a
  // status-code check passes while nothing arrives. Read the body, not the code.
  assert.ok(/jsonb_array_length\(nullif\(\w+\.content,''\)::jsonb\), 0\) = 0/.test(body),
    'the empty-payload guard is gone -- 200 [] would read as a healthy sync');
});

test('the classification aliases the response table `resp`, never `r`', () => {
  const body = bodyOf('lcc_finalize_feed_freshness');
  // plpgsql resolves an identifier to a DECLAREd variable BEFORE a SQL alias, and
  // `r` is the loop record. Aliasing the response table `r` plans fine and raises
  // 55000 "record r is not assigned yet" only when executed -- so no structural
  // check but this one catches it.
  assert.ok(body.includes('LEFT JOIN net._http_response resp ON resp.id = i.request_id'),
    'the response alias is not `resp`; if it is `r` the function dies at runtime');
  assert.doesNotMatch(body, /LEFT JOIN net\._http_response r ON/,
    'the response table is aliased `r`, which shadows the DECLAREd loop record');
});

test('finalize retries a failed leg, BOUNDED, and cannot hide a hard failure', () => {
  const body = bodyOf('lcc_finalize_feed_freshness');
  assert.ok(body.includes('p_max_attempts'), 'the retry is unbounded');
  assert.ok(/r\.att < p_max_attempts/.test(body), 'the attempt cap is not enforced');
  assert.ok(body.includes('PERFORM public.lcc_sync_feed_freshness('),
    'finalize no longer re-fires a failed domain');
  // A hard failure (dia's 401) must exhaust its attempts and then be REPORTED --
  // the retry must never become a way to stay quiet.
  assert.ok(body.includes("'http_error'"), 'a retried-and-still-failing leg records nothing');
});

test('only accounted-for requests are cleared; `pending` is deliberately left', () => {
  const body = bodyOf('lcc_finalize_feed_freshness');
  assert.ok(/DELETE FROM public\.lcc_feed_freshness_sync_inflight i\s+WHERE i\.request_id IN \(SELECT request_id FROM _ffin WHERE class <> 'pending'\)/.test(body),
    'the inflight cleanup no longer excludes pending -- an in-flight request would be dropped');
});

// -- 1b. The check must alert on the set it refuses to evaluate. -------------

test('the 3-day mirror exclusion STAYS -- evaluating a stale mirror is the wrong fix', () => {
  const body = bodyOf('lcc_check_feed_freshness');
  // (!) The same predicate appears in the _ff_blind scan below, so a body-wide
  // includes() stays green when it is deleted from the EVALUABLE set -- which is
  // the half that matters. Slice the named CTE (a stable structural boundary).
  const cte = body.slice(body.indexOf('domain_mirror AS ('), body.indexOf('SELECT u.dom'));
  assert.notEqual(cte.length, 0, 'the domain_mirror CTE is gone');
  assert.ok(cte.includes('synced_at > now() - p_mirror_max_age'),
    'the mirror-staleness exclusion was deleted from the evaluable set; the check '
    + 'would now emit alerts about ages it cannot vouch for');
});

test('...AND the excluded set is its own alertable condition', () => {
  const body = bodyOf('lcc_check_feed_freshness');
  assert.ok(body.includes("'feed_mirror_stale'"),
    'the blindness alert is gone -- the monitor goes silent again on the next transport break');
  assert.ok(body.includes('_ff_blind'), 'the blind-spot population is no longer computed');
  // A domain that has NEVER synced is blind too, not absent.
  assert.ok(/VALUES \('gov'\),\('dia'\)/.test(body),
    'the blind-spot scan no longer enumerates both domains; a domain with zero '
    + 'mirror rows would be invisible rather than alerting');
});

test('the blindness alert is deduped per domain and auto-resolves', () => {
  const body = bodyOf('lcc_check_feed_freshness');
  assert.ok(/NOT EXISTS \(\s*SELECT 1 FROM public\.lcc_health_alerts a\s+WHERE a\.alert_kind = 'feed_mirror_stale'/.test(body),
    'feed_mirror_stale is no longer deduped -- it would re-open hourly');
  assert.ok(/SET resolved_at = now\(\),\s+resolved_note = 'Auto-resolved: feed-freshness mirror refreshed within SLA'/.test(body),
    'feed_mirror_stale no longer auto-resolves; it would sit open forever after recovery');
});

test('feeds_evaluated and feeds_excluded_stale_mirror are SEPARATE honest counts', () => {
  const body = bodyOf('lcc_check_feed_freshness');
  assert.ok(body.includes("'feeds_evaluated'"), 'feeds_evaluated is not reported');
  assert.ok(body.includes("'feeds_excluded_stale_mirror'"),
    '"I evaluated nothing" and "nothing is wrong" render identically again');
  assert.ok(body.includes("'mirror_alerts_new'") && body.includes("'mirror_alerts_resolved'"),
    'the blindness alert counts are not reported separately from feed_stale counts');
});

test('the stale payload is ranked and capped', () => {
  const body = bodyOf('lcc_check_feed_freshness');
  assert.ok(/ORDER BY age_days DESC LIMIT c_cap/.test(body), 'the stale payload is no longer capped');
  assert.ok(body.includes("'stale_omitted'"),
    'a capped list without an omitted count is a badge that lies');
});

// -- Overload trap: every signature change DROPs first. ----------------------

test('every changed signature is DROPPED before recreate (the 42725 trap)', () => {
  // CREATE OR REPLACE does NOT replace a function of different arity. Leaving the
  // old one behind makes every existing call site ambiguous -- and cron 193's
  // `SELECT public.lcc_check_feed_freshness();` would take the hourly health tick's
  // other three checks down with it.
  for (const sig of ['public.lcc_sync_feed_freshness(text)',
                     'public.lcc_finalize_feed_freshness()',
                     'public.lcc_check_feed_freshness()']) {
    assert.ok(SQL.includes(`DROP FUNCTION IF EXISTS ${sig};`),
      `${sig} is not dropped before recreate; its call sites would fail 42725`);
  }
});

test('the finalize retry cycle is actually scheduled', () => {
  // A retry re-fired from inside a single finalize can never be consumed by that
  // same call, and by the next day's run its response is pruned. The cycle IS the
  // mechanism.
  assert.ok(/'lcc-feed-freshness-finalize', '35,40,45 5 \* \* \*'/.test(SQL),
    'the finalize runs once again -- a retry would never be consumed');
  assert.ok(/'lcc-feed-freshness-sync', *'30 5 \* \* \*'/.test(SQL),
    'the sync schedule changed unexpectedly');
});

// -- The dia transport fix ships both halves or neither. ---------------------

test('the dia grant restores anon EXECUTE *and* closes the registry write hole', () => {
  assert.ok(/GRANT EXECUTE ON FUNCTION public\.compute_feed_freshness\(\) TO anon/.test(DIA_SQL),
    'the dia leg cannot answer without anon EXECUTE');
  // compute_feed_freshness is SECURITY DEFINER, so anon EXECUTE over a registry
  // anon can WRITE lets any anon caller repoint a feed at an arbitrary table and
  // read max() of it -- the hole B6a closed on gov. Both halves, or neither.
  assert.ok(/REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public\.feed_freshness_registry FROM anon/.test(DIA_SQL),
    'restoring anon EXECUTE without revoking registry writes REOPENS a privilege-escalation vector');
  assert.ok(/GRANT +SELECT +ON public\.feed_freshness_registry TO +anon/.test(DIA_SQL),
    'the LCC cross-DB pull reads the registry as anon; SELECT must be retained');
});

test('gov is NOT touched -- this is an LCC transport-and-alerting repair', () => {
  const govDir = readdirSync('supabase/migrations/government');
  assert.equal(govDir.filter((f) => f.includes('b6a_followup')).length, 0,
    'a gov migration crept in; gov is deliberately untouched so the LCC repair can '
    + 'be attributed on its own (brief 2c)');
});
