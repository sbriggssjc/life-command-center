// Prompt 76 (W8) — pin the three fixes:
//   U3 mint fix: the w8_u3_link_review confirm branch mints entities WITH
//     canonical_name (entities.canonical_name is NOT NULL) and resolves the linked
//     entity on canonical_name (not the raw name), with a ≥2-match ambiguity guard.
//   Repair migration: idempotent (guarded) reset of the mislabeled USAA row.
//   U2 seeder chips: the owner_reconcile lane exposes per-seeder sub-counts (parts)
//     and a client-side seeder filter so the 38 Ollama pairs are reachable.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const adminSrc = readFileSync(join(root, 'api/admin.js'), 'utf8');
const opsSrc = readFileSync(join(root, 'ops.js'), 'utf8');
const repairSrc = readFileSync(
  join(root, 'supabase/migrations/20260825120000_lcc_w8_u3_mint_repair.sql'), 'utf8');

// Isolate the w8_u3_link_review confirm branch (chain-pool mint/resolve section).
function u3Branch() {
  const start = adminSrc.indexOf("Resolve the linked entity (by HOUSE canonical_name");
  assert.ok(start > -1, 'could not find the U3 resolve-before-mint section in admin.js');
  const end = adminSrc.indexOf('self_loop', start);
  assert.ok(end > start, 'could not bound the U3 mint section');
  return adminSrc.slice(start, end);
}

describe('W8 U3 mint fix — canonical_name on mint + resolve', () => {
  const branch = u3Branch();

  it('imports the house canonical normalizer', () => {
    assert.match(adminSrc, /import\s*\{[^}]*normalizeCanonicalName[^}]*\}\s*from\s*'\.\/_shared\/entity-link\.js'/);
  });

  it('the entities mint INSERT includes canonical_name', () => {
    // The POST body to 'entities' in the U3 branch must carry canonical_name.
    const m = branch.match(/opsQuery\('POST',\s*'entities',\s*\{[\s\S]*?\}/);
    assert.ok(m, 'no entities POST found in the U3 mint branch');
    assert.match(m[0], /canonical_name:/, 'mint INSERT must set canonical_name (entities.canonical_name is NOT NULL)');
    assert.match(m[0], /entity_type:\s*'organization'/);
  });

  it('resolves the linked entity on canonical_name, not the raw name', () => {
    assert.match(branch, /entities\?select=id[^']*&canonical_name=eq\.'/,
      'resolve GET must match on canonical_name=eq.<normalized>');
    assert.doesNotMatch(branch, /entities\?select=id&name=eq\./,
      'resolve must NOT match on the raw name (would mint duplicates for case/format variants)');
    assert.match(branch, /normalizeCanonicalName\(linkedName\)/);
  });

  it('keeps the ≥2-canonical-match ambiguity guard (never guess → conflict card)', () => {
    assert.match(branch, /canonMatches\.length\s*>=\s*2/);
    assert.match(branch, /ambiguous_entity_match/);
    assert.match(branch, /status:\s*'conflict'/);
  });
});

describe('W8 repair migration — idempotent, only the USAA row', () => {
  it('un-rejects review_id 1 (USAA) with a status guard so re-runs no-op', () => {
    assert.match(repairSrc, /UPDATE\s+public\.w8_u3_link_review[\s\S]*?SET\s+status\s*=\s*'proposed'/i);
    assert.match(repairSrc, /WHERE[\s\S]*?review_id\s*=\s*1[\s\S]*?status\s*=\s*'rejected'/i);
    assert.match(repairSrc, /USAA Real Estate/);
  });

  it('supersedes the mislabeled verdict decision row (skipped/reject -> open)', () => {
    assert.match(repairSrc, /UPDATE\s+public\.lcc_decisions[\s\S]*?SET\s+status\s*=\s*'open'/i);
    assert.match(repairSrc, /status\s*=\s*'skipped'[\s\S]*?verdict\s*=\s*'reject'/i);
    assert.match(repairSrc, /superseded_reason/);
  });

  it('does NOT touch review_id 2 (Trammell Crow)', () => {
    assert.doesNotMatch(repairSrc, /review_id\s*=\s*2/);
    assert.doesNotMatch(repairSrc, /Trammell Crow'[\s\S]*?SET/i);
  });
});

describe('W8 U2 seeder discoverability — owner_reconcile chips', () => {
  it('backend returns per-seeder parts with the ollama sub-count', () => {
    assert.match(adminSrc, /out\.parts\s*=\s*\{[\s\S]*?w8_u2_ollama_pair:/);
  });

  it('backend sorts w8_u2_ollama_pair rows first', () => {
    assert.match(adminSrc, /seederRank[\s\S]*?w8_u2_ollama_pair/);
  });

  it('listFederatedLane surfaces src.parts to the client', () => {
    assert.match(adminSrc, /if\s*\(src\.parts\)\s*ret\.parts\s*=\s*src\.parts/);
  });

  it('frontend renders seeder chips for owner_reconcile and a filter fn', () => {
    assert.match(opsSrc, /type === 'owner_reconcile'[\s\S]*?ownRecSeederChips/);
    assert.match(opsSrc, /Ollama pairs/);
    assert.match(opsSrc, /function dcFedSeederFilter/);
    assert.match(opsSrc, /window\.dcFedSeederFilter\s*=\s*dcFedSeederFilter/);
  });

  it('cards carry a data-seeder attribute for client-side filtering', () => {
    assert.match(opsSrc, /data-seeder="/);
  });
});
