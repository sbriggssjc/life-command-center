// ============================================================================
// Copilot connector drift guard (session 36o/36p, 2026-08-06)
//
// THE INCIDENT: the W7.3 actions (log_call_note, tag_comm_to_deal) were registered
// in api/operations.js ACTION_REGISTRY + the architecture registry docs, but never
// added to the canonical connector spec's dispatchCopilotAction copilot_action enum
// (copilot/lcc-deal-intelligence.connector.v4.swagger.json) — so Copilot could not
// see them. The server registry and the connector spec are TWO surfaces that must
// move together (see the banner in docs/setup/COPILOT_STUDIO_SETUP.md).
//
// This test makes that drift a CI failure:
//   1. ACTION_REGISTRY keys === the v4 spec's copilot_action enum (exact set match,
//      both directions — a spec-only or server-only action is a bug either way).
//   2. Every action documented in docs/architecture/copilot_action_registry.json is
//      reachable: either in the dispatch enum OR a dedicated operationId in the spec
//      (the comps trio uses dedicated operations by design).
//   3. Exactly ONE connector spec lives in copilot/ (legacy specs must stay in
//      docs/archive/openapi-legacy/ — a second spec in copilot/ recreates the
//      multiple-sources-of-truth hazard).
// ============================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPEC_PATH = path.join(ROOT, 'copilot', 'lcc-deal-intelligence.connector.v4.swagger.json');

function specParts() {
  const spec = JSON.parse(readFileSync(SPEC_PATH, 'utf8'));
  let dispatchEnum = null;
  const operationIds = new Set();
  for (const methods of Object.values(spec.paths || {})) {
    for (const op of Object.values(methods)) {
      if (op && op.operationId) operationIds.add(op.operationId);
      if (op && op.operationId === 'dispatchCopilotAction') {
        const body = (op.parameters || []).find((p) => p.in === 'body');
        dispatchEnum = body?.schema?.properties?.copilot_action?.enum || null;
      }
    }
  }
  return { spec, dispatchEnum, operationIds };
}

function serverRegistryKeys() {
  const src = readFileSync(path.join(ROOT, 'api', 'operations.js'), 'utf8');
  const m = src.match(/ACTION_REGISTRY\s*=\s*{([\s\S]*?)\n};/);
  assert.ok(m, 'ACTION_REGISTRY block not found in api/operations.js');
  const keys = new Set();
  for (const km of m[1].matchAll(/^\s*['"]?([a-z_0-9]+)['"]?:\s*{/gm)) keys.add(km[1]);
  assert.ok(keys.size > 0, 'ACTION_REGISTRY parsed to zero keys — regex drift, fix this test');
  return keys;
}

test('dispatch enum matches ACTION_REGISTRY exactly (both directions)', () => {
  const { dispatchEnum } = specParts();
  assert.ok(Array.isArray(dispatchEnum), 'dispatchCopilotAction copilot_action enum missing from v4 spec');
  const specSet = new Set(dispatchEnum);
  const reg = serverRegistryKeys();
  const missingFromSpec = [...reg].filter((a) => !specSet.has(a)).sort();
  const missingFromServer = [...specSet].filter((a) => !reg.has(a)).sort();
  assert.deepEqual(missingFromSpec, [],
    `Actions registered server-side but ABSENT from the connector spec enum (Copilot cannot see them — update copilot/lcc-deal-intelligence.connector.v4.swagger.json, bump info.version, re-import the EXISTING connector): ${missingFromSpec.join(', ')}`);
  assert.deepEqual(missingFromServer, [],
    `Actions in the connector spec enum with NO server-side registration (dead enum entries): ${missingFromServer.join(', ')}`);
});

test('every documented registry action is reachable in the spec', () => {
  const { dispatchEnum, operationIds } = specParts();
  const specSet = new Set(dispatchEnum || []);
  const registry = JSON.parse(readFileSync(
    path.join(ROOT, 'docs', 'architecture', 'copilot_action_registry.json'), 'utf8'));
  const pascal = (s) => s.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
  const unreachable = registry.actions
    .map((a) => a.action_name)
    .filter((n) => !specSet.has(n) && !operationIds.has(n) && !operationIds.has(pascal(n)))
    .sort();
  assert.deepEqual(unreachable, [],
    `Documented registry actions unreachable via the connector (neither dispatch enum nor a dedicated operation): ${unreachable.join(', ')}`);
});

test('copilot/ holds exactly one connector spec (legacy specs live in docs/archive)', () => {
  const specs = readdirSync(path.join(ROOT, 'copilot'))
    .filter((f) => /swagger|openapi/i.test(f));
  assert.deepEqual(specs, ['lcc-deal-intelligence.connector.v4.swagger.json'],
    `Exactly one canonical spec expected in copilot/; found: ${specs.join(', ')} — move legacy specs to docs/archive/openapi-legacy/`);
});
