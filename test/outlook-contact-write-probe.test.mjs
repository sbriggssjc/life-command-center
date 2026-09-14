// ============================================================================
// test/outlook-contact-write-probe.test.mjs — Prompt 184
//
// Guards flow-lcc-probe-outlook-contact-write.json, the Probe B definition that
// answers "is /me/contacts actually writable via Graph?".
//
// The assertions are STRUCTURAL/behavioural, not literal greps of a block that
// can drift (the recurring block-slice footgun in CLAUDE.md). Each one pins a
// property that, if lost, would make the probe unable to answer its own
// question — which is exactly how the doc's original design failed.
// ============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const flow = JSON.parse(
  readFileSync(new URL('../flow-lcc-probe-outlook-contact-write.json', import.meta.url), 'utf8')
);

/** Walk every action in the definition, including nested If branches. */
function walkActions(actions, out = []) {
  for (const [name, def] of Object.entries(actions || {})) {
    out.push([name, def]);
    if (def.actions) walkActions(def.actions, out);
    if (def.else?.actions) walkActions(def.else.actions, out);
  }
  return out;
}
const all = walkActions(flow.actions);
const byName = Object.fromEntries(all);

test('probe never carries a transmitting operation', () => {
  // Contacts have no send operation, but the guard is cheap and the draft-flow
  // precedent exists: a definition under the user's own mailbox connection must
  // never be one refactor away from transmitting.
  const FORBIDDEN = /\b(send|reply|forward)\b/i;
  for (const [name, def] of all) {
    const op = def?.inputs?.host?.operationId || '';
    const uri = def?.inputs?.parameters?.Uri || '';
    assert.ok(!FORBIDDEN.test(op), `${name}: transmitting operationId ${op}`);
    assert.ok(!FORBIDDEN.test(uri), `${name}: transmitting Uri ${uri}`);
  }
});

test('the sentinel is DERIVED from the baseline, so it cannot equal it', () => {
  // The whole defect in the original probe design: writing jobTitle back to its
  // existing value makes a real write and a silent discard re-read identical.
  const sentinel = byName['Init_sentinel'];
  assert.ok(sentinel, 'Init_sentinel action missing');
  const value = JSON.stringify(sentinel.inputs.variables[0].value);
  assert.match(value, /variables\('before'\)/, 'sentinel must reference the baseline');
  assert.match(value, /concat\(/, 'sentinel must EXTEND the baseline, not restate it');
});

test('the verdict is computed from the RE-READ, not the PATCH status', () => {
  // Graph can return 200 and discard. A verdict that reads only the status code
  // is the failure this probe exists to prevent.
  const verdict = byName['Respond_verdict'].inputs.body.verdict;
  assert.match(verdict, /body\('Reread_after_patch'\)/,
    'verdict must compare the re-read value');
  assert.match(verdict, /ACCEPTED_THEN_DISCARDED/,
    'the accept-then-discard outcome must be nameable, not folded into success');
});

test('a write is always followed by a restore and a cleanup re-read', () => {
  assert.ok(byName['Restore_original'], 'probe must restore the original value');
  assert.deepEqual(
    Object.keys(byName['Restore_original'].runAfter),
    ['Reread_after_patch'],
    'restore must run only after the verdict has been observed'
  );
  // Restore must run even when the PATCH failed — otherwise a partial write stays.
  assert.ok(byName['Restore_original'].runAfter['Reread_after_patch'].includes('Failed'));
  assert.ok(byName['Reread_after_restore'], 'cleanup must be verified, not assumed');
  assert.match(
    JSON.stringify(byName['Respond_verdict'].inputs.body.restored_cleanly),
    /Reread_after_restore/,
    'the response must report whether the probe left a mark'
  );
});

test('every Graph call carrying a Body sets ContentType', () => {
  // P125: Graph 400s "Empty Content-Type provided" without it.
  for (const [name, def] of all) {
    const p = def?.inputs?.parameters;
    if (p && p.Body !== undefined) {
      assert.equal(p.ContentType, 'application/json', `${name}: missing ContentType`);
    }
  }
});

test('dry-run is the default and writes nothing', () => {
  const gate = byName['Should_apply'];
  assert.ok(gate, 'Should_apply gate missing');
  assert.match(JSON.stringify(gate.expression), /coalesce\(triggerBody\(\)\?\['apply'\],\s*false\)/,
    'apply must default to false');
  const dryRunBranch = walkActions(gate.else.actions).map(([n]) => n);
  assert.deepEqual(dryRunBranch, ['Respond_baseline'],
    'the dry-run branch must contain nothing but a response');
});

test('"not found" is kept distinct from "not writable"', () => {
  const nf = byName['Respond_not_found'];
  assert.ok(nf, 'missing not-found branch');
  assert.equal(nf.inputs.body.verdict, 'CONTACT_NOT_FOUND');
  assert.notEqual(nf.inputs.statusCode, 200);
});
