// ============================================================================
// ChatGPT curated GPT-Action spec — anti-drift guard (Prompt 59, 2026-08-06)
//
// THE INCIDENT this prevents: the hand-maintained ChatGPT spec
// (docs/comps-rollout/lcc-openapi.yaml) declared the daily briefing at
// /api/ai/daily-briefing while mountLccMcp() actually mounts it (Bearer-authed)
// at /api/daily-briefing. A stale file silently mis-routes a tool — the GPT
// calls a path that isn't there. This test makes that a CI failure by MOUNTING
// the real MCP surface, introspecting the Express router, and asserting that
// EVERY curated operation maps to a route that is:
//   1. actually mounted (path + HTTP method present), and
//   2. Bearer-authenticated (an `authenticate` middleware sits before the
//      handler — every mountLccMcp /api/* route registers as `authenticate,
//      handler`, so the route stack has ≥ 2 layers).
//
// It also asserts the curated op count stays ≤ 30 (the ChatGPT GPT-Action cap).
// ============================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mountLccMcp } from '../mcp/server.js';
import { generateChatGptSpec, CHATGPT_CURATED_OPERATIONS } from '../api/_shared/action-schemas.js';

// Mount the real MCP HTTP surface (no global middleware) and collect its routes.
function mountedRoutes() {
  const app = express();
  mountLccMcp(app, { installMiddleware: false });
  const routes = new Map(); // `${METHOD} ${path}` -> layerCount
  for (const layer of app._router.stack) {
    if (!layer.route) continue;
    for (const method of Object.keys(layer.route.methods)) {
      if (!layer.route.methods[method]) continue;
      routes.set(`${method.toUpperCase()} ${layer.route.path}`, layer.route.stack.length);
    }
  }
  return routes;
}

test('curated op count is within the ChatGPT 30-operation cap', () => {
  const spec = generateChatGptSpec('https://example.test');
  let count = 0;
  for (const methods of Object.values(spec.paths)) count += Object.keys(methods).length;
  assert.equal(count, CHATGPT_CURATED_OPERATIONS.length,
    'generated op count should equal the curated list length');
  assert.ok(count <= 30, `curated spec has ${count} operations — ChatGPT caps a GPT Action at 30`);
});

test('every curated operation maps to a mounted, Bearer-authed route', () => {
  const routes = mountedRoutes();
  const spec = generateChatGptSpec('https://example.test');
  const problems = [];
  for (const [pathKey, methods] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      const key = `${method.toUpperCase()} ${pathKey}`;
      const layers = routes.get(key);
      if (layers === undefined) {
        problems.push(`${op.operationId}: ${key} is NOT mounted by mountLccMcp (path/method drift — register the live route in mcp/server.js or fix the curated path)`);
      } else if (layers < 2) {
        problems.push(`${op.operationId}: ${key} is mounted but NOT Bearer-authenticated (no authenticate middleware before the handler)`);
      }
    }
  }
  assert.deepEqual(problems, [], `Curated ChatGPT ops drifted from the mounted routes:\n  ${problems.join('\n  ')}`);
});

test('the daily briefing is the canonical /api/daily-briefing (not /api/ai/daily-briefing)', () => {
  // The exact drift the static yaml carried — pin the canonical path.
  const briefing = CHATGPT_CURATED_OPERATIONS.find(o => o.operationId === 'getDailyBriefing');
  assert.ok(briefing, 'getDailyBriefing must be in the curated set');
  assert.equal(briefing.path, '/api/daily-briefing');
});
