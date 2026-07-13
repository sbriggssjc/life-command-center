// Ownership-resolution consolidation (2026-06-30): the Decision Center's five+
// overlapping ownership lanes collapse into ONE property-keyed `resolve_ownership`
// lane (gov v_ownership_resolution). This guards the consolidation contract at the
// JS layer; the SQL reconciler's dedup / spe-exclusion / rent-rank are the view's
// job and are verified live (2,015 distinct props, property 7486 deed+discrepancy
// → one card, 0 spe leak, rent-ranked).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const admin = readFileSync(join(root, 'api/admin.js'), 'utf8');
const ops = readFileSync(join(root, 'ops.js'), 'utf8');

function fedSet(src, re) {
  const m = src.match(re);
  assert.ok(m, 'could not find the federated set literal');
  return new Set((m[1].match(/'([a-z_]+)'/g) || []).map((s) => s.replace(/'/g, '')));
}

describe('ownership-resolution consolidation', () => {
  it('resolve_ownership is federated on BOTH server + client; the retired lanes are gone', () => {
    const server = fedSet(admin, /FEDERATED_DECISION_TYPES\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
    const client = fedSet(ops, /_DC_FEDERATED\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
    for (const s of [server, client]) {
      assert.ok(s.has('resolve_ownership'), 'resolve_ownership must be a federated lane');
      assert.ok(!s.has('owner_source_conflict'), 'owner_source_conflict lane must be retired');
      assert.ok(!s.has('suspected_sale'), 'suspected_sale lane must be retired');
    }
  });

  it('the subject_ref is keyed on PROPERTY ONLY → ≥2 signals collapse to one card', () => {
    // The old suspected_sale key carried `+ s.signal_source` (one card per signal).
    // The consolidated key is property-only, so a property with a deed + lessor +
    // discrepancy signal maps to the SAME subject_ref → one decision, no double-count.
    const m = admin.match(/case 'resolve_ownership':\s*return[^\n;]*/);
    assert.ok(m, 'resolve_ownership subject_ref case must exist');
    assert.match(m[0], /property_id/, 'subject_ref must key on property_id');
    assert.doesNotMatch(m[0], /signal_source|conflict_kind/, 'subject_ref must NOT fragment per signal');
    assert.match(m[0], /resolveown:gov:/, 'subject_ref uses the resolveown:gov: prefix');
  });

  it('the lane reads the spe-excluding reconciler view, value-ranked by rent', () => {
    // v_ownership_resolution already excludes spe_vs_parent and is one row per
    // property; the fetch orders fresh-before-stale then by rent desc.
    const m = admin.match(/if \(type === 'resolve_ownership'\)[\s\S]*?return out;\n {2}\}/);
    assert.ok(m, 'resolve_ownership fetch branch must exist');
    assert.match(m[0], /v_ownership_resolution\?/, 'reads v_ownership_resolution (spe excluded)');
    assert.match(m[0], /annual_rent\.desc/, 'value-ranked by rent');
    assert.match(m[0], /recency_rank\.asc/, 'fresh signals first');
  });

  it('the pending_update lane excludes the ownership-discrepancy slice', () => {
    // The recorded_owner_id discrepancies moved to resolve_ownership; the pending
    // lane must not double-surface them.
    const m = admin.match(/if \(type === 'pending_update'\)[\s\S]*?return out;\n {2}\}/);
    assert.ok(m, 'pending_update fetch branch must exist');
    assert.match(m[0], /field_name=neq\.recorded_owner_id/, 'excludes the ownership-discrepancy slice');
  });

  it('the card + confirm-sale helper render the consolidated lane', () => {
    assert.match(ops, /_dcFedType === 'resolve_ownership'/, 'card branch exists');
    assert.match(ops, /function dcResolveConfirmSale/, 'confirm-sale helper exists');
    assert.match(ops, /dcFed\(i, ?'update_owner'\)|dcFed\(' \+ i \+ ',\\'update_owner\\'\)/, 'update_owner verdict wired');
  });
});
