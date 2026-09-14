// C13b — the owner-role classification is a SET, and these are the properties
// that make it safe to read.
//
// Scott, 2026-08-31: "I think these categories can exist multiple iterations
// per one account." 946 entities carry two or more roles; a scalar column picks
// one and silently destroys the other on exactly the population whose dual
// status decides whether it is worked as a seller or a buyer prospect.
//
// GUARD DESIGN
// ------------
// The unit is SQL-only, so these are structural assertions over the migration
// text. Each one pins a decision that was MEASURED and that a later
// "simplification" would quietly undo.
//
// ⚠️ COMMENTS ARE STRIPPED BEFORE MATCHING, and that is load-bearing: the
// migration's own header explains every hazard it removes, in prose, naming
// `count(*)`, "dormant", 3,258, `lcc_looks_like_person` and the rest. A
// detector reading raw source would find every token present and pass straight
// over a real regression (the A5c / N18 lesson).
//
// ⚠️ Anchors are STABLE identity tokens (a CTE name, the VALUES alias), never a
// line number and never a literal that moves (the block-slice footgun).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ⚠️ THIS GUARD READS THE C13C MIGRATION, NOT C13B'S — DELIBERATELY. C13c
// rebuilds `v_lcc_entity_roles` wholesale to split the `one_off_owner` evidence
// arm, so 20261005120000 is now the HISTORICAL text and no longer describes
// what ships. A guard pointed at a superseded definition asserts invariants
// over code nobody runs (P197: `test/tier0-park-reasons.test.mjs` read the P196
// file after P197 rebuilt the same view). Every C13b decision below is still
// enforced — it is enforced on the SHIPPED view. Whoever writes the next
// rebuild of this view repoints this constant in the same change.
const MIGRATION = fileURLToPath(new URL(
  '../supabase/migrations/20261006120000_lcc_c13c_one_off_owner_confidence.sql',
  import.meta.url));
const RAW = readFileSync(MIGRATION, 'utf8');

function stripSqlComments(sql) {
  // Blank out `-- ...` to end of line, preserving offsets so anchors still line
  // up. No `--` appears inside a string literal in this file; the guard below
  // asserts that stays true.
  return sql.replace(/--[^\n]*/g, m => ' '.repeat(m.length));
}
const SQL = stripSqlComments(RAW);

function between(src, a, b, label) {
  const i = src.indexOf(a);
  assert.notEqual(i, -1, `${label}: start anchor missing — ${JSON.stringify(a)}. ` +
    'Re-anchor this guard rather than deleting it.');
  const j = src.indexOf(b, i + a.length);
  assert.notEqual(j, -1, `${label}: end anchor missing — ${JSON.stringify(b)}`);
  return src.slice(i + a.length, j);
}

const ARMS = between(SQL, 'cross join lateral (',
  ') as v(role, evidence_arm, needs_name_guard, keep)', 'role arms');
const PUR  = between(SQL, 'pur as (', '),', 'purchases aggregate');

// The seven derived role tokens the arms may emit. `buyer` is not here: it can
// only ever arrive verbatim from a human's behavioral_override.
const DERIVED_ROLES = ['operator', 'user_owner', 'investor_owner', 'repeat_buyer',
  'former_owner', 'one_off_owner', 'developer'];

test('the comment stripper is not blanking SQL — anchors survive it', () => {
  // Positive control: without this the whole file could be one comment and
  // every assertion below would pass vacuously.
  assert.ok(SQL.includes('create or replace view public.v_lcc_entity_roles'));
  assert.ok(ARMS.length > 500, 'arms block collapsed — the stripper ate real SQL');
  assert.ok(!/'[^'\n]*--/.test(RAW),
    'a string literal now contains "--"; the offset-preserving stripper would ' +
    'corrupt it. Switch to a literal-aware stripper before adding one.');
});

test('repeat_buyer keys on the DISTINCT ASSET, never the edge count', () => {
  // Measured 2026-09-01: counting purchases EDGES gives 3,258 "repeat buyers",
  // counting distinct assets gives 401. The 2,857 difference is address-named
  // single-asset SPEs whose one conveyance was observed several times
  // (`entity_relationships` has no unique key on (from,to,type) — P177).
  assert.match(PUR, /count\(distinct r\.to_entity_id\)\s+as\s+assets_acquired/,
    'assets_acquired must count DISTINCT to_entity_id');
  assert.match(ARMS, /'repeat_buyer'[\s\S]{0,200}?c\.assets_acquired >= 2/,
    'the repeat_buyer arm must gate on assets_acquired, not purchase_edges');
  assert.doesNotMatch(ARMS, /purchase_edges\s*>=/,
    'an edge count is an OBSERVATION count, not an acquisition count');
});

// ⚠️ C13c SPLIT `individual_single_current_asset` INTO TWO. Quote-delimited
// membership is what makes that visible here: `'individual_single_current_asset'`
// is a PREFIX of both successors but not equal to either, so this list had to be
// updated in the same change rather than passing silently on a substring.
const EVIDENCE_ARMS = ['domain_true_owner_operator_flag', 'entities_owner_role_operator',
  'human_confirmed_owner_occupier', 'current_portfolio_fact', 'distinct_assets_acquired',
  'ended_holding_no_current',
  'individual_single_current_asset_sf_corroborated',
  'individual_single_current_asset_unverified',
  'gov_first_generation_classifier', 'manual_override'];

test('every arm carries an evidence arm — no role ships without a recorded basis', () => {
  // "A role with no recorded basis is the status-nobody-earned failure this
  // repo has hit four times." Asserted two ways: every evidence arm still
  // exists, and every ROLE literal in the arms block is followed immediately by
  // one of them.
  for (const arm of EVIDENCE_ARMS) {
    assert.ok(ARMS.includes(`'${arm}'`), `evidence arm ${arm} is gone from the arms block`);
  }
  for (const role of DERIVED_ROLES) {
    const i = ARMS.indexOf(`'${role}'`);
    assert.notEqual(i, -1, `the ${role} arm is gone`);
    const head = ARMS.slice(i, i + 200);
    assert.ok(EVIDENCE_ARMS.some(a => head.includes(`'${a}'`)),
      `the ${role} arm emits no evidence_arm`);
  }
  // The manual arm is the one whose ROLE is an expression, not a literal; it
  // still names its basis.
  assert.match(ARMS, /\(c\.behavioral_override,\s*'manual_override'/);
  // The renderer must be able to name a basis for every arm it can emit.
  for (const arm of EVIDENCE_ARMS) {
    assert.ok(SQL.includes(`when '${arm}'`) || arm === 'manual_override' || SQL.includes(`'${arm}'`),
      `${arm} has no evidence_detail branch`);
  }
});

test('absence is never reported as dormancy', () => {
  // P180 on the one dimension Scott says drives seller-vs-buyer treatment:
  // ownership_start_date is present on 50.7% of portfolio facts, so half of any
  // apparent "dormancy" is a missing date.
  assert.match(SQL, /is null then 'pacing_unknown'/,
    'a missing acquisition date must yield pacing_unknown');
  assert.doesNotMatch(SQL, /'[a-z_]*dormant[a-z_]*'/i,
    'the quiet bucket must not be called dormant — a party can be quiet only in OUR record');
  assert.ok(SQL.includes("'quiet_5y_plus'"), 'the quiet bucket token is gone');
  assert.match(SQL, /\n\s+c\.assets_acquired_dated,/,
    'the dated-vs-total counter must be EMITTED on the row (not merely computed ' +
    'in a CTE) so the blindness is visible per row');
});

test('no arm reads a NAME to decide a role', () => {
  // §3. Every name-based owner classifier measured in this arc landed ~25% raw,
  // 7%, or 4-of-6 guarded. Names may appear ONLY in the two exclusion guards,
  // and those live in the outer WHERE, not inside an arm.
  assert.doesNotMatch(ARMS, /entity_name/,
    'the role arms must not read entity_name — that is a lexical classifier');
  assert.doesNotMatch(ARMS, /lcc_looks_like_person|lcc_owner_name_is_credible_person|lcc_owner_strict_core|lcc_normalize_entity_name|nameSimilarity/,
    'a name comparator has been wired into a role arm');
});

test('the prospecting guard is surfaced, never suppressing', () => {
  // "Wake Forest and Mayo are correctly user_owner; whether they are prospected
  // is a separate gate." A classification is a fact about the party.
  const gate = between(SQL, 'where not a.needs_name_guard', ';', 'outer name guard');
  assert.doesNotMatch(gate, /lcc_owner_name_is_not_prospected/,
    'lcc_owner_name_is_not_prospected must never suppress a role');
  assert.match(SQL, /public\.lcc_owner_name_is_not_prospected\(c\.entity_name\)\s+as\s+is_not_prospected/,
    'is_not_prospected must be emitted as a column so a consumer can gate on it');
  // The two guards that DO suppress, and only those two.
  assert.match(gate, /lcc_owner_name_is_brokerage/);
  assert.match(gate, /lcc_is_placeholder_owner_name/);
});

test('a manual override always wins, and is never translated', () => {
  // Every derived arm must exclude its own role when a human has named it, or
  // one entity emits the same role twice.
  // Six arms exclude their own role explicitly; `developer` uses the STRONGER
  // `behavioral_override is null` (an override REPLACES the column it reads —
  // see the dedicated test below), so it is asserted there instead.
  for (const role of DERIVED_ROLES.filter(r => r !== 'developer')) {
    assert.ok(ARMS.includes(`c.behavioral_override is distinct from '${role}'`),
      `the ${role} arm can emit a duplicate of a manual override`);
  }
  // The override rides verbatim — `buyer` stays `buyer`.
  assert.match(ARMS, /\(c\.behavioral_override,\s*'manual_override'/,
    'the override must be emitted as its own literal value, never remapped');
});

test('an override REPLACES the column the developer arm reads', () => {
  // Measured 2026-09-01: 119 live entities carry owner_role='developer' AND a
  // human override of `buyer` (one more carries `operator`). Emitting developer
  // for those 120 resurrects the machine call the human corrected.
  assert.match(ARMS, /'developer',\s*'gov_first_generation_classifier',\s*false,\s*\n?\s*\(c\.owner_role = 'developer' and c\.behavioral_override is null\)/,
    'the developer arm must stand down whenever ANY override is present');
  assert.match(ARMS, /c\.owner_role = 'operator' and c\.behavioral_override is null/,
    'the stamped-operator arm must stand down whenever ANY override is present');
});

test('developer is READ, not re-implemented', () => {
  // Scott's definition IS the implemented one (v_gov_owner_at_first_gen, five
  // generations since 2026-05-22). A second classifier for one concept is the
  // normaliser drift this repo warns about a dozen times.
  const devArm = between(ARMS, "'developer', 'gov_first_generation_classifier'", '))', 'developer arm');
  assert.match(devArm, /c\.owner_role = 'developer'/,
    'developer must be read off the existing classification');
  assert.doesNotMatch(devArm, /lease|first_gen|year_built|year_renovated|transfer_date/i,
    'a second developer classifier is being built here');
});

test('no value floor on the classification, and nothing is stamped', () => {
  // Scott's first constraint: accuracy first. Suppressing an accurate
  // determination to protect a downstream band is the wrong trade.
  assert.doesNotMatch(SQL, /lcc_weak_role_value_floor|lcc_chain_human_value_floor|research_gate_value_floor/,
    'a value floor has been applied to the classification itself');
  assert.doesNotMatch(SQL, /current_annual_rent\s*[<>]=?\s*\d/,
    'a rent threshold has been applied to the classification itself');
  // Derived, never stamped (Class 8, and "isn't a one-time determination").
  assert.doesNotMatch(SQL, /\balter table\b[\s\S]{0,80}entities/i,
    'this unit must not add a stamped column to entities');
  assert.doesNotMatch(SQL, /\bupdate\s+public\.entities\b|\bupdate\s+entities\b/i,
    'this unit must not write entities');
  assert.doesNotMatch(SQL, /create\s+materialized\s+view/i,
    'materialize only on a measurement, following lcc_priority_queue_resolved');
});

test('the ambiguous are surfaced, not bucketed', () => {
  assert.match(SQL, /create or replace view public\.v_lcc_entity_role_ambiguity/);
  for (const kind of ['user_owner_candidate_unconfirmed',
    'individual_single_asset_but_multi_acquisition',
    'spe_shell_named_single_asset',
    'one_off_owner_rests_on_recorded_entity_type']) {
    assert.ok(SQL.includes(`'${kind}'`), `ambiguity kind ${kind} is gone`);
  }
  // user_owner is confirmation-gated: it may not be derived from the candidate
  // view, because 5 of the 15 candidates are SPEs named after their tenant.
  assert.match(ARMS, /'user_owner',\s*'human_confirmed_owner_occupier',\s*false,\s*\n?\s*\(coalesce\(c\.user_owner_confirmed, false\)/,
    'user_owner must come only from a recorded human verdict');
});
