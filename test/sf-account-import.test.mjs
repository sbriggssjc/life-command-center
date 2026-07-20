// SF Get Accounts — the bulk Account→org(Name) map ingest handler's pure core.
// Anchors the two things the handler cannot get wrong: (1) normalizeAccountRow
// classifies each inbound row (Account-only, 15/18-safe, never fabricates a name),
// and (2) resolveAccountNamesByIds does the bounded external_identities → entities
// join keyed by the 15-char natural key (so a 15-char member id resolves an
// 18-char stored id). Live-id checksum anchors from sf-id.test.mjs.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAccountRow, resolveAccountNamesByIds,
  importAccounts, buildNeededAccountKeys, fetchKnownAccountKeys,
} from '../api/_handlers/sf-account-import.js';
import { toSf18 } from '../api/_shared/sf-id.js';

const ID15 = '0011I00000h7mHE';           // real live 15-char Account id
const ID18 = '0011I00000h7mHEQAY';        // its canonical 18-char form (suffix QAY)
const B15 = '0011I00000h7yOi';            // second real live Account id
const B18 = '0011I00000h7yOiQAI';         // its canonical 18-char form (suffix QAI)

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

// ── the needed-only filter ──────────────────────────────────────────────────
// A mock (query, ensureLink) pair: `needed` = 15/18-char ids a member awaits,
// `known` = ids already in external_identities. The membership pull returns one
// page (test datasets < 1000); the known probe returns the 18-char stored form.
function mockDeps({ needed = [], known = [], ensureResult } = {}) {
  const calls = { membership: 0, ext: 0, ensure: 0 };
  const query = async (_method, path) => {
    if (path.startsWith('lcc_sf_list_membership')) {
      calls.membership++;
      // one page of results on the first offset, empty thereafter (paged past end)
      return { ok: true, data: path.includes('offset=0') ? needed.map((k) => ({ acct: k })) : [] };
    }
    if (path.startsWith('external_identities')) {
      calls.ext++;
      return { ok: true, data: known.map((k) => ({ external_id: toSf18(k) })) };
    }
    return { ok: false, data: [] };
  };
  const ensureLink = async (args) => {
    calls.ensure++;
    return ensureResult ? ensureResult(args)
      : { ok: true, entityId: 'e-' + args.externalId, createdEntity: true };
  };
  return { deps: { query, ensureLink }, calls };
}

function newResult() {
  return {
    accounts_received: 0, accounts_created: 0, accounts_matched_existing: 0,
    accounts_skipped_not_needed: 0, accounts_skipped_guard: 0,
    accounts_skipped_no_name: 0, accounts_skipped_bad_id: 0, needed_set_size: 0,
  };
}
function ctx(result, all) {
  return { workspaceId: 'ws', userId: 'u', result, deadline: Date.now() + 60000, all };
}

describe('importAccounts — needed-only filter', () => {
  it('persists an account that IS in the needed set', async () => {
    const { deps, calls } = mockDeps({ needed: [ID15] });
    const r = newResult();
    await importAccounts([{ Id: ID18, Name: 'Acme' }], ctx(r, false), deps);
    assert.equal(r.accounts_created, 1);
    assert.equal(r.accounts_skipped_not_needed, 0);
    assert.equal(calls.ensure, 1);                    // ensureEntityLink ran → entity + identity
    assert.equal(r.needed_set_size, 1);
  });

  it('SKIPS an account that is NOT needed and NOT known — never mints', async () => {
    const { deps, calls } = mockDeps({ needed: [], known: [] });
    const r = newResult();
    await importAccounts([{ Id: ID18, Name: 'Northmarq HQ' }], ctx(r, false), deps);
    assert.equal(r.accounts_skipped_not_needed, 1);
    assert.equal(r.accounts_created, 0);
    assert.equal(calls.ensure, 0);                    // no entity ever created for the discard set
  });

  it('still persists an account NOT needed but ALREADY known to LCC (name refresh, no growth)', async () => {
    const { deps, calls } = mockDeps({
      needed: [], known: [ID15],
      ensureResult: () => ({ ok: true, entityId: 'existing', createdEntity: false }),
    });
    const r = newResult();
    await importAccounts([{ Id: ID18, Name: 'Acme (existing)' }], ctx(r, false), deps);
    assert.equal(r.accounts_skipped_not_needed, 0);
    assert.equal(r.accounts_matched_existing, 1);     // matched, not created → 0 entity growth
    assert.equal(calls.ensure, 1);
  });

  it('matches the needed set 15↔18 in BOTH directions', async () => {
    // needed carries the 15-char id, the posted id is 18-char
    {
      const { deps } = mockDeps({ needed: [ID15] });
      const r = newResult();
      await importAccounts([{ Id: ID18, Name: 'X' }], ctx(r, false), deps);
      assert.equal(r.accounts_created, 1);
      assert.equal(r.accounts_skipped_not_needed, 0);
    }
    // needed carries the 18-char id, the posted id is 15-char
    {
      const { deps } = mockDeps({ needed: [ID18] });
      const r = newResult();
      await importAccounts([{ Id: ID15, Name: 'X' }], ctx(r, false), deps);
      assert.equal(r.accounts_created, 1);
      assert.equal(r.accounts_skipped_not_needed, 0);
    }
  });

  it('?all=1 restores persist-everything (never builds the needed/known sets)', async () => {
    const { deps, calls } = mockDeps({ needed: [], known: [] });
    const r = newResult();
    await importAccounts([{ Id: ID18, Name: 'A' }, { Id: B18, Name: 'B' }], ctx(r, true), deps);
    assert.equal(r.accounts_created, 2);
    assert.equal(r.accounts_skipped_not_needed, 0);
    assert.equal(calls.membership, 0);                // needed set never fetched
    assert.equal(calls.ext, 0);                       // known set never probed
  });

  it('fetches the needed set ONCE for the batch — no N+1', async () => {
    const extra = Array.from({ length: 10 }, (_, i) => ({ Id: '0011I00000AAA0' + i, Name: 'x' + i }));
    const { deps, calls } = mockDeps({ needed: [ID15] });
    const r = newResult();
    await importAccounts([{ Id: ID18, Name: 'Needed' }, ...extra], ctx(r, false), deps);
    assert.equal(calls.membership, 1);                // one needed-set pull, not one per account
    assert.equal(calls.ext, 1);                       // one bounded known-set chunk (< 80 ids)
    assert.equal(r.accounts_created, 1);              // only the needed account
    assert.equal(r.accounts_skipped_not_needed, 10);  // the 10 discards
  });

  it('mixed batch: counts sum to accounts_received', async () => {
    const { deps } = mockDeps({
      needed: [ID15], known: [B15],
      ensureResult: (args) => args.externalId === ID18
        ? { ok: true, entityId: 'a', createdEntity: true }
        : { ok: true, entityId: 'b', createdEntity: false },
    });
    const r = newResult();
    await importAccounts([
      { Id: ID18, Name: 'Needed' },              // needed → created
      { Id: B18, Name: 'Known' },                // known  → matched_existing
      { Id: '0011I00000CCC01', Name: 'Unneeded' }, // not needed/known → skipped_not_needed
      { Id: '0031I00000h7mHE', Name: 'Contact' }, // 003 → bad_id
      { Id: ID18, Name: '' },                    // blank → no_name (never fabricated)
    ], ctx(r, false), deps);
    const sum = r.accounts_created + r.accounts_matched_existing + r.accounts_skipped_not_needed
      + r.accounts_skipped_guard + r.accounts_skipped_no_name + r.accounts_skipped_bad_id;
    assert.equal(r.accounts_received, 5);
    assert.equal(sum, r.accounts_received);
    assert.equal(r.accounts_created, 1);
    assert.equal(r.accounts_matched_existing, 1);
    assert.equal(r.accounts_skipped_not_needed, 1);
    assert.equal(r.accounts_skipped_bad_id, 1);
    assert.equal(r.accounts_skipped_no_name, 1);
  });
});

describe('buildNeededAccountKeys / fetchKnownAccountKeys', () => {
  it('buildNeededAccountKeys dedups by sf15 across duplicate member rows', async () => {
    const query = async (_m, path) => path.includes('offset=0')
      ? { ok: true, data: [{ acct: ID15 }, { acct: ID18 }, { acct: B15 }, { acct: null }] }
      : { ok: true, data: [] };
    const keys = await buildNeededAccountKeys({ query });
    assert.equal(keys.size, 2);                       // ID15==ID18 collapse; null dropped
    assert.ok(keys.has(ID15) && keys.has(B15));
  });

  it('fetchKnownAccountKeys is a no-op (no query) on an empty id list', async () => {
    let called = 0;
    const query = async () => { called++; return { ok: true, data: [] }; };
    assert.equal((await fetchKnownAccountKeys([], { query })).size, 0);
    assert.equal(called, 0);
  });
});
