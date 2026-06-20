// R51 — deed grantee → recorded_owner forward propagation.
// Covers the pure guard (granteePassesOwnerGuards), the latest-grantee picker,
// and the deps-injected propagateDeedGranteeToOwner: deed wins through the
// priority gate, the guards reject a brokerage/junk grantee (never writes), a
// manual-held field blocks the write, and an already-current owner is a no-op.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  granteePassesOwnerGuards,
  latestDeedGranteeFromMetadata,
  propagateDeedGranteeToOwner,
} from '../api/_handlers/sidebar-pipeline.js';

// ── A fake domain DB keyed by a tiny in-memory store ──
function makeDeps({ curOwnerId = 'own-OLD', curOwnerName = 'ARC GSIFLMN001 LLC',
                    gateDecision = 'write', existingOwnerId = null } = {}) {
  const calls = { patches: [], gates: [], created: [] };
  const deps = {
    async domainQuery(domain, method, path) {
      if (method === 'GET' && path.startsWith('properties?')) {
        return { ok: true, data: [{ recorded_owner_id: curOwnerId }] };
      }
      if (method === 'GET' && path.startsWith('recorded_owners?recorded_owner_id=eq.')) {
        return { ok: true, data: curOwnerId ? [{ name: curOwnerName }] : [] };
      }
      if (method === 'GET' && path.includes('canonical_name=eq.') || path.includes('normalized_name=eq.')) {
        return { ok: true, data: existingOwnerId ? [{ recorded_owner_id: existingOwnerId }] : [] };
      }
      if (method === 'POST' && path === 'recorded_owners') {
        calls.created.push(true);
        return { ok: true, data: [{ recorded_owner_id: 'own-NEW' }] };
      }
      return { ok: true, data: [] };
    },
    async domainPatch(domain, path, data, label) { calls.patches.push({ path, data, label }); return { ok: true }; },
    async shouldWriteField(args) {
      calls.gates.push(args);
      return { write: gateDecision === 'write', decision: gateDecision, currentSource: 'manual_edit' };
    },
  };
  return { deps, calls };
}

describe('granteePassesOwnerGuards', () => {
  it('accepts a plausible LLC / trust grantee', () => {
    assert.equal(granteePassesOwnerGuards('International Falls MN I FGF LLC'), true);
    assert.equal(granteePassesOwnerGuards('The Michael Parker Living Trust'), true);
  });
  it('rejects a brokerage (bare and " by <broker>" form)', () => {
    assert.equal(granteePassesOwnerGuards('Marcus & Millichap'), false);
    assert.equal(granteePassesOwnerGuards('Boyd Watterson by Newmark Knight Frank'), false);
  });
  it('rejects junk / federal anti-pattern / too-short', () => {
    assert.equal(granteePassesOwnerGuards('USA'), false);
    assert.equal(granteePassesOwnerGuards('N/A'), false);
    assert.equal(granteePassesOwnerGuards(''), false);
    assert.equal(granteePassesOwnerGuards(null), false);
  });
});

describe('latestDeedGranteeFromMetadata', () => {
  it('picks the newest non-mortgage deed buyer', () => {
    const md = { sales_history: [
      { buyer: 'OLD OWNER LLC', deed_type: 'Warranty Deed', recordation_date: '2020-01-01' },
      { buyer: 'NEW OWNER LLC', deed_type: 'Special Warranty Deed', recordation_date: '2026-05-15' },
      { buyer: 'A BANK', deed_type: 'Mortgage', recordation_date: '2026-06-01' },
    ] };
    const r = latestDeedGranteeFromMetadata(md);
    assert.equal(r.grantee, 'NEW OWNER LLC');
  });
  it('returns null with no deeds', () => {
    assert.equal(latestDeedGranteeFromMetadata({ sales_history: [] }), null);
  });
});

describe('propagateDeedGranteeToOwner', () => {
  it('deed wins: resolves/creates the owner and PATCHes recorded_owner_id', async () => {
    const { deps, calls } = makeDeps({ gateDecision: 'write' });
    const out = await propagateDeedGranteeToOwner(
      { domain: 'government', propertyId: 23599, granteeName: 'International Falls MN I FGF LLC' }, deps);
    assert.equal(out.applied, true);
    assert.equal(out.recorded_owner_id, 'own-NEW');
    assert.equal(calls.patches.length, 1);
    assert.equal(calls.patches[0].data.recorded_owner_id, 'own-NEW');
    // gov has no recorded_owner_name column — the patch must NOT carry it
    assert.equal(calls.patches[0].data.recorded_owner_name, undefined);
    // true_owner is never written directly (R47 re-resolves)
    assert.equal(calls.patches[0].data.true_owner_id, undefined);
  });

  it('dia: also sets the denormalized recorded_owner_name', async () => {
    const { deps, calls } = makeDeps({ gateDecision: 'write' });
    const out = await propagateDeedGranteeToOwner(
      { domain: 'dialysis', propertyId: 100, granteeName: 'New Clinic Holdings LLC' }, deps);
    assert.equal(out.applied, true);
    assert.equal(calls.patches[0].data.recorded_owner_name, 'New Clinic Holdings LLC');
  });

  it('rejects a brokerage grantee — never writes', async () => {
    const { deps, calls } = makeDeps({ gateDecision: 'write' });
    const out = await propagateDeedGranteeToOwner(
      { domain: 'government', propertyId: 16304, granteeName: 'Marcus & Millichap' }, deps);
    assert.equal(out.applied, false);
    assert.equal(out.skipped, 'grantee_failed_guards');
    assert.equal(calls.patches.length, 0);
    assert.equal(calls.gates.length, 0);
  });

  it('priority gate blocks a manual-held owner — no write', async () => {
    const { deps, calls } = makeDeps({ gateDecision: 'skip' });
    const out = await propagateDeedGranteeToOwner(
      { domain: 'government', propertyId: 999, granteeName: 'Some New SPE LLC' }, deps);
    assert.equal(out.applied, false);
    assert.equal(out.skipped, 'blocked_by_priority');
    assert.equal(out.blocked_by, 'manual_edit');
    assert.equal(calls.patches.length, 0);
  });

  it('already-current owner is a no-op', async () => {
    const { deps, calls } = makeDeps({ curOwnerId: 'own-X', curOwnerName: 'Acme Holdings LLC', gateDecision: 'write' });
    const out = await propagateDeedGranteeToOwner(
      { domain: 'government', propertyId: 5, granteeName: 'Acme Holdings LLC' }, deps);
    assert.equal(out.applied, false);
    assert.equal(out.skipped, 'already_current');
    assert.equal(calls.patches.length, 0);
  });
});
