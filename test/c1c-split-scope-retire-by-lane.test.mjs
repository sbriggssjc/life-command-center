// C1C-SPLIT — lcc_c1c_retire_sf_lanes gains a lane-scoped 4th argument so the
// dia lane (true_owner_needs_salesforce) can be retired WITHOUT the gov lane
// (owner_needs_salesforce), which is blocked on C1B-GOV-GATE (its gate guards
// owner_needs_sos, not owner_needs_salesforce, so it is still being fed --
// 175 new rows minted since C1b, 09-08..09-15).
//
// SQL-only change, so these are structural assertions over the migration text
// -- the same style as test/c13c-one-off-owner-confidence.test.mjs -- plus one
// assertion that pins the overload trap (N15d/N15g): a defaulted new
// parameter creates a SECOND signature unless the old one is dropped first,
// and Postgres resolves an ambiguous 3-arg call to "function is not unique"
// (42725) rather than picking either one.
//
// Four things this guard pins, each measured against a temptation that would
// quietly undo it:
//   1. a 4-arg call retires ONLY the named lane(s) -- never both by accident.
//   2. an unrecognised research_type RAISES -- a typo must not silently
//      retire zero rows and look like a clean no-op.
//   3. exactly ONE `lcc_c1c_retire_sf_lanes` signature survives the migration
//      -- the overload trap, positive-controlled by grepping for the DROP
//      that must precede the CREATE OR REPLACE.
//   4. the default (research_types = NULL) still covers BOTH lanes, because
//      the reversal runbook and any future gov retirement depend on that
//      default staying the full set.
//
// ⚠️ COMMENTS ARE STRIPPED BEFORE MATCHING. This migration's own header
// explains the overload trap, the validation rule and the gov-gate blocker in
// prose, naming `p_research_types`, `raise exception`, `drop function` and
// `owner_needs_salesforce` repeatedly -- a raw-source detector would find
// every token present and pass over a regression that deleted the real code
// (the A5c / N18 / C13c lesson).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE_MIGRATION = fileURLToPath(new URL(
  '../supabase/migrations/20260908130300_lcc_c1c_retire_sf_lanes.sql',
  import.meta.url));
const SPLIT_MIGRATION = fileURLToPath(new URL(
  '../supabase/migrations/20260916120000_lcc_c1csplit_scope_retire_by_lane.sql',
  import.meta.url));

const BASE_RAW = readFileSync(BASE_MIGRATION, 'utf8');
const SPLIT_RAW = readFileSync(SPLIT_MIGRATION, 'utf8');

function stripSqlComments(sql) {
  // Blank out `-- ...` to end of line, preserving offsets so anchors still
  // line up.
  return sql.replace(/--[^\n]*/g, m => ' '.repeat(m.length));
}

const BASE_SQL = stripSqlComments(BASE_RAW);
const SPLIT_SQL = stripSqlComments(SPLIT_RAW);

function must(cond, msg) {
  assert.ok(cond, msg + ' — re-anchor this guard rather than deleting it.');
}

// --- 1. The old 3-arg signature is dropped BEFORE the new one is created ---
test('the pre-split 3-arg signature is DROPPED before the 4-arg one is created', () => {
  const dropIdx = SPLIT_SQL.indexOf(
    'drop function if exists public.lcc_c1c_retire_sf_lanes(boolean, text, int);');
  const createIdx = SPLIT_SQL.indexOf(
    'create or replace function public.lcc_c1c_retire_sf_lanes(');
  must(dropIdx !== -1, 'expected an explicit DROP of the 3-arg signature');
  must(createIdx !== -1, 'expected the 4-arg CREATE OR REPLACE');
  must(dropIdx < createIdx, 'the DROP must precede the CREATE — otherwise the '
    + 'DROP IF EXISTS after CREATE OR REPLACE would drop the very function '
    + 'just defined, or (worse) the two coexist as an overload');
});

// --- 2. The new signature takes a 4th `p_research_types text[]` parameter,
//        after p_dry_run/p_batch_tag/p_limit — the ordering the runbook and
//        every existing 3-arg-positional caller depends on. ---
test('lcc_c1c_retire_sf_lanes gains p_research_types as the 4th parameter, default NULL', () => {
  const sigMatch = SPLIT_SQL.match(
    /create or replace function public\.lcc_c1c_retire_sf_lanes\(([\s\S]*?)\)\s*returns jsonb/);
  must(sigMatch, 'expected the 4-arg function signature');
  const sig = sigMatch[1];
  const params = sig.split(',').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  must(params.length === 4, `expected exactly 4 parameters, found ${params.length}: ${params.join(' | ')}`);
  must(/^p_dry_run\s+boolean\s+default\s+true$/i.test(params[0]), `param 1 wrong: ${params[0]}`);
  must(/^p_batch_tag\s+text\s+default\s+null$/i.test(params[1]), `param 2 wrong: ${params[1]}`);
  must(/^p_limit\s+int\s+default\s+null$/i.test(params[2]), `param 3 wrong: ${params[2]}`);
  must(/^p_research_types\s+text\[\]\s+default\s+null$/i.test(params[3]),
    `param 4 wrong (must be a trailing, defaulted text[]): ${params[3]}`);
});

// --- 3. The plan CTE selects on v_types (the resolved argument), not the
//        hardcoded lane-type function directly — that is what makes the
//        4-arg call scope the retirement. ---
test('the retire plan filters on the resolved v_types, not the raw lane-type constant', () => {
  const planMatch = SPLIT_SQL.match(
    /create temp table _c1c_plan on commit drop as[\s\S]*?where t\.research_type = any \((\w+)\)/);
  must(planMatch, 'expected the _c1c_plan CTE with a `research_type = any(...)` filter');
  must(planMatch[1] === 'v_types',
    `plan must filter on v_types (the resolved argument), found "${planMatch[1]}" — `
    + 'filtering on _lcc_c1c_lane_types() directly would ignore the caller\'s scope '
    + 'and always retire both lanes');
});

// --- 4. v_types resolves from p_research_types, defaulting to the FULL set
//        when the caller passes NULL. ---
test('v_types defaults to the full _lcc_c1c_lane_types() set when p_research_types is NULL', () => {
  must(/v_types\s+text\[\]\s*:=\s*coalesce\(p_research_types,\s*v_valid\)/.test(SPLIT_SQL),
    'expected v_types := coalesce(p_research_types, v_valid) — the default '
    + 'must cover BOTH lanes, or the reversal runbook and a future gov '
    + 'retirement silently narrow');
  must(/v_valid\s+text\[\]\s*:=\s*public\._lcc_c1c_lane_types\(\)/.test(SPLIT_SQL),
    'expected v_valid := public._lcc_c1c_lane_types() as the allowlist source');
});

// --- 5. An unrecognised research_type RAISES, never silently retires zero
//        rows. Both the empty-array case and the unknown-value case. ---
test('an empty p_research_types array raises, rather than being read as "retire all"', () => {
  const idx = SPLIT_SQL.indexOf('if p_research_types is not null and array_length(p_research_types, 1) is null then');
  must(idx !== -1, 'expected an explicit empty-array guard');
  const after = SPLIT_SQL.slice(idx, idx + 400);
  must(/raise exception/i.test(after), 'the empty-array branch must RAISE, not return a silent 0');
});

test('an unknown research_type is rejected with RAISE, not silently excluded', () => {
  const idx = SPLIT_SQL.indexOf('select array_agg(x) into v_bad');
  must(idx !== -1, 'expected the unknown-lane detection (array_agg into v_bad)');
  const badCheck = SPLIT_SQL.slice(idx, idx + 400);
  must(/x <> all \(v_valid\)/.test(badCheck), 'expected the anti-join against v_valid');
  const raiseIdx = SPLIT_SQL.indexOf('lcc_c1c_retire_sf_lanes: unknown research_type');
  must(raiseIdx !== -1, 'expected a RAISE EXCEPTION naming the unknown research_type(s)');
  must(raiseIdx > idx, 'the raise must come after the v_bad computation, i.e. actually be reachable');
});

// --- 6. Positive control on the assertion above: prove it is not vacuous by
//        confirming the RAISE text names v_bad, so a mutation that swaps the
//        message for something inert would fail this too. ---
test('positive control: the unknown-lane RAISE names v_bad, not a static string', () => {
  const raiseBlock = SPLIT_SQL.slice(
    SPLIT_SQL.indexOf('if v_bad is not null'),
    SPLIT_SQL.indexOf('lcc_c1c_retire_sf_lanes: unknown research_type') + 200);
  must(/%\s*,\s*v_bad/.test(raiseBlock) || /%',\s*v_bad,\s*v_valid/.test(raiseBlock),
    'the raise exception must interpolate v_bad (and v_valid) so the error is actionable, '
    + `got: ${JSON.stringify(raiseBlock)}`);
});

// --- 7. The dry-run branch echoes research_types back, so a caller (and this
//        guard's own live-run instructions) can confirm scope before writing. ---
test('the dry-run response echoes the resolved research_types', () => {
  const dryIdx = SPLIT_SQL.indexOf('if p_dry_run then');
  must(dryIdx !== -1, 'expected the dry-run branch');
  const dryBlock = SPLIT_SQL.slice(dryIdx, dryIdx + 800);
  must(/'research_types',\s*to_jsonb\(v_types\)/.test(dryBlock),
    'dry-run output must report research_types so a live caller can verify scope '
    + 'BEFORE writing — this is the load-bearing check for the documented dry-run step');
});

// --- 8. Exactly one signature is asserted live, in the SAME migration —
//        never trust the DROP silently (the overload trap, self-checking). ---
test('the migration asserts exactly one lcc_c1c_retire_sf_lanes signature exists after it runs', () => {
  must(/select count\(\*\) into v_n[\s\S]{0,200}proname = 'lcc_c1c_retire_sf_lanes'/.test(SPLIT_SQL),
    'expected a pg_proc count assertion keyed on proname=lcc_c1c_retire_sf_lanes');
  must(/if v_n <> 1 then[\s\S]{0,200}raise exception/.test(SPLIT_SQL),
    'the signature-count assertion must RAISE on anything other than exactly 1 — '
    + 'a migration that only counts and never asserts is not a guard');
});

// --- 9. Reload the PostgREST schema cache — the C2e-caller-reason precedent:
//        skipping this makes the feeder's next RPC 404 even though the DB is
//        correct. ---
test('the migration reloads the PostgREST schema cache', () => {
  must(/notify pgrst, 'reload schema'/.test(SPLIT_SQL),
    'expected NOTIFY pgrst, reload schema — omitting it 404s the next PostgREST '
    + 'call against a function that (from the DB\'s perspective) already exists');
});

// --- 10. lcc_c1c_unretire (the reversal path) is untouched by this migration
//         — C1C-SPLIT must not fork the reversal story. ---
test('lcc_c1c_unretire is not redefined by the scoping migration', () => {
  must(!/create or replace function public\.lcc_c1c_unretire/.test(SPLIT_SQL),
    'the scoping change must not touch lcc_c1c_unretire — reversal of a scoped '
    + 'batch must keep working through the existing batch-tag mechanism, which '
    + 'reads from lcc_c1c_retire_log and is agnostic to which lanes a batch covered');
});

// --- 11. The base migration still defines lcc_c1c_unretire keyed on
//         batch_tag alone (so it can reverse a lane-scoped batch just as it
//         reverses the original both-lanes batch). ---
test('the base migration\'s lcc_c1c_unretire is keyed on batch_tag only, not on lane', () => {
  const sigMatch = BASE_SQL.match(
    /create or replace function public\.lcc_c1c_unretire\(([\s\S]*?)\)\s*returns jsonb/);
  must(sigMatch, 'expected lcc_c1c_unretire in the base migration');
  const params = sigMatch[1].split(',').map(s => s.trim()).filter(Boolean);
  must(params.length === 1, `expected exactly 1 parameter (batch_tag), found ${params.length}`);
  must(/^p_batch_tag\s+text$/i.test(params[0]), `expected p_batch_tag text, got: ${params[0]}`);
});

// --- 12. The lane list itself is untouched — this change scopes CALLS to it,
//         it does not narrow the allowlist (retiring gov is deferred, not
//         made impossible). ---
test('_lcc_c1c_lane_types() itself is not redefined — both lanes remain valid arguments', () => {
  must(!/create or replace function public\._lcc_c1c_lane_types/.test(SPLIT_SQL),
    'the scoping migration must not redefine _lcc_c1c_lane_types() — narrowing '
    + 'it would silently change what NULL means for every caller and erase the '
    + 'record that the gov lane is in scope once C1B-GOV-GATE ships, not removed');
});
