// ============================================================================
// Copilot v2 connector spec slim guard (Prompt 66, 2026-08-07)
//
// THE INCIDENT this prevents: the `LCC Intelligence` custom connector (built from
// GET /api/copilot-spec-v2) exposed 95 operations to the Copilot Deal Agent —
// Microsoft's generative orchestration recommends ≤ 25–30 tools and the agent
// errored on its own greeting past that. The 95 was inflated because
// generateSwagger2Spec emitted each action THREE times: a discrete PascalCase op,
// a snake_case /compat/ alias, and a single dispatchCopilotAction catch-all
// gateway at /api/chat. Prompt 66 dropped the compat aliases + gateway from the
// v2 spec (runtime routes stay mounted in server.js), roughly halving the count.
//
// This test makes a regression a CI failure: no dispatchCopilotAction op, no
// /api/copilot/compat/* paths, every operationId unique, and the discrete
// briefing op present under the exact name the agent/instructions rely on.
//
// Scope: ONLY generateSwagger2Spec (/api/copilot-spec-v2). generateOpenApiSpec
// (/api/copilot-spec) and generateChatGptSpec (/api/gpt-spec) are untouched.
// ============================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSwagger2Spec, ACTION_SCHEMAS } from '../api/_shared/action-schemas.js';

// Exercise the real generator over the real schema set. The runtime passes
// ACTION_REGISTRY; the generator only emits actions that have an ACTION_SCHEMAS
// entry, so a registry keyed on ACTION_SCHEMAS reproduces the emitted per-action
// surface exactly (each entry a tier-0 read stub is enough — the guardrails are
// about which operations/paths exist, not their tier labels).
function v2Spec() {
  const registry = Object.fromEntries(Object.keys(ACTION_SCHEMAS).map((k) => [k, { tier: 0 }]));
  return generateSwagger2Spec(registry, 'https://tranquil-delight-production-633f.up.railway.app');
}

function allOperations(spec) {
  const ops = [];
  for (const methods of Object.values(spec.paths || {})) {
    for (const op of Object.values(methods)) {
      if (op && op.operationId) ops.push(op);
    }
  }
  return ops;
}

test('v2 spec is valid Swagger 2.0', () => {
  const spec = v2Spec();
  assert.equal(spec.swagger, '2.0');
  assert.ok(spec.paths && typeof spec.paths === 'object', 'paths object present');
});

test('no dispatchCopilotAction catch-all gateway is advertised', () => {
  const spec = v2Spec();
  const ops = allOperations(spec);
  assert.ok(!ops.some((op) => op.operationId === 'dispatchCopilotAction'),
    'dispatchCopilotAction must not appear in the v2 connector spec');
  assert.ok(!('/api/chat' in spec.paths), '/api/chat gateway path must not be advertised');
});

test('no /api/copilot/compat/* snake_case alias paths remain', () => {
  const spec = v2Spec();
  const compat = Object.keys(spec.paths).filter((p) => p.startsWith('/api/copilot/compat/'));
  assert.deepEqual(compat, [], `unexpected compat alias paths: ${compat.join(', ')}`);
});

test('every operationId is unique', () => {
  const spec = v2Spec();
  const ids = allOperations(spec).map((op) => op.operationId);
  assert.equal(new Set(ids).size, ids.length, 'duplicate operationId in v2 spec');
});

test('discrete briefing op is present and named GetDailyBriefingSnapshot', () => {
  const spec = v2Spec();
  const ids = new Set(allOperations(spec).map((op) => op.operationId));
  assert.ok(ids.has('GetDailyBriefingSnapshot'),
    'the agent/instructions rely on the exact op name GetDailyBriefingSnapshot');
});

test('operation count ≈ actions + typed gateway ops (roughly halved from 95)', () => {
  const spec = v2Spec();
  const count = allOperations(spec).length;
  // 43 discrete actions + 4 typed gateway ops today; a compat/gateway
  // regression would roughly double this. Guard the halved regime, not an
  // exact number, so adding a real action doesn't trip the test.
  assert.ok(count < 60, `expected the slimmed count (~48), got ${count}`);
  assert.ok(count >= Object.keys(ACTION_SCHEMAS).length,
    'every schema-backed action should still emit a discrete op');
});
