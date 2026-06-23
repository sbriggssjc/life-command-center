// R64 — the Decision Center splits its lanes into ACTIONABLE VERDICT lanes (the
// primary worklist + nav badge) and the large FEDERATED data-quality universe
// (worked on demand, NOT in the badge). The partition is defined in two places —
// FEDERATED_DECISION_TYPES in api/admin.js (server) and _DC_FEDERATED in ops.js
// (client). They MUST stay identical, else the badge would count the wrong set.
// This guard parses both literals and asserts they match exactly.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function extractSet(file, declRe) {
  const src = readFileSync(join(root, file), 'utf8');
  const m = src.match(declRe);
  assert.ok(m, `could not find the set literal in ${file}`);
  // Pull every single-quoted string inside the new Set([...]) block.
  return new Set((m[1].match(/'([a-z_]+)'/g) || []).map((s) => s.replace(/'/g, '')));
}

describe('R64 Decision Center federated-lane partition', () => {
  it('ops.js _DC_FEDERATED matches admin.js FEDERATED_DECISION_TYPES exactly', () => {
    const server = extractSet('api/admin.js', /FEDERATED_DECISION_TYPES\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
    const client = extractSet('ops.js', /_DC_FEDERATED\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
    assert.ok(server.size >= 10, 'server federated set looks too small');
    assert.deepEqual([...client].sort(), [...server].sort());
  });

  it('the seeded verdict lanes are NOT in the federated set', () => {
    const client = extractSet('ops.js', /_DC_FEDERATED\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
    for (const dt of ['confirm_true_owner', 'sf_link_collision', 'sf_link_conflict',
      'map_sf_parent_account', 'confirm_buyer_parent', 'junk_entity_name', 'match_disambiguation']) {
      assert.ok(!client.has(dt), `${dt} must be an actionable verdict lane, not federated`);
    }
  });
});
