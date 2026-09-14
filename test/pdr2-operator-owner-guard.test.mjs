// PDR2 (2026-09-14) — assemblePropertyPacket must never present an operator-flagged
// true_owner as ownership.true_owner_name (P113: dia files the tenant in the owner
// slot at scale — measured 7,937 dia properties). Covers all three operator signals
// (is_operator_not_owner / owner_type / owner_role), the recorded-owner fallback,
// the both-null "owner unknown" case, and gov's safe degrade when the
// is_operator_not_owner/owner_type columns don't exist on that domain.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.OPS_SUPABASE_URL = 'https://ops.test.local';
process.env.OPS_SUPABASE_KEY = 'service-key';

const { assemblePropertyPacket } = await import('../api/operations.js');
const { isTrueOwnerOperator, trueOwnerOperatorSelectFields } = await import('../api/_shared/true-owner-operator-guard.js');

const ENTITY_ID = '9782c412-e9b7-4061-ac73-edc670b9273c';

function makeOps(rows) {
  return async (_method, path) => {
    if (path.startsWith('entities?id=eq.' + ENTITY_ID)) return { ok: true, data: [rows.entity] };
    if (path.startsWith('external_identities?')) return { ok: true, data: rows.identities };
    if (path.startsWith('activity_events?')) return { ok: true, data: [] };
    if (path.startsWith('action_items?')) return { ok: true, data: [] };
    if (path.startsWith('entity_relationships?')) return { ok: true, data: [] };
    if (path.startsWith('entities?id=in.')) return { ok: true, data: [] };
    return { ok: true, data: [] };
  };
}

function makeDomainGet(tables) {
  return async (_domain, path) => {
    const table = path.split('?')[0];
    if (table in tables) return { ok: true, data: tables[table] };
    return { ok: false, data: null, status: 404 };
  };
}

const baseOps = (identitySystem = 'dia') => makeOps({
  entity: { id: ENTITY_ID, name: 'Donna TX', entity_type: 'asset', workspace_id: 'ws-1' },
  identities: [{ source_system: identitySystem, source_type: 'asset', external_id: '39874' }],
});

describe('true-owner-operator-guard — pure predicate', () => {
  it('is true for each of the three signals independently', () => {
    assert.equal(isTrueOwnerOperator({ is_operator_not_owner: true }), true);
    assert.equal(isTrueOwnerOperator({ owner_type: 'buyer', owner_role: 'operator' }), true);
    assert.equal(isTrueOwnerOperator({ owner_type: 'operator' }), true);
  });
  it('is false for a normal owner row and never throws on a partial row', () => {
    assert.equal(isTrueOwnerOperator({ is_operator_not_owner: false, owner_role: 'unknown' }), false);
    assert.equal(isTrueOwnerOperator({}), false);
    assert.equal(isTrueOwnerOperator(null), false);
    assert.equal(isTrueOwnerOperator(undefined), false);
  });
  it('gov select never requests a column gov does not have', () => {
    assert.equal(trueOwnerOperatorSelectFields('gov'), 'owner_role');
    assert.equal(trueOwnerOperatorSelectFields('government'), 'owner_role');
    assert.ok(trueOwnerOperatorSelectFields('dia').includes('is_operator_not_owner'));
  });
});

describe('assemblePropertyPacket — operator-as-owner guard (PDR2)', () => {
  it('is_operator_not_owner=true: true_owner_name is NOT set; operator_name + flag are', async () => {
    const domainGet = makeDomainGet({
      properties: [{ property_id: 39874, recorded_owner_id: 7, true_owner_id: 9 }],
      recorded_owners: [{ recorded_owner_id: 7, name: 'Living Trust & Gina M Decarion Living Tr' }],
      true_owners: [{ true_owner_id: 9, name: 'DaVita Kidney Care', is_operator_not_owner: true, owner_type: 'buyer', owner_role: 'operator' }],
    });
    const { payload } = await assemblePropertyPacket(ENTITY_ID, 'ws-1', { opsQuery: baseOps(), domainGet });
    assert.equal(payload.ownership.true_owner_name, null);
    assert.equal(payload.ownership.true_owner_is_operator, true);
    assert.equal(payload.ownership.operator_name, 'DaVita Kidney Care');
    assert.equal(payload.ownership.recorded_owner_name, 'Living Trust & Gina M Decarion Living Tr');
  });

  it('owner_type=operator alone (is_operator_not_owner false/null) still guards', async () => {
    const domainGet = makeDomainGet({
      properties: [{ property_id: 1, true_owner_id: 9 }],
      true_owners: [{ true_owner_id: 9, name: 'Fresenius Medical Care', owner_type: 'operator' }],
    });
    const { payload } = await assemblePropertyPacket(ENTITY_ID, 'ws-1', { opsQuery: baseOps(), domainGet });
    assert.equal(payload.ownership.true_owner_name, null);
    assert.equal(payload.ownership.true_owner_is_operator, true);
    assert.equal(payload.ownership.operator_name, 'Fresenius Medical Care');
  });

  it('owner_role=operator alone still guards', async () => {
    const domainGet = makeDomainGet({
      properties: [{ property_id: 1, true_owner_id: 9 }],
      true_owners: [{ true_owner_id: 9, name: 'U.S. Renal Care', owner_role: 'operator' }],
    });
    const { payload } = await assemblePropertyPacket(ENTITY_ID, 'ws-1', { opsQuery: baseOps(), domainGet });
    assert.equal(payload.ownership.true_owner_name, null);
    assert.equal(payload.ownership.true_owner_is_operator, true);
    assert.equal(payload.ownership.operator_name, 'U.S. Renal Care');
  });

  it('non-operator true owner is unchanged: true_owner_name set, flag false, operator_name null', async () => {
    const domainGet = makeDomainGet({
      properties: [{ property_id: 1, recorded_owner_id: 7, true_owner_id: 9 }],
      recorded_owners: [{ recorded_owner_id: 7, name: 'PMG Leasing, L.L.C.' }],
      true_owners: [{ true_owner_id: 9, name: 'PMG Leasing, L.L.C.', is_operator_not_owner: false, owner_role: 'unknown' }],
    });
    const { payload } = await assemblePropertyPacket(ENTITY_ID, 'ws-1', { opsQuery: baseOps(), domainGet });
    assert.equal(payload.ownership.true_owner_name, 'PMG Leasing, L.L.C.');
    assert.equal(payload.ownership.true_owner_is_operator, false);
    assert.equal(payload.ownership.operator_name, null);
    assert.equal(payload.ownership.recorded_owner_name, 'PMG Leasing, L.L.C.');
  });

  it('recorded_owner_name is preserved even when true_owner is an operator', async () => {
    const domainGet = makeDomainGet({
      properties: [{ property_id: 1, recorded_owner_id: 7, true_owner_id: 9 }],
      recorded_owners: [{ recorded_owner_id: 7, name: 'Varg 2 Holdings Llc' }],
      true_owners: [{ true_owner_id: 9, name: 'Fresenius Medical Care', is_operator_not_owner: true }],
    });
    const { payload } = await assemblePropertyPacket(ENTITY_ID, 'ws-1', { opsQuery: baseOps(), domainGet });
    assert.equal(payload.ownership.recorded_owner_name, 'Varg 2 Holdings Llc');
    assert.equal(payload.ownership.true_owner_is_operator, true);
  });

  it('both recorded and true owner absent/operator-only -> owner unknown, never backfilled from the operator', async () => {
    const domainGet = makeDomainGet({
      properties: [{ property_id: 1, true_owner_id: 9 }], // no recorded_owner_id
      true_owners: [{ true_owner_id: 9, name: 'U.S. Renal Care', is_operator_not_owner: true }],
    });
    const { payload } = await assemblePropertyPacket(ENTITY_ID, 'ws-1', { opsQuery: baseOps(), domainGet });
    assert.equal(payload.ownership.recorded_owner_name, null);
    assert.equal(payload.ownership.true_owner_name, null);
    assert.equal(payload.ownership.true_owner_is_operator, true);
    assert.equal(payload.ownership.operator_name, 'U.S. Renal Care');
  });

  it('gov domain: no is_operator_not_owner/owner_type column — never throws, selects owner_role only', async () => {
    let sawSelect = null;
    const domainGet = async (_domain, path) => {
      const table = path.split('?')[0];
      if (table === 'properties') return { ok: true, data: [{ property_id: 1, recorded_owner_id: 7, true_owner_id: 9 }] };
      if (table === 'recorded_owners') return { ok: true, data: [{ recorded_owner_id: 7, name: 'GSA Landlord LLC' }] };
      if (table === 'true_owners') {
        sawSelect = path;
        // gov true_owners genuinely has no is_operator_not_owner/owner_type — only owner_role.
        assert.ok(!path.includes('is_operator_not_owner'));
        assert.ok(!path.includes('owner_type'));
        return { ok: true, data: [{ true_owner_id: 9, name: 'Some Federal Tenant LLC', owner_role: 'unknown' }] };
      }
      return { ok: false, data: null, status: 404 };
    };
    const { payload } = await assemblePropertyPacket(ENTITY_ID, 'ws-1', { opsQuery: baseOps('gov'), domainGet });
    assert.ok(sawSelect);
    assert.equal(payload.ownership.true_owner_name, 'Some Federal Tenant LLC');
    assert.equal(payload.ownership.true_owner_is_operator, false);
  });

  it('no domain linkage: ownership shape still carries the new fields, all null/false', async () => {
    const ops = makeOps({
      entity: { id: ENTITY_ID, name: 'Unlinked', entity_type: 'asset', workspace_id: 'ws-1' },
      identities: [],
    });
    const { payload } = await assemblePropertyPacket(ENTITY_ID, 'ws-1', {
      opsQuery: ops,
      domainGet: async () => ({ ok: false }),
    });
    assert.equal(payload.ownership.true_owner_name, null);
    assert.equal(payload.ownership.true_owner_is_operator, false);
    assert.equal(payload.ownership.operator_name, null);
    assert.equal(payload.ownership.recorded_owner_name, null);
  });
});
