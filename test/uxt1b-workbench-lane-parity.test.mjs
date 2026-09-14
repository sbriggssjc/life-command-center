// UX-T1b guard — the workbench lane vocabulary must match between the SQL
// migration (v_lcc_research_workbench_flow's lane_defs CTE) and the JS
// module (api/_shared/workbench-lane.js), and the `workbench` query param
// must be wired into BOTH the v1 and v2 research handlers in api/queue.js.
//
// This is the P132/A1 lesson pinned as a test: "whenever you add a query
// param to a v1 queue view, add it to v2 in the same change" — a filter
// implemented in one branch silently stops filtering the moment
// queue_v2_enabled flips, with no error anywhere.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const migrationPath = path.join(
  repoRoot, 'supabase/migrations/20261017120000_lcc_uxt1b_research_workbench.sql'
);
const modulePath = path.join(repoRoot, 'api/_shared/workbench-lane.js');
const queuePath = path.join(repoRoot, 'api/queue.js');

const migrationSrc = readFileSync(migrationPath, 'utf8');
const moduleSrc = readFileSync(modulePath, 'utf8');
const queueSrc = readFileSync(queuePath, 'utf8');

// Strip SQL line comments (--) and JS line/block comments before parsing —
// per the repo's standing rule (A5c/N18/B1): a source detector that does not
// strip comments can pass over its own deleted logic, or fail on a comment
// that merely explains the rule.
function stripSqlComments(src) {
  return src.split('\n').map((line) => line.replace(/--.*$/, '')).join('\n');
}
function stripJsComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
    .map((line) => line.replace(/\/\/.*$/, '')).join('\n');
}

const migClean = stripSqlComments(migrationSrc);
const modClean = stripJsComments(moduleSrc);

/** Parse `'a','b','c'` inside array[...] literal into a plain string array. */
function parsePgTextArray(literal) {
  return [...literal.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

function laneDefsFromSql(src) {
  const valuesBlockMatch = src.match(/lane_defs\([^)]*\)\s+as\s*\(\s*values([\s\S]*?)\n\)/);
  assert.ok(valuesBlockMatch, 'migration must define a lane_defs(...) CTE with a VALUES list');
  const block = valuesBlockMatch[1];
  // Each row: ('key', 'Label', array[...])
  const rows = [...block.matchAll(/\(\s*'([a-z_]+)'\s*,\s*'[^']*'\s*,\s*array\[([^\]]*)\]\s*\)/g)];
  assert.ok(rows.length >= 4, `expected at least 4 lane_defs rows, found ${rows.length}`);
  const out = {};
  for (const [, key, arrLiteral] of rows) out[key] = parsePgTextArray(arrLiteral);
  return out;
}

function laneDefsFromJs(src) {
  const grab = (name) => {
    const m = src.match(new RegExp(`${name}\\s*=\\s*Object\\.freeze\\(\\[([^\\]]*)\\]\\)`));
    assert.ok(m, `workbench-lane.js must export ${name}`);
    return parsePgTextArray(m[1]);
  };
  return {
    ownership_history: grab('WORKBENCH_OWNERSHIP_HISTORY_TYPES'),
    owner_contact: grab('WORKBENCH_OWNER_CONTACT_TYPES'),
    npi: grab('WORKBENCH_NPI_TYPES'),
    followups: grab('WORKBENCH_FOLLOWUP_TYPES'),
  };
}

test('SQL lane_defs and JS workbench-lane exports carry the identical research_type vocabulary', () => {
  const sql = laneDefsFromSql(migClean);
  const js = laneDefsFromJs(modClean);
  for (const key of ['ownership_history', 'owner_contact', 'npi', 'followups']) {
    assert.ok(sql[key], `SQL lane_defs missing lane "${key}"`);
    assert.ok(js[key], `JS export missing lane "${key}"`);
    assert.deepEqual(
      [...sql[key]].sort(), [...js[key]].sort(),
      `lane "${key}" research_type list must match between SQL and JS (sql=${JSON.stringify(sql[key])} js=${JSON.stringify(js[key])})`
    );
  }
});

test('the four lane keys are exactly ownership_history/owner_contact/npi/followups on both sides', () => {
  const sql = laneDefsFromSql(migClean);
  const js = laneDefsFromJs(modClean);
  assert.deepEqual(Object.keys(sql).sort(), ['followups', 'npi', 'owner_contact', 'ownership_history']);
  assert.deepEqual(Object.keys(js).sort(), ['followups', 'npi', 'owner_contact', 'ownership_history']);
});

test('excluded lanes are named in the migration header, not silently dropped', () => {
  // The exclusion rationale lives in the header COMMENTS (prose), so this
  // reads the raw source, not the comment-stripped copy used for parsing code.
  for (const excluded of [
    'owner_needs_salesforce', 'true_owner_needs_salesforce',
    'property_missing_recorded_owner', 'property_missing_county_record',
    'property_missing_true_owner', 'trace_ownership_to_developer',
  ]) {
    assert.ok(
      migrationSrc.includes(excluded),
      `migration header must name excluded lane "${excluded}" with a reason`
    );
  }
});

// ---- v1/v2 parity in api/queue.js -----------------------------------------

function functionBody(src, fnStartRe) {
  const m = src.match(fnStartRe);
  assert.ok(m, `could not locate function via ${fnStartRe}`);
  const start = m.index;
  // Walk braces from the first '{' after the match to find the matching close.
  let i = src.indexOf('{', start);
  assert.ok(i >= 0, 'function body must open with {');
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unterminated function body');
}

test('v1 case \'research\' and v2GetResearch both wire the workbench param', () => {
  const v1Body = functionBody(queueSrc, /case 'research': \{/);
  const v2Body = functionBody(queueSrc, /async function v2GetResearch\(/);
  for (const [label, body] of [['v1', v1Body], ['v2', v2Body]]) {
    assert.match(body, /isWorkbenchLane\(workbench\)/, `${label} research handler must validate workbench`);
    assert.match(body, /fetchWorkbenchLaneTaskIds\(opsQuery,\s*\{\s*lane:\s*'owner_contact'/,
      `${label} research handler must fetch owner_contact ids via fetchWorkbenchLaneTaskIds`);
    assert.match(body, /workbenchLaneResearchTypes\(workbench\)/,
      `${label} research handler must resolve the direct-filter lanes via workbenchLaneResearchTypes`);
    assert.match(body, /research_type=in\.\(\$\{wbTypes\.map\(pgFilterVal\)\.join\(','\)\}\)/,
      `${label} research handler must apply wbTypes as an IN filter`);
  }
});

test('v1 and v2 both echo `workbench` on the response so the client can confirm which tab it got', () => {
  const v1Body = functionBody(queueSrc, /case 'research': \{/);
  const v2Body = functionBody(queueSrc, /async function v2GetResearch\(/);
  assert.match(v1Body, /workbench:\s*workbench \|\| null/);
  assert.match(v2Body, /workbench:\s*workbench \|\| null/);
});

test('the research_workbench_lanes view case is registered', () => {
  assert.match(queueSrc, /case 'research_workbench_lanes':/);
  assert.match(queueSrc, /v_lcc_research_workbench_flow/);
});

// ---- positive control: mutate the SQL vocabulary and confirm it goes RED --
test('positive control: a divergent SQL array is caught by the parity test', () => {
  const mutated = migClean.replace(
    "array['owner_contact_manual']", "array['owner_contact_manual','extra_type']"
  );
  assert.notEqual(mutated, migClean, 'mutation must actually change the source');
  const sql = laneDefsFromSql(mutated);
  const js = laneDefsFromJs(modClean);
  assert.notDeepEqual([...sql.owner_contact].sort(), [...js.owner_contact].sort());
});
