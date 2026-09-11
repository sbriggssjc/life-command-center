// BROKER1 — assign every prospect to a Team Briggs broker.
//
// WHAT THIS PINS, AND WHY.
//
//  1. NAME RESOLUTION NEVER GUESSES. matchLccUser() requires the SF owner
//     name to contain exactly one known lcc_users display_name; an ambiguous
//     or unresolvable name is left alone (falls through to the vertical
//     default sweep) rather than assigned on a guess.
//
//  2. THE JS PASS REUSES roe.js::brokerClass() — it does not re-implement
//     the ROE classifier (the repo's standing "hazard travels with the
//     technique" rule: a second copy of a classifier is the normaliser
//     drift class documented repeatedly, e.g. lcc_normalize_entity_name).
//
//  3. THE SQL DEFAULT SWEEP NEVER ASSIGNS NATE. He is excluded from the
//     default population by construction — his lcc_user_id is resolved for
//     reporting only and never appears on the RHS of the owner_user_id
//     assignment in the default CASE or the INSERT.
//
//  4. THE DEFAULT INSERT IS FILL-BLANKS-ONLY — `ON CONFLICT (entity_id) DO
//     NOTHING` — so a prior assignment (manual, sf_owner-captured, or a
//     prior broker1_roe_self write) is structurally never overwritten.
//
//  5. THE HANDLER RUNS THE ROE SELF-SIGNAL PASS BEFORE THE SQL DEFAULT
//     SWEEP on apply, so a self-signal owner is already on the row before
//     the SQL sweep's "already assigned" exclusion runs — never overwritten
//     by a vertical default.
//
// Anchored on stable identity tokens (function/RPC names, the ON CONFLICT
// clause, the CASE branches) — never a line number or a sliced region.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { matchLccUser } from '../api/_shared/broker1-assign.js';

const MIGRATIONS = 'supabase/migrations';
const MIGRATION_FILE = readdirSync(MIGRATIONS).find((f) => f.includes('lcc_broker1_prospect_broker_assignment'));
assert.ok(MIGRATION_FILE, 'BROKER1 migration file must exist in supabase/migrations');
const SQL = readFileSync(`${MIGRATIONS}/${MIGRATION_FILE}`, 'utf8');

const ASSIGN_JS = readFileSync('api/_shared/broker1-assign.js', 'utf8');
const TICK_JS = readFileSync('api/_handlers/broker1-assign-tick.js', 'utf8');

function stripSqlComments(src) {
  return src.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}
function stripJsComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

// ---------------------------------------------------------------------------
// 1. matchLccUser never guesses.
// ---------------------------------------------------------------------------
test('matchLccUser: unambiguous single match resolves', () => {
  const users = [
    { lcc_user_id: 'scott-id', display_name: 'Scott Briggs' },
    { lcc_user_id: 'kelly-id', display_name: 'Kelly Largent' },
  ];
  const u = matchLccUser('Scott Briggs', users);
  assert.equal(u?.lcc_user_id, 'scott-id');
});

test('matchLccUser: name not present among known users resolves to null (never guesses)', () => {
  const users = [{ lcc_user_id: 'scott-id', display_name: 'Scott Briggs' }];
  assert.equal(matchLccUser('Some Outside Broker', users), null);
});

test('matchLccUser: ambiguous (matches more than one known user) resolves to null', () => {
  const users = [
    { lcc_user_id: 'a', display_name: 'Sam' },
    { lcc_user_id: 'b', display_name: 'Sam Adams' },
  ];
  // "Sam Adams the Third" contains both "Sam" and "Sam Adams" -> ambiguous.
  assert.equal(matchLccUser('Sam Adams the Third', users), null);
});

test('matchLccUser: blank/null owner name resolves to null', () => {
  const users = [{ lcc_user_id: 'a', display_name: 'Scott Briggs' }];
  assert.equal(matchLccUser('', users), null);
  assert.equal(matchLccUser(null, users), null);
});

// ---------------------------------------------------------------------------
// 2. The JS pass reuses roe.js::brokerClass — never a second classifier.
// ---------------------------------------------------------------------------
test('broker1-assign.js imports brokerClass from roe.js (reuse, not rebuild)', () => {
  assert.match(ASSIGN_JS, /import\s*\{\s*brokerClass\s*\}\s*from\s*['"]\.\/roe\.js['"]/);
  // And it must actually call it, not just import it (the "guard matches a
  // shape defeated by an unused import" footgun documented repeatedly).
  assert.match(stripJsComments(ASSIGN_JS), /brokerClass\(\s*ownerName\s*\)/);
});

test('broker1-assign.js defines no second brokerClass-shaped classifier', () => {
  const stripped = stripJsComments(ASSIGN_JS);
  assert.doesNotMatch(stripped, /function\s+brokerClass/);
  assert.doesNotMatch(stripped, /const\s+brokerClass\s*=/);
});

// ---------------------------------------------------------------------------
// 3. Nate is never a candidate owner in the SQL default sweep.
// ---------------------------------------------------------------------------
test('SQL: v_nate is resolved but never used as an assignable owner value', () => {
  const stripped = stripSqlComments(SQL);
  // v_nate must be declared/selected (so the function can report on him if asked)
  assert.match(stripped, /v_nate\s+uuid/);
  assert.match(stripped, /SELECT\s+lcc_user_id\s+INTO\s+v_nate/i);
  // But it must never appear as the RHS of an owner_user_id assignment/CASE/INSERT.
  const ownerAssignments = stripped.match(/owner_user_id\s*[,=]?[\s\S]{0,400}?(?=\n\s*(?:FROM|,|\)|;))/gi) || [];
  for (const clause of ownerAssignments) {
    assert.doesNotMatch(clause, /v_nate/,
      `owner_user_id-related clause must never reference v_nate: ${clause.slice(0, 120)}`);
  }
  // Direct, simple check on the CASE branch that actually assigns owners.
  const caseMatch = stripped.match(/CASE WHEN p\.domain IN \('dia', 'dialysis'\) THEN v_kelly ELSE v_scott END/);
  assert.ok(caseMatch, 'default-owner CASE must be exactly {dia -> Kelly, else -> Scott} with no Nate branch');
});

test('SQL: the default sweep is fill-blanks-only (ON CONFLICT DO NOTHING)', () => {
  const stripped = stripSqlComments(SQL);
  assert.match(stripped, /INSERT INTO public\.lcc_entity_owner_override[\s\S]{0,300}ON CONFLICT \(entity_id\) DO NOTHING/);
});

test('SQL: the default sweep excludes any prospect that already has an override row', () => {
  const stripped = stripSqlComments(SQL);
  assert.match(stripped, /WHERE NOT EXISTS \(\s*SELECT 1 FROM public\.lcc_entity_owner_override o WHERE o\.entity_id = p\.entity_id\)/);
});

test('SQL: mutating access is service_role only, never anon/authenticated', () => {
  const stripped = stripSqlComments(SQL);
  assert.match(stripped, /GRANT EXECUTE ON FUNCTION public\.lcc_broker1_assign_prospect_brokers\(boolean\) TO service_role/);
  assert.match(stripped, /REVOKE ALL ON FUNCTION public\.lcc_broker1_assign_prospect_brokers\(boolean\) FROM public, anon, authenticated/);
  assert.match(stripped, /has_function_privilege\('anon', 'public\.lcc_broker1_assign_prospect_brokers\(boolean\)', 'EXECUTE'\)/);
});

// ---------------------------------------------------------------------------
// 4. Prospect population = the seller-prospecting queue cache, stated (not a
//    guessed/undocumented population).
// ---------------------------------------------------------------------------
test('SQL: the prospect population is lcc_priority_queue_resolved, not every entities row', () => {
  const stripped = stripSqlComments(SQL);
  assert.match(stripped, /FROM public\.lcc_priority_queue_resolved q/);
});

// ---------------------------------------------------------------------------
// 5. The handler runs the ROE self-signal pass BEFORE the SQL default sweep.
// ---------------------------------------------------------------------------
test('handler: ROE self-signal pass is awaited before the default-sweep RPC call', () => {
  const stripped = stripJsComments(TICK_JS);
  const roeIdx = stripped.indexOf('applyBroker1RoeSelfSignal');
  const rpcIdx = stripped.indexOf('lcc_broker1_assign_prospect_brokers');
  assert.ok(roeIdx >= 0 && rpcIdx >= 0, 'handler must call both the ROE pass and the default-sweep RPC');
  assert.ok(roeIdx < rpcIdx, 'the ROE self-signal pass must run before the SQL default sweep, or a self-signal owner could be overwritten by a vertical default');
});

test('handler: dry run on GET, apply only on POST', () => {
  const stripped = stripJsComments(TICK_JS);
  assert.match(stripped, /const isApply = req\.method === 'POST'/);
  assert.match(stripped, /dryRun: !isApply/);
  assert.match(stripped, /p_dry_run:\s*!isApply/);
});
