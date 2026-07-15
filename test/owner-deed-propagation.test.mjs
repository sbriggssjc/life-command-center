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
  writeOwnerMailingAddress,
  reconcileSaleAndOwnershipForNewOwner,
  resolveDeedRecordedOwner,
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

// ── resolveOrCreateRecordedOwnerForDeed via resolveDeedRecordedOwner ──
// The owner_resolve_failed fix (2026-07-15): a stale stored normalized_name
// makes the normalized dedup GET miss AND the POST 409 on UNIQUE(name); the
// exact-name tier must find the existing owner (following a merge tombstone)
// instead of returning null.
function makeResolveDeps({ normHit = null, nameRow = null, postStatus = 201 } = {}) {
  const calls = { gets: [], posts: 0 };
  const deps = {
    async domainQuery(domain, method, path) {
      if (method === 'GET') {
        calls.gets.push(path);
        if (path.includes('canonical_name=eq.') || path.includes('normalized_name=eq.')) {
          return { ok: true, data: normHit ? [{ recorded_owner_id: normHit }] : [] };
        }
        if (path.includes('name=eq.')) {
          return { ok: true, data: nameRow ? [nameRow] : [] };
        }
      }
      if (method === 'POST' && path === 'recorded_owners') {
        calls.posts += 1;
        if (postStatus === 409) return { ok: false, status: 409, data: null };
        return { ok: true, status: 201, data: [{ recorded_owner_id: 'own-CREATED' }] };
      }
      return { ok: true, data: [] };
    },
  };
  return { deps, calls };
}

describe('resolveOrCreateRecordedOwnerForDeed (exact-name dedup + tombstone)', () => {
  it('normalized GET miss but exact-name hit → returns the existing owner, no POST', async () => {
    const { deps, calls } = makeResolveDeps({
      nameRow: { recorded_owner_id: 'own-EXISTING', merged_into_recorded_owner_id: null } });
    const id = await resolveDeedRecordedOwner('dialysis', 'Sumitomo Bank Leasing And Finance Inc', deps);
    assert.equal(id, 'own-EXISTING');
    assert.equal(calls.posts, 0);            // never re-created — the UNIQUE(name) row was found
  });

  it('follows a merge tombstone to the surviving owner', async () => {
    const { deps } = makeResolveDeps({
      nameRow: { recorded_owner_id: 'own-TOMB', merged_into_recorded_owner_id: 'own-SURVIVOR' } });
    const id = await resolveDeedRecordedOwner('dialysis', 'Sumitomo Mitsui Banking Corporation', deps);
    assert.equal(id, 'own-SURVIVOR');        // never point a property at a tombstone
  });

  it('POST 409 (stale norm hid the row) recovers by exact name, not null', async () => {
    const { deps, calls } = makeResolveDeps({
      nameRow: null, postStatus: 409 });
    // First exact-name GET returns null (nameRow=null) so it POSTs → 409; then the
    // 409-recovery exact-name GET must find it. Simulate the row appearing only on recovery:
    let getN = 0;
    deps.domainQuery = async (domain, method, path) => {
      if (method === 'GET') {
        calls.gets.push(path);
        if (path.includes('normalized_name=eq.')) return { ok: true, data: [] };
        if (path.includes('name=eq.')) {
          getN += 1;
          return getN === 1
            ? { ok: true, data: [] }                                       // pre-POST miss
            : { ok: true, data: [{ recorded_owner_id: 'own-RACE', merged_into_recorded_owner_id: null }] };
        }
      }
      if (method === 'POST') { calls.posts += 1; return { ok: false, status: 409, data: null }; }
      return { ok: true, data: [] };
    };
    const id = await resolveDeedRecordedOwner('dialysis', 'K&T Ranch', deps);
    assert.equal(id, 'own-RACE');
    assert.equal(calls.posts, 1);
  });

  it('genuinely new owner still creates one', async () => {
    const { deps, calls } = makeResolveDeps({ nameRow: null, postStatus: 201 });
    const id = await resolveDeedRecordedOwner('dialysis', 'Brand New Clinic Holdings LLC', deps);
    assert.equal(id, 'own-CREATED');
    assert.equal(calls.posts, 1);
  });
});

// ── ORE Phase 1 Unit C — owner mailing-address fill-blanks ──
function makeOwnerDeps(curRow) {
  const calls = { patches: [], gates: [] };
  const deps = {
    async domainQuery(domain, method, path) {
      if (method === 'GET' && path.startsWith('recorded_owners?recorded_owner_id=eq.')) {
        return { ok: true, data: curRow ? [curRow] : [] };
      }
      return { ok: true, data: [] };
    },
    async domainPatch(domain, path, data, label) { calls.patches.push({ path, data, label }); return { ok: true }; },
    async shouldWriteField(args) { calls.gates.push(args); return { write: true, decision: 'write' }; },
  };
  return { deps, calls };
}

describe('writeOwnerMailingAddress (ORE Unit C)', () => {
  it('gov: fills the blank mailing_address + records recorded_deed provenance on gov.recorded_owners', async () => {
    const { deps, calls } = makeOwnerDeps({ mailing_address: null });
    const out = await writeOwnerMailingAddress({
      domain: 'government', ownerId: 'ro-1',
      address: '17 Copperbeech Lane, Lawrence, NY 11559',
      parsed: { state: 'NY', city: 'Lawrence', street: '17 Copperbeech Lane' },
    }, deps);
    assert.equal(out.applied, true);
    assert.deepEqual(out.fields_filled, ['mailing_address']);
    assert.equal(calls.patches[0].data.mailing_address, '17 Copperbeech Lane, Lawrence, NY 11559');
    assert.equal(calls.gates[0].targetTable, 'gov.recorded_owners');
    assert.equal(calls.gates[0].fieldName, 'mailing_address');
    assert.equal(calls.gates[0].source, 'recorded_deed');
  });

  it('gov: a non-blank mailing_address is never clobbered (already_present)', async () => {
    const { deps, calls } = makeOwnerDeps({ mailing_address: 'Existing curated addr' });
    const out = await writeOwnerMailingAddress({ domain: 'government', ownerId: 'ro-1', address: '17 Copperbeech Lane, NY 11559' }, deps);
    assert.equal(out.applied, false);
    assert.equal(out.skipped, 'already_present');
    assert.equal(calls.patches.length, 0);
  });

  it('dia: fills address/city/state from the parsed parts (fill-blanks each)', async () => {
    const { deps, calls } = makeOwnerDeps({ address: null, city: null, state: null });
    const out = await writeOwnerMailingAddress({
      domain: 'dialysis', ownerId: 'ro-1',
      address: '3662 Avalon Park East Blvd, Orlando, FL 32828',
      parsed: { street: '3662 Avalon Park East Blvd', city: 'Orlando', state: 'FL' },
    }, deps);
    assert.equal(out.applied, true);
    assert.equal(calls.patches[0].data.address, '3662 Avalon Park East Blvd');
    assert.equal(calls.patches[0].data.city, 'Orlando');
    assert.equal(calls.patches[0].data.state, 'FL');
    assert.deepEqual(new Set(out.fields_filled), new Set(['address', 'city', 'state']));
    assert.equal(calls.gates[0].targetTable, 'dia.recorded_owners');
  });

  it('dia: only blank columns are filled — an existing address is kept', async () => {
    const { deps, calls } = makeOwnerDeps({ address: '99 Old St', city: null, state: null });
    const out = await writeOwnerMailingAddress({
      domain: 'dialysis', ownerId: 'ro-1', address: '3662 Ave, Orlando, FL 32828',
      parsed: { street: '3662 Ave', city: 'Orlando', state: 'FL' },
    }, deps);
    assert.equal(out.applied, true);
    assert.equal('address' in calls.patches[0].data, false, 'existing address not clobbered');
    assert.equal(calls.patches[0].data.city, 'Orlando');
    assert.equal(calls.patches[0].data.state, 'FL');
  });

  it('missing / too-short address → skipped, no write', async () => {
    const { deps, calls } = makeOwnerDeps({ mailing_address: null });
    assert.equal((await writeOwnerMailingAddress({ domain: 'government', ownerId: 'ro-1', address: '' }, deps)).skipped, 'missing_input');
    assert.equal((await writeOwnerMailingAddress({ domain: 'government', ownerId: 'ro-1', address: 'abc' }, deps)).skipped, 'address_too_short');
    assert.equal(calls.patches.length, 0);
  });
});

// B1/B2 — after the deed grantee becomes recorded_owner, close the transfer loop:
// attribute the sale WHOSE BUYER IS this owner + append the ownership_history row.
function makeReconcileDeps({ sales = [], existingOh = false } = {}) {
  const calls = { patches: [], ohInserts: [] };
  const deps = {
    async domainQuery(domain, method, path) {
      if (method === 'GET' && path.startsWith('sales_transactions?')) return { ok: true, data: sales };
      if (method === 'GET' && path.startsWith('ownership_history?')) {
        return { ok: true, data: existingOh ? [{ ownership_id: 'oh-EXIST' }] : [] };
      }
      if (method === 'POST' && path === 'ownership_history') {
        calls.ohInserts.push(arguments[3]); return { ok: true, data: [{ ownership_id: 'oh-NEW' }] };
      }
      return { ok: true, data: [] };
    },
    async domainPatch(domain, path, data, label) { calls.patches.push({ path, data, label }); return { ok: true }; },
  };
  return { deps, calls };
}

describe('reconcileSaleAndOwnershipForNewOwner (B1/B2 close-the-loop)', () => {
  it('gov: attributes the buyer-matched orphan sale + appends the OH transfer', async () => {
    const { deps, calls } = makeReconcileDeps({ sales: [
      { sale_id: 'S-2026', sale_date: '2026-06-30', sold_price: '7500000.00',
        buyer: 'TNRE 13 LLC', seller: 'Rainier Rockford Llc', recorded_owner_id: null },
      { sale_id: 'S-2015', sale_date: '2015-12-01', sold_price: '11032000.00',
        buyer: 'Rainier Capital Management', seller: 'W.D. Schorsch LLC', recorded_owner_id: 'own-OLD' },
    ] });
    const out = await reconcileSaleAndOwnershipForNewOwner(
      { domain: 'government', propertyId: 16500, recordedOwnerId: 'own-TNRE', ownerName: 'TNRE 13 LLC' }, deps);
    assert.equal(out.sale_attributed, true);
    assert.equal(out.sale_id, 'S-2026', 'picks the most-recent sale whose buyer IS the owner, not the 2015 one');
    assert.equal(out.ownership_history_appended, true);
    // The sale PATCH sets the NEW owner id.
    const salePatch = calls.patches.find((p) => p.path.includes('sales_transactions'));
    assert.equal(salePatch.data.recorded_owner_id, 'own-TNRE');
    // The OH insert is a gov-shaped deed transfer, tagged for reversibility.
    assert.equal(calls.ohInserts[0].transfer_date, '2026-06-30');
    assert.equal(calls.ohInserts[0].new_owner, 'TNRE 13 LLC');
    assert.equal(calls.ohInserts[0].data_source, 'owner_deed_reconcile');
  });

  it('never attributes a sale whose buyer is NOT this owner', async () => {
    const { deps, calls } = makeReconcileDeps({ sales: [
      { sale_id: 'S-1', sale_date: '2024-01-01', sold_price: '5000000', buyer: 'Someone Else LLC', recorded_owner_id: null },
    ] });
    const out = await reconcileSaleAndOwnershipForNewOwner(
      { domain: 'government', propertyId: 1, recordedOwnerId: 'own-X', ownerName: 'TNRE 13 LLC' }, deps);
    assert.equal(out.skipped, 'no_matching_buyer_sale');
    assert.equal(out.sale_attributed, false);
    assert.equal(calls.patches.length, 0);
    assert.equal(calls.ohInserts.length, 0);
  });

  it('idempotent: already-attributed sale + existing OH → no writes', async () => {
    const { deps, calls } = makeReconcileDeps({ existingOh: true, sales: [
      { sale_id: 'S-2026', sale_date: '2026-06-30', sold_price: '7500000', buyer: 'TNRE 13 LLC', recorded_owner_id: 'own-TNRE' },
    ] });
    const out = await reconcileSaleAndOwnershipForNewOwner(
      { domain: 'government', propertyId: 16500, recordedOwnerId: 'own-TNRE', ownerName: 'TNRE 13 LLC' }, deps);
    assert.equal(out.sale_attributed, false, 'sale already carries the owner');
    assert.equal(out.ownership_history_appended, false, 'OH transfer already exists');
    assert.equal(calls.ohInserts.length, 0);
  });

  it('dia: OH insert uses ownership_start/sold_price/sale_id + attributes with name', async () => {
    const { deps, calls } = makeReconcileDeps({ sales: [
      { sale_id: 42, sale_date: '2025-03-10', sold_price: '2270000', buyer: 'AEI Capital Corp', recorded_owner_id: null },
    ] });
    const out = await reconcileSaleAndOwnershipForNewOwner(
      { domain: 'dialysis', propertyId: 26955, recordedOwnerId: 'own-AEI', ownerName: 'AEI Capital Corp' }, deps);
    assert.equal(out.sale_attributed, true);
    assert.equal(out.ownership_history_appended, true);
    assert.equal(calls.ohInserts[0].ownership_start, '2025-03-10');
    assert.equal(calls.ohInserts[0].sale_id, 42);
    assert.equal(calls.ohInserts[0].ownership_source, 'owner_deed_reconcile');
    const salePatch = calls.patches.find((p) => p.path.includes('sales_transactions'));
    assert.equal(salePatch.data.recorded_owner_name, 'AEI Capital Corp');
  });

  it('missing input / no sales → skipped, no writes', async () => {
    const { deps, calls } = makeReconcileDeps({ sales: [] });
    assert.equal((await reconcileSaleAndOwnershipForNewOwner({ domain: 'government', propertyId: 1, ownerName: 'X' }, deps)).skipped, 'missing_input');
    assert.equal((await reconcileSaleAndOwnershipForNewOwner({ domain: 'government', propertyId: 1, recordedOwnerId: 'o', ownerName: 'X' }, deps)).skipped, 'no_sales');
    assert.equal(calls.patches.length, 0);
  });
});
