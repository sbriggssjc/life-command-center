// ROE Slice 2 — capture the SF Account OwnerId on the SF sync and store it on the
// account's salesforce/Account external_identity metadata. Anchors:
// (1) normalizeAccountRow reads OwnerId/OwnerName across flat + nested shapes;
// (2) recordSfAccountOwner read-merge-writes metadata (sf_owner_id/sf_owner_name/
//     sf_owner_synced_at) preserving any prior metadata (e.g. `via`);
// (3) it no-ops honestly when the identity is missing or no owner is supplied.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAccountRow, recordSfAccountOwner } from '../api/_handlers/sf-account-import.js';

const ID15 = '0011I00000h7mHE';        // real live 15-char Account id
const ID18 = '0011I00000h7mHEQAY';     // its canonical 18-char form

describe('normalizeAccountRow — OwnerId capture', () => {
  it('captures a flat OwnerId + OwnerName', () => {
    const n = normalizeAccountRow({ Id: ID15, Name: 'Acme Trust', OwnerId: '0055x00000ABC', OwnerName: 'Stan Johnson' });
    assert.equal(n.id18, ID18);
    assert.equal(n.name, 'Acme Trust');
    assert.equal(n.ownerId, '0055x00000ABC');
    assert.equal(n.ownerName, 'Stan Johnson');
  });

  it('reads a nested Owner:{Name} relationship object', () => {
    const n = normalizeAccountRow({ Id: ID15, Name: 'Acme Trust', OwnerId: '0055x00000ABC', Owner: { Name: 'Scott Briggs' } });
    assert.equal(n.ownerName, 'Scott Briggs');
  });

  it('leaves owner fields null when the flow omits them', () => {
    const n = normalizeAccountRow({ Id: ID15, Name: 'Acme Trust' });
    assert.equal(n.ownerId, null);
    assert.equal(n.ownerName, null);
  });

  it('reads snake_case owner_id / owner_name', () => {
    const n = normalizeAccountRow({ id: ID15, name: 'Acme', owner_id: 'X', owner_name: 'Y' });
    assert.equal(n.ownerId, 'X');
    assert.equal(n.ownerName, 'Y');
  });
});

describe('recordSfAccountOwner — metadata write', () => {
  function fakeQuery(identityRow) {
    const calls = [];
    const query = async (method, path, body, opts) => {
      calls.push({ method, path, body, opts });
      if (method === 'GET') {
        return { ok: true, data: identityRow ? [identityRow] : [] };
      }
      if (method === 'PATCH') return { ok: true };
      return { ok: false };
    };
    return { query, calls };
  }

  it('merges sf_owner_* onto existing metadata (preserving `via`)', async () => {
    const { query, calls } = fakeQuery({ id: 'ident-1', metadata: { via: 'sf_account_import' } });
    const r = await recordSfAccountOwner({ id18: ID18, ownerId: '0055x', ownerName: 'Stan Johnson' }, { query });
    assert.equal(r.ok, true);
    const patch = calls.find(c => c.method === 'PATCH');
    assert.ok(patch, 'a PATCH was issued');
    assert.equal(patch.body.metadata.via, 'sf_account_import');       // preserved
    assert.equal(patch.body.metadata.sf_owner_id, '0055x');
    assert.equal(patch.body.metadata.sf_owner_name, 'Stan Johnson');
    assert.ok(patch.body.metadata.sf_owner_synced_at);                // stamped
  });

  it('no-ops when the salesforce/Account identity is not found', async () => {
    const { query, calls } = fakeQuery(null);
    const r = await recordSfAccountOwner({ id18: ID18, ownerId: '0055x', ownerName: 'Stan Johnson' }, { query });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'identity_not_found');
    assert.ok(!calls.some(c => c.method === 'PATCH'));                 // never wrote
  });

  it('no-ops when no owner is supplied (never blocks the mint)', async () => {
    const { query, calls } = fakeQuery({ id: 'ident-1', metadata: {} });
    const r = await recordSfAccountOwner({ id18: ID18, ownerId: null, ownerName: null }, { query });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'no_owner');
    assert.equal(calls.length, 0);                                    // never queried
  });
});
