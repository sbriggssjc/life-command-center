// B1 — the ownership-chain value floor, split by CONSUMER.
//
// WHAT THIS PINS, AND WHY IT IS ANCHORED THE WAY IT IS.
//
// The $500k floor was correct while `establish_ownership_history` was a human
// research queue. Since A2 (cron 244) the `agrees` bucket is applied by a cron
// from a deterministic draft, so the floor was gating FREE work. B1 splits it:
// no floor on the automated path, $500k unchanged on anything reaching a
// person.
//
// The failure this guards is a SILENT one in both directions:
//
//   * lower the floor on a lane with no automated consumer and you mint work
//     nobody can do (the Consumption-Layer failure);
//   * let the human floor slip and an operator's queue fills with $30k
//     properties, which is the badge-that-is-noise failure.
//
// ⚠️ COMMENTS ARE STRIPPED BEFORE MATCHING. The migration header discusses
// `below_value_floor`, dia, and `trace_ownership_to_developer` at length while
// explaining why they are HELD — so a naive grep would match the prose that
// documents the guard and pass over its deletion. That is the A5c/N18 defect
// (a source detector reporting the bug it just removed), inside a test.
//
// Assertions anchor on FUNCTION and COLUMN NAMES, never on a line number and
// never on a sliced source region between banners (the block-slice footgun).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const FILES = readdirSync('supabase/migrations')
  .filter((f) => f.includes('b1_split_chain_value_floor'));

const RAW = FILES.map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n');

// Executable SQL only — see the header.
const SQL = RAW.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

// The seeder body, bounded by its own CREATE and its terminating $function$ —
// a STABLE structural boundary, not a banner comment.
function bodyOf(fnName) {
  const start = SQL.indexOf(`create or replace function public.${fnName}`);
  assert.notEqual(start, -1, `${fnName} not defined in the B1 migration`);
  const end = SQL.indexOf('$function$;', start);
  assert.notEqual(end, -1, `${fnName} body is not terminated`);
  return SQL.slice(start, end);
}

test('the B1 migration exists and strips to executable SQL', () => {
  assert.ok(FILES.length > 0, 'B1 migration not found in supabase/migrations');
  assert.ok(SQL.includes('create or replace function public.lcc_chain_lane_has_auto_consumer'));
  // Positive control for the comment stripper: the header DOES discuss the
  // held lanes, and the stripped SQL must NOT inherit that prose.
  assert.match(RAW, /Consumption-Layer failure/,
    'header rationale missing — this test would be matching the wrong thing');
  assert.doesNotMatch(SQL, /Consumption-Layer failure/,
    'comment stripping is broken; every assertion below is unreliable');
});

test('the auto-consumer predicate admits gov+establish_ownership_history ONLY', () => {
  const body = SQL.slice(
    SQL.indexOf('create or replace function public.lcc_chain_lane_has_auto_consumer'),
    SQL.indexOf('comment on function public.lcc_chain_lane_has_auto_consumer'),
  );
  assert.match(body, /establish_ownership_history/,
    'the automated lane must be named explicitly');
  assert.match(body, /'gov'/, 'gov must be named explicitly');
  // The two populations that MUST keep the human floor. dia has no
  // v_ownership_transitions_portfolio, so a dia task can never be drafted;
  // trace_ownership_to_developer has a different, ungraded consumer.
  assert.doesNotMatch(body, /trace_ownership_to_developer/,
    'trace_ownership_to_developer has no graded automated consumer and must not be admitted');
  assert.doesNotMatch(body, /'dia'|'dialysis'/,
    'dia has no ownership-transitions view — admitting it mints undraftable work');
});

test('the human floor is NOT lowered', () => {
  const body = SQL.slice(
    SQL.indexOf('create or replace function public.lcc_chain_human_value_floor'),
    SQL.indexOf('comment on function public.lcc_chain_human_value_floor'),
  );
  assert.match(body, /500000/,
    'the human-facing floor must stay at the shared $500k knob');
});

test('the 2-arg seeder signature is DROPPED before the 3-arg is created', () => {
  // Adding a defaulted parameter creates an OVERLOAD, and with defaults on
  // both signatures every 2-arg call becomes "function is not unique" (42725).
  // That bit N15d/N15e on lcc_n15c_backfill_canonical_names.
  const drop = SQL.indexOf('drop function if exists public.lcc_generate_chain_research_tasks(int, numeric)');
  const create = SQL.indexOf('create or replace function public.lcc_generate_chain_research_tasks');
  assert.notEqual(drop, -1, 'the old 2-arg signature must be dropped explicitly');
  assert.ok(drop < create, 'the DROP must precede the CREATE or the overload survives');
});

test('the seeder resolves the floor per consumer in BOTH the skip sweep and the mint', () => {
  // A row admitted by the mint and closed by the sweep (or vice versa) is
  // churn every night that reads exactly like a working producer.
  const body = bodyOf('lcc_generate_chain_research_tasks');
  const uses = body.match(/lcc_chain_lane_has_auto_consumer/g) || [];
  assert.ok(uses.length >= 2,
    `the effective floor must be resolved in both the sweep and the mint; found ${uses.length} use(s)`);
  assert.match(body, /p_auto_min_value/, 'the automated floor parameter must exist');
  assert.match(body, /coalesce\(p_auto_min_value, p_min_value\)/,
    'omitting p_auto_min_value must preserve single-floor behaviour');
});

test('the lane split gates human_actionable on the human floor', () => {
  const view = SQL.slice(SQL.indexOf('create or replace view public.v_lcc_ownership_history_lane_split'));
  assert.match(view, /lane_value/, 'the view must carry the task value');
  assert.match(view, /lcc_chain_human_value_floor\(\)/,
    'the human gate must read the shared floor function, not an inline literal');
  // human_actionable must be a CONJUNCTION of "a person is needed" AND "it
  // clears the floor". Pin the floor term on the human_actionable line itself.
  const line = view.split('\n').find((l) => /as human_actionable\b/.test(l));
  assert.ok(line, 'human_actionable column not found');
  assert.match(line, /lane_value/,
    'human_actionable must be gated on lane_value, or the floor does not reach the badge');
  // An UNPRICED task is gated too: "we cannot size it" is not evidence it is
  // worth an operator's time (P180 / A5c value_unknown).
  assert.match(line, /lane_value is not null/,
    'an unpriced task must NOT be human_actionable');
});

test('human_gate names the four states distinctly', () => {
  const view = SQL.slice(SQL.indexOf('create or replace view public.v_lcc_ownership_history_lane_split'));
  for (const state of ['actionable', 'below_value_floor', 'not_human', 'awaiting_draft']) {
    assert.ok(view.includes(`'${state}'`), `human_gate must distinguish ${state}`);
  }
});

test('the re-open sweep can NEVER re-open a lane without an automated consumer', () => {
  const body = bodyOf('lcc_b1_reopen_below_floor');
  assert.match(body, /and public\.lcc_chain_lane_has_auto_consumer\(t\.domain, t\.research_type\)/,
    're-open must be gated on the auto-consumer predicate');
  assert.match(body, /below_value_floor/,
    're-open must target only below_value_floor skips');
  // uq_research_tasks_open_source is UNIQUE on (source_table, source_record_id,
  // research_type, domain) WHERE open — a collision aborts the whole batch.
  assert.match(body, /o\.status in \('queued','in_progress'\)/,
    're-open must exclude subjects that already have an open task');
  assert.match(body, /distinct on/,
    're-open must dedupe within the batch or two skipped rows for one subject collide');
});

test('the re-open is reversible byte-for-byte', () => {
  const body = bodyOf('lcc_b1_reopen_below_floor');
  assert.match(body, /prior_status/, 'the ledger must record the prior status');
  assert.match(body, /prior_outcome/, 'the ledger must record the prior outcome jsonb');
  const undo = bodyOf('lcc_b1_unreopen');
  assert.match(undo, /tgt\.prior_status::research_status/, 'unreopen must restore the prior status');
  assert.match(undo, /outcome = tgt\.prior_outcome/,
    'unreopen must restore the prior outcome verbatim, never reconstruct it');
});

test('the honest counters are reported, not the scan tally', () => {
  const body = bodyOf('lcc_b1_reopen_below_floor');
  // `candidates` reads like throughput while nothing moves (P159a); the number
  // that matters is what was written, plus whether the count is a total.
  assert.match(body, /'tasks_reopened'/, 'must report what was actually written');
  assert.match(body, /'admitted_head_exhausted'/,
    'a capped run must say so, or `candidates` is read as a total when it is a floor');
  assert.match(body, /'held_by_design'/,
    'the held populations must be named, not silently dropped');
});

test('cron 144 carries the automated floor', () => {
  assert.match(SQL, /lcc_generate_chain_research_tasks\(2000, 500000, 0\)/,
    'cron 144 must pass the automated floor, or the split is inert in production');
  assert.match(SQL, /cron\.schedule\('lcc-r6-chain-research'/,
    'the job must be replaced by NAME so a second job is not created');
});
