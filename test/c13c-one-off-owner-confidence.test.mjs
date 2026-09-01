// C13c — `one_off_owner` carries its CONFIDENCE, and the known-wrong rows are
// recorded as reviewed.
//
// THE DEFECT. The arm's only evidence is `entities.entity_type = 'person'`, and
// that column is wrong in BOTH directions: `Jamestown`, an institutional
// investment manager holding $22.8M of current annual rent, is typed `person`
// and sat on a one-off-INDIVIDUAL lane, while genuine married couples are
// rejected by every name test available.
//
// THE DISPOSITION IS A CONFIDENCE SPLIT, NOT A DELETION. 142 -> 13 discards
// every genuine individual simply absent from Salesforce; asserting all 142 flat
// is what put Jamestown on the lane. So the arm splits its EVIDENCE and the
// surface gates on it (P181 one layer down), and the reviewed institutional rows
// go in a LEDGER, never a name stoplist in the classifier.
//
// GUARD DESIGN
// ------------
// SQL-only unit, so these are structural assertions over the migration text.
// Each pins a decision that was MEASURED and that a later "simplification" would
// quietly undo — and the two most tempting simplifications are exactly the two
// the prompt puts out of scope: filtering membership on the corroboration (a
// deletion) and repairing `entities.entity_type` here (a fleet-wide change).
//
// ⚠️ COMMENTS ARE STRIPPED BEFORE MATCHING, and that is load-bearing: the
// migration's header explains every hazard it removes, in prose, naming
// `entity_type`, `lcc_looks_like_person`, `first_name`/`last_name`, `Jamestown`
// and 13/129. A detector reading raw source would find every token present and
// pass straight over a real regression (the A5c / N18 lesson).
//
// ⚠️ Anchors are STABLE identity tokens (a CTE name, a view name, the VALUES
// alias), never a line number and never a literal that moves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MIGRATION = fileURLToPath(new URL(
  '../supabase/migrations/20261006120000_lcc_c13c_one_off_owner_confidence.sql',
  import.meta.url));
const RAW = readFileSync(MIGRATION, 'utf8');

function stripSqlComments(sql) {
  // Blank out `-- ...` to end of line, preserving offsets so anchors still line
  // up. The guard below asserts no `--` appears inside a string literal, which
  // is what makes an offset-preserving stripper safe here.
  return sql.replace(/--[^\n]*/g, m => ' '.repeat(m.length));
}
const SQL = stripSqlComments(RAW);

// ⚠️ A SECOND STRIPPER, AND IT IS LOAD-BEARING FOR A DIFFERENT REASON. Two of
// the assertions below ask "is this COLUMN read anywhere" / "is a name compared
// to a literal". The migration's own `evidence_detail` caveats and the ambiguity
// view's `why` prose quote `first_name/last_name`, `Jamestown` and
// `Metropolitan Life Insurance` while EXPLAINING why they are not used — so a
// detector over comment-stripped source finds every banned token present and
// reports a defect the fix removed. That is B6c-dup's shape (the defect is the
// prose) meeting PR1b's rule: literal-blanked source for prose-sensitive greps,
// comments-only where the pattern itself contains a literal.
// Offsets are preserved so anchors still line up. Handles the doubled-quote
// escape (`''`) by blanking it like any other pair of literal characters.
function stripSqlStringLiterals(sql) {
  let out = '';
  let inStr = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (!inStr) {
      if (ch === "'") { inStr = true; out += ch; } else { out += ch; }
    } else {
      if (ch === "'") { inStr = false; out += ch; }
      else { out += (ch === '\n' ? '\n' : ' '); }
    }
  }
  return out;
}
const CODE = stripSqlStringLiterals(SQL);

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
const SFC = between(SQL, 'sfc as (', '),', 'salesforce-contact corroboration CTE');
const LEDGER_INSERT = between(SQL, 'insert into public.lcc_entity_role_confirmation',
  'end $$;', 'named-review ledger insert');
const AMBIGUITY = SQL.slice(SQL.indexOf('create or replace view public.v_lcc_entity_role_ambiguity'));
const ROLES_VIEW = between(SQL, 'create or replace view public.v_lcc_entity_roles',
  'create or replace view public.v_lcc_entity_role_ambiguity', 'roles view');

// The two arms the split produces. Both are `one_off_owner`; only the CONFIDENCE
// differs, which is the whole point.
const CORROBORATED = 'individual_single_current_asset_sf_corroborated';
const UNVERIFIED   = 'individual_single_current_asset_unverified';

test('the comment stripper is not blanking SQL — anchors survive it', () => {
  // Positive control: without this the whole file could be one comment and every
  // assertion below would pass vacuously (Class 11 — point the detector at a
  // known positive before believing its zero).
  assert.ok(SQL.includes('create or replace view public.v_lcc_entity_roles'));
  assert.ok(ARMS.length > 500, 'arms block collapsed — the stripper ate real SQL');
  assert.ok(SFC.length > 50, 'sfc CTE collapsed — the stripper ate real SQL');
  assert.ok(LEDGER_INSERT.length > 500, 'ledger insert collapsed');
  // Positive control for the literal stripper: it must blank prose while leaving
  // the SQL that carries the assertions standing.
  assert.ok(CODE.includes('create or replace view public.v_lcc_entity_roles'),
    'the literal stripper ate real SQL');
  assert.ok(!CODE.includes('Jamestown'),
    'the literal stripper is not blanking string literals');
  assert.ok(CODE.includes('c.entity_type = ') && CODE.includes('has_sf_contact'),
    'the literal stripper ate the predicates the guards read');
  assert.ok(!/'[^'\n]*--/.test(RAW),
    'a string literal now contains "--"; the offset-preserving stripper would ' +
    'corrupt it. Switch to a literal-aware stripper before adding one.');
});

test('the split is a CONFIDENCE split — membership is untouched', () => {
  // ⚠️ THE TEMPTING WRONG MOVE. Gating the arm on the corroboration turns
  // 142 into 13 and discards `Maslow Robert C & Michele C` and every other
  // genuine individual simply absent from Salesforce. The corroboration decides
  // the LABEL's confidence, never who is on the lane.
  const keep = between(ARMS, "'one_off_owner',", '))', 'one_off_owner arm');
  assert.match(keep, /c\.entity_type = 'person' and c\.current_assets = 1/,
    'the one_off_owner membership test must stay entity_type + one current asset');
  assert.ok(keep.includes("c.behavioral_override is distinct from 'one_off_owner'"),
    'a manual override must still win over the derived arm');
  // The corroboration may appear ONLY in the evidence_arm expression, never in
  // the keep predicate. Split the arm at the `true,` needs_name_guard flag that
  // separates them.
  const [evidenceExpr, keepExpr] = (() => {
    const i = keep.indexOf('\n     true,');
    assert.notEqual(i, -1, 'the one_off_owner arm no longer carries needs_name_guard=true');
    return [keep.slice(0, i), keep.slice(i)];
  })();
  assert.match(evidenceExpr, /case when c\.has_sf_contact then/,
    'the evidence arm must be chosen by the corroboration');
  assert.doesNotMatch(keepExpr, /has_sf_contact/,
    'has_sf_contact has moved into the MEMBERSHIP predicate — that is the ' +
    '142 -> 13 deletion this unit exists to refuse');
});

test('both arms exist, are distinct, and each says what "individual" rests on', () => {
  assert.ok(ARMS.includes(`'${CORROBORATED}'`), `the ${CORROBORATED} arm is gone`);
  assert.ok(ARMS.includes(`'${UNVERIFIED}'`), `the ${UNVERIFIED} arm is gone`);
  assert.ok(!ARMS.includes("'individual_single_current_asset'"),
    'the flat pre-C13c arm is back — a genuine judgement call and a worthless ' +
    'one would wear the same label again (P181)');
  // Each arm renders an evidence_detail branch naming its basis, so a consumer
  // reading ONE row can tell the strong case from the weak one without joining
  // anything.
  for (const arm of [CORROBORATED, UNVERIFIED]) {
    assert.ok(SQL.includes(`when '${arm}'`), `${arm} has no evidence_detail branch`);
  }
  const detail = between(SQL, `when '${UNVERIFIED}'`, 'when \'gov_first', 'unverified detail');
  assert.match(detail, /'individual_evidence', 'entities\.entity_type ONLY'/,
    'the weak arm must say on the row that entity_type is its only evidence');
  assert.match(detail, /caveat/,
    'the weak arm must carry its caveat on the row, not only in a doc');
});

test('the corroboration is a RECORDED FACT from another system, never a name test', () => {
  // §3/§4 ban a lexical classifier here, and the measurements say one would not
  // work anyway: `lcc_owner_name_has_org_marker` catches 0 of 142, and
  // `lcc_looks_like_person` flags 28 while PASSING `Gates Hudson`,
  // `Metropolitan Life Insurance` and `Gladstone Commercial`, which are firms.
  assert.match(SFC, /source_system = 'salesforce'/);
  assert.match(SFC, /source_type = 'Contact'/);
  assert.doesNotMatch(SFC, /name|lcc_looks_like_person|lcc_owner_name|lcc_owner_strict_core|lcc_normalize_entity_name/i,
    'a name comparator has been wired into the corroboration');
  assert.doesNotMatch(ARMS, /lcc_looks_like_person|lcc_owner_name_has_org_marker|lcc_owner_name_is_credible_person|lcc_owner_strict_core|lcc_normalize_entity_name/,
    'a name comparator has been wired into a role arm');
  // ⚠️ P125: `first_name`/`last_name` looks like the answer and is not — it is a
  // whitespace split of the same string (`Metropolitan` / `Life Insurance`) and
  // is absent on a real individual (`Kalven Cederberg`). A proxy for a fact you
  // already hold is not a measurement.
  assert.doesNotMatch(CODE, /\b(first_name|last_name)\b/,
    'first_name/last_name carries no information entities.name does not already ' +
    'carry — it cannot corroborate the column it is derived from');
});

test('the corroboration is a CTE, not a per-row EXISTS inside the arms', () => {
  // §7.7 measured that an expression referenced in all nine VALUES rows is
  // evaluated nine times per candidate — that is what made the inlined `cand`
  // shape 2.4x slower until the guards moved out of the arms. `sfc` mirrors the
  // existing `op` CTE: one scan, one hash join, one boolean on the row.
  assert.match(SQL, /\nsfc as \(/, 'sfc must be a CTE');
  assert.match(SQL, /left join sfc\s+on sfc\.entity_id = e\.id/,
    'sfc must reach cand by a join, so the arms read a column');
  assert.match(SQL, /\(sfc\.entity_id is not null\)\s+as has_sf_contact/,
    'has_sf_contact must be a column on cand');
  assert.doesNotMatch(ARMS, /exists\s*\(/i,
    'a correlated EXISTS in the arms is evaluated once per VALUES row per candidate');
});

test('the reviewed rows are a LEDGER, never a name stoplist in the classifier', () => {
  // §3: "record it as reviewed rows, the lcc_entity_role_confirmation pattern
  // §8 just used for user_owner." The classifier must stay free of the list.
  assert.match(LEDGER_INSERT, /'one_off_owner',\s*\n?\s*'rejected'/,
    'the verdict vocabulary is CHECK-constrained to confirmed/rejected (§8)');
  assert.match(LEDGER_INSERT, /'c13c_named_review'/,
    'the reviewed rows must be attributable to the review that produced them');
  assert.match(LEDGER_INSERT, /on conflict \(entity_id, role\) do nothing/,
    're-running the migration must not duplicate or overwrite a verdict');
  // ⚠️ THE NAME JOIN IS A TRIPWIRE, NOT A LOOKUP KEY. entity_id is the key;
  // re-checking the name makes a merge, rename or repoint since the review FAIL
  // rather than silently stamping a verdict on a party nobody read.
  assert.match(LEDGER_INSERT, /join public\.entities e\s*\n\s*on e\.id = v\.entity_id::uuid\s*\n\s*and e\.name = v\.entity_name/,
    'the ledger insert must re-verify the name it was reviewed under');
  assert.match(SQL, /if n <> 21 then\s*\n?\s*raise exception/,
    'the insert must assert its own row count — a silently dropped row is a ' +
    'verdict that never landed');
  // The classifier itself must contain no direct name comparison. The two
  // pre-existing exclusion guards are FUNCTION calls in the outer WHERE and are
  // deliberately still allowed.
  // ⚠️ `(not\s+)?` is not decoration: the first cut of this assertion matched
  // `entity_name =` / `entity_name in (` and walked straight past
  // `entity_name NOT IN ('Jamestown','BREIT')`, which is precisely how a
  // stoplist would be written. Found by the mutation pass, not by reading it.
  assert.doesNotMatch(stripSqlStringLiterals(ROLES_VIEW), /(entity_name|e\.name)\s*(not\s+)?(=|<>|!=|~~|~\*|ilike\b|like\b|in\s*\()/i,
    'a name literal is being compared inside the role view — that is the ' +
    'stoplist-in-the-classifier §3 forbids');
  // The new ambiguity branch reads the LEDGER, so the judgement lives where a
  // human judgement belongs.
  assert.match(AMBIGUITY, /'entity_type_contradicted_by_named_review'/,
    'the reviewed rows must reach the ambiguity surface');
  assert.match(AMBIGUITY, /join public\.lcc_entity_role_confirmation cr\s*\n\s*on cr\.entity_id = r\.entity_id and cr\.role = 'one_off_owner' and cr\.verdict = 'rejected'/,
    'the contradicted kind must be driven by the ledger, not by a name list');
});

test('the ambiguity kind that says "rests on entity_type" lists only rows that do', () => {
  // A corroborated row rests on entity_type AND a salesforce/Contact identity,
  // so listing it under a kind whose name says otherwise would be false. It is
  // not perfect and that is stated rather than hidden: `Law Offices` is in the
  // corroborated 13 and is a firm — one named false positive in 13 beats a rule
  // nobody has graded (§4).
  const kind = between(AMBIGUITY, "'one_off_owner_rests_on_recorded_entity_type'",
    'union all', 'rests-on-entity_type kind');
  assert.match(kind, new RegExp(`r\\.evidence_arm = '${UNVERIFIED}'`),
    'this kind must be narrowed to the uncorroborated arm');
});

test('nothing else moves — investor_owner, entity_type and the other arms', () => {
  // §4: "Do not touch investor_owner." Those same institutional entities are
  // CORRECTLY investor_owner and must stay so; only their one_off_owner claim
  // is false. And "do not fix entities.entity_type itself in this unit" — it is
  // written by other producers and read by other consumers.
  const investor = between(ARMS, "'investor_owner', 'current_portfolio_fact'", '))', 'investor arm');
  assert.match(investor, /c\.current_assets >= 1/,
    'the investor_owner arm must stay >= 1 current portfolio fact');
  assert.doesNotMatch(investor, /has_sf_contact|entity_type/,
    'the corroboration must not reach investor_owner');
  assert.doesNotMatch(SQL, /\bupdate\s+public\.entities\b|\bupdate\s+entities\b/i,
    'this unit must not repair entities.entity_type — that is a fleet-wide ' +
    'change with its own blast radius, sized and filed, not started here');
  assert.doesNotMatch(SQL, /\balter table\b[\s\S]{0,80}entities/i,
    'this unit must not add a stamped column to entities');
  assert.doesNotMatch(SQL, /create\s+materialized\s+view/i,
    'materialize only on a measurement');
  // The other six derived arms keep their own evidence and are not re-graded here.
  for (const arm of ['human_confirmed_owner_occupier', 'current_portfolio_fact',
    'distinct_assets_acquired', 'ended_holding_no_current',
    'gov_first_generation_classifier', 'manual_override']) {
    assert.ok(ARMS.includes(`'${arm}'`), `the ${arm} arm is gone`);
  }
});

test('the partial index is reachable by the predicate that needs it', () => {
  // P118 corollary 3: a PARTIAL index is only usable if the query's own
  // predicates IMPLY the index predicate. Building it over a wider or narrower
  // condition than `sfc` states produces a valid index the planner never uses.
  const idx = between(SQL, 'create index if not exists idx_extid_salesforce_contact_entity', ';', 'partial index');
  assert.match(idx, /on public\.external_identities \(entity_id\)/);
  assert.match(idx, /where source_system = 'salesforce' and source_type = 'Contact'/,
    'the index predicate must match the sfc CTE verbatim or the planner ignores it');
  assert.doesNotMatch(idx, /concurrently/i,
    'P118: a cancelled CREATE INDEX CONCURRENTLY leaves an INVALID index behind, ' +
    'and this one is ~10k entries');
});
