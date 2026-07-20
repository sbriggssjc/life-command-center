// SF Get Accounts — the bulk Account→org(Name) map ingest handler's pure core.
// Anchors the two things the handler cannot get wrong: (1) normalizeAccountRow
// classifies each inbound row (Account-only, 15/18-safe, never fabricates a name),
// and (2) resolveAccountNamesByIds does the bounded external_identities → entities
// join keyed by the 15-char natural key (so a 15-char member id resolves an
// 18-char stored id). Live-id checksum anchors from sf-id.test.mjs.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAccountRow, resolveAccountNamesByIds } from '../api/_handlers/sf-account-import.js';

const ID15 = '0011I00000h7mHE';           // real live 15-char Account id
const ID18 = '0011I00000h7mHEQAY';        // its canonical 18-char form (suffix QAY)

describe('normalizeAccountRow', () => {
  it('normalizes a {Id,Name} row to the canonical 18-char id', () => {
    const n = normalizeAccountRow({ Id: ID15, Name: 'Boyd Watterson Asset Management LLC' });
    assert.equal(n.id18, ID18);
    assert.equal(n.name, 'Boyd Watterson Asset Management LLC');
    assert.equal(n.skip, undefined);
  });

  it('accepts an already-18-char id unchanged + trims the name', () => {
    const n = normalizeAccountRow({ Id: ID18, Name: '  Acme Corp  ' });
    assert.equal(n.id18, ID18);
    assert.equal(n.name, 'Acme Corp');
  });

  it('reads tolerant field spellings (id / AccountId / name)', () => {
    assert.equal(normalizeAccountRow({ id: ID15, name: 'X Co' }).id18, ID18);
    assert.equal(normalizeAccountRow({ AccountId: ID15, AccountName: 'Y Co' }).id18, ID18);
  });

  it('NEVER fabricates a name — a blank/missing Name is skip:no_name', () => {
    assert.equal(normalizeAccountRow({ Id: ID15, Name: '' }).skip, 'no_name');
    assert.equal(normalizeAccountRow({ Id: ID15, Name: '   ' }).skip, 'no_name');
    assert.equal(normalizeAccountRow({ Id: ID15 }).skip, 'no_name');
  });

  it('rejects a non-Account (003 Contact) id and a malformed id', () => {
    assert.equal(normalizeAccountRow({ Id: '0031I00000h7mHE', Name: 'A person' }).skip, 'bad_id');
    assert.equal(normalizeAccountRow({ Id: 'not-an-id', Name: 'A co' }).skip, 'bad_id');
    assert.equal(normalizeAccountRow({ Name: 'A co' }).skip, 'bad_id');
  });
});

describe('resolveAccountNamesByIds', () => {
  it('joins external_identities → entities in two bounded queries, keyed by sf15', async () => {
    const calls = [];
    const query = async (method, path) => {
      calls.push(path);
      if (path.startsWith('external_identities')) {
        // Store holds the 18-char form; member id passed in is 15-char.
        return { ok: true, data: [{ entity_id: 'e-1', external_id: ID18 }] };
      }
      if (path.startsWith('entities')) {
        return { ok: true, data: [{ id: 'e-1', name: 'Boyd Watterson Asset Management LLC' }] };
      }
      return { ok: false, data: [] };
    };
    const map = await resolveAccountNamesByIds([ID15], { query });
    const hit = map.get(ID15);                       // keyed by the 15-char natural key
    assert.ok(hit, 'the 15-char member id resolves the 18-char stored id');
    assert.equal(hit.name, 'Boyd Watterson Asset Management LLC');
    assert.equal(hit.entity_id, 'e-1');
    // Exactly two queries (no N+1): one external_identities, one entities.
    assert.equal(calls.length, 2);
    assert.ok(calls[0].startsWith('external_identities'));
    assert.ok(calls[1].startsWith('entities'));
  });

  it('returns an empty map when the account is unknown to LCC', async () => {
    const query = async (_m, path) =>
      path.startsWith('external_identities') ? { ok: true, data: [] } : { ok: true, data: [] };
    const map = await resolveAccountNamesByIds([ID15], { query });
    assert.equal(map.size, 0);
  });

  it('is a no-op for a malformed / empty id list', async () => {
    let called = 0;
    const query = async () => { called++; return { ok: true, data: [] }; };
    assert.equal((await resolveAccountNamesByIds(['garbage', ''], { query })).size, 0);
    assert.equal((await resolveAccountNamesByIds([], { query })).size, 0);
    assert.equal(called, 0);                          // never queries with no valid keys
  });
});
