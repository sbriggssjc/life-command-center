// ============================================================================
// SIDEBAR4 (2026-09-22) — twin CONTACT entities from two overlapping sidebar
// pipeline runs over ONE capture.
//
// Measured live (LCC Opps, entity 68874e8d "506 N Patterson St", 2026-09-18):
// every relationship written for the capture carries one extracted_at
// (19:51:47.140Z), yet "John Messer" was minted twice 26 ms apart, "W Wayne
// Fann" twice 4 ms apart and "Pineview Real Estate Grp Llc" twice 79 ms apart.
// A second run of processSidebarExtraction started a few seconds after the
// first and raced it on every check-then-insert. Class-wide: 42 of the 78 live
// same-name/same-mailbox person groups were created < 2 s apart.
//
// Two layers, both asserted behaviourally here:
//   1. serializeSidebarRun — runs over one entity never overlap; callers that
//      arrive mid-run share ONE trailing run; `force` is OR'd, never dropped.
//   2. ensureEntityLink — when the DB backstop
//      (uq_entities_person_contact_key_sidebar4) refuses a concurrent person
//      INSERT with 23505, the loser ATTACHES to the winner instead of failing;
//      a 23503 (also HTTP 409) is not mistaken for it; and a same-name row
//      with a DIFFERENT mailbox is never attached (a shared name is not
//      identity).
// Plus the migration's shape, so the index cannot silently widen into a
// name-only or organization-covering constraint.
// ============================================================================

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ensureEntityLink, isUniqueViolation, personContactKey,
} from '../api/_shared/entity-link.js';
import { serializeSidebarRun } from '../api/_handlers/sidebar-pipeline.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const originalFetch = global.fetch;

function jsonResponse(body, ok = true, status = 200) {
  return {
    ok,
    status,
    headers: { get() { return null; } },
    async text() { return JSON.stringify(body); },
  };
}

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

describe('SIDEBAR4 — serializeSidebarRun (per-entity single-flight)', () => {
  it('never overlaps two runs for one entity, and a mid-run caller gets a TRAILING run', async () => {
    const key = `ws:${Math.random()}`;
    let active = 0; let maxActive = 0; const order = [];
    const gate = deferred();
    const run = (label) => async () => {
      active++; maxActive = Math.max(maxActive, active); order.push(`start:${label}`);
      if (label === 'A') await gate.promise;
      await new Promise((r) => setImmediate(r));
      order.push(`end:${label}`); active--;
      return label;
    };
    const a = serializeSidebarRun(key, run('A'));
    const b = serializeSidebarRun(key, run('B'));
    assert.equal(a.coalesced, false);
    assert.equal(b.coalesced, true);
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(order, ['start:A'], 'B must not start while A is in flight');
    gate.resolve();
    assert.equal(await a.promise, 'A');
    assert.equal(await b.promise, 'B', 'the trailing run still happens — a newer capture is ordered, never dropped');
    assert.equal(maxActive, 1);
    assert.deepEqual(order, ['start:A', 'end:A', 'start:B', 'end:B']);
  });

  it('coalesces every caller that arrives mid-run into ONE trailing run, with force OR-ed', async () => {
    const key = `ws:${Math.random()}`;
    const gate = deferred();
    const forces = [];
    const fn = async (force) => { forces.push(force); if (forces.length === 1) await gate.promise; return forces.length; };
    const a = serializeSidebarRun(key, fn, false);
    const b = serializeSidebarRun(key, fn, false);
    const c = serializeSidebarRun(key, fn, true);
    assert.equal(b.promise, c.promise, 'callers queued behind one run share one trailing promise');
    gate.resolve();
    await a.promise; await c.promise;
    assert.deepEqual(forces, [false, true], 'exactly two runs, and the trailing one carries force=true');
  });

  it('a failed run does not wedge the entity — the trailing run still executes and the slot clears', async () => {
    const key = `ws:${Math.random()}`;
    const a = serializeSidebarRun(key, async () => { throw new Error('boom'); });
    const b = serializeSidebarRun(key, async () => 'ok');
    await assert.rejects(a.promise, /boom/);
    assert.equal(await b.promise, 'ok');
    const c = serializeSidebarRun(key, async () => 'fresh');
    assert.equal(c.coalesced, false, 'after both runs finish, the next call starts fresh');
    assert.equal(await c.promise, 'fresh');
  });

  it('different entities do not serialize against each other', async () => {
    const gate = deferred();
    const a = serializeSidebarRun(`ws:${Math.random()}`, async () => { await gate.promise; return 'a'; });
    const b = serializeSidebarRun(`ws:${Math.random()}`, async () => 'b');
    assert.equal(b.coalesced, false);
    assert.equal(await b.promise, 'b');
    gate.resolve(); await a.promise;
  });
});

describe('SIDEBAR4 — helpers', () => {
  it('isUniqueViolation requires the DB code 23505, not just HTTP 409', () => {
    assert.equal(isUniqueViolation({ ok: false, status: 409, data: { code: '23505' } }), true);
    assert.equal(isUniqueViolation({ ok: false, status: 409, data: { code: '23503' } }), false,
      'PostgREST maps FK violations to 409 too (P116)');
    assert.equal(isUniqueViolation({ ok: false, status: 409, data: {} }), false);
    assert.equal(isUniqueViolation({ ok: false, status: 400, data: { code: '23505' } }), false);
  });

  it('personContactKey mirrors the index key: email lower/trim first, else phone digits', () => {
    assert.equal(personContactKey(' Adonna@AcsResInc.com ', '(229) 561-7608'), 'adonna@acsresinc.com');
    assert.equal(personContactKey(null, '(229) 561-7608'), '2295617608');
    assert.equal(personContactKey('', '229-561-7608'), '2295617608');
    assert.equal(personContactKey('', ''), null);
    assert.equal(personContactKey(null, null), null);
  });
});

function stubOps({ postStatus = 409, postCode = '23505', winner }) {
  process.env.OPS_SUPABASE_URL = 'https://ops.example.com';
  process.env.OPS_SUPABASE_KEY = 'test-key';
  const calls = { posts: 0, twinLookups: 0, identityPosts: 0, mergeField: 0 };
  let posted = false;
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    const m = opts.method || 'GET';
    if (u.includes('/external_identities?') && m === 'GET') return jsonResponse([]);
    if (u.includes('/entities?') && m === 'GET') {
      if (!posted) return jsonResponse([]); // the pre-insert lookups see nothing: the race window
      calls.twinLookups++;
      return jsonResponse(winner ? [winner] : []);
    }
    if (u.endsWith('/entities') && m === 'POST') {
      calls.posts++; posted = true;
      return jsonResponse({ code: postCode, message: 'duplicate key value' }, false, postStatus);
    }
    if (/\/external_identities(\?|$)/.test(u) && m === 'POST') {
      calls.identityPosts++;
      return jsonResponse([{ id: 'ext-1', ...JSON.parse(opts.body) }]);
    }
    if (u.includes('/rpc/lcc_merge_field')) { calls.mergeField++; return jsonResponse([{ decision: 'write' }]); }
    return jsonResponse([]);
  };
  return calls;
}

const seed = {
  workspaceId: 'ws-1',
  userId: 'u-1',
  sourceSystem: 'costar',
  sourceType: 'contact',
  externalId: 'john messer',
  domain: 'dia',
  seedFields: { name: 'John Messer', email: 'adonna@acsresinc.com' },
};

describe('SIDEBAR4 — ensureEntityLink attaches the loser of a concurrent person mint', () => {
  afterEach(() => { global.fetch = originalFetch; });

  it('on 23505 it resolves to the live winner on the same (name, email) key instead of failing', async () => {
    const winner = {
      id: '95b8ad0a-winner', name: 'John Messer', canonical_name: 'john messer',
      entity_type: 'person', email: 'ADONNA@acsresinc.com', phone: null, domain: 'dia',
    };
    const calls = stubOps({ winner });
    const res = await ensureEntityLink(seed);
    assert.equal(res.ok, true);
    assert.equal(res.entityId || res.entity?.id, winner.id);
    assert.equal(res.createdEntity, false, 'an attach created nothing — no second new_contact_qualify card');
    assert.equal(calls.posts, 1);
    assert.ok(calls.twinLookups >= 1);
    assert.equal(calls.identityPosts, 1, 'the inbound identity still lands, on the winner');
    assert.equal(calls.mergeField, 0, 'the loser records no create provenance — the winner already did');
  });

  it('does NOT attach to a same-name row on a DIFFERENT mailbox — a shared name is not identity', async () => {
    stubOps({ winner: { id: 'other', name: 'John Messer', canonical_name: 'john messer',
      entity_type: 'person', email: 'john@elsewhere.com', phone: null } });
    const res = await ensureEntityLink(seed);
    assert.equal(res.ok, false);
    assert.match(String(res.error), /Failed to create canonical entity/);
  });

  it('a 409 carrying 23503 (FK) is not treated as a concurrent mint', async () => {
    const calls = stubOps({ postCode: '23503', winner: { id: 'w', name: 'John Messer',
      entity_type: 'person', email: 'adonna@acsresinc.com' } });
    const res = await ensureEntityLink(seed);
    assert.equal(res.ok, false);
    assert.equal(calls.twinLookups, 0, 'no twin lookup on a non-unique 409');
  });
});

describe('SIDEBAR4 — migration shape', () => {
  const sql = readFileSync(join(ROOT,
    'supabase/migrations/20261102240000_lcc_sidebar4_person_contact_race_unique_index.sql'), 'utf8')
    .replace(/--[^\n]*/g, '');

  it('is a UNIQUE index scoped to live persons created after the cutoff, keyed on name + email-or-phone', () => {
    assert.match(sql, /create unique index if not exists uq_entities_person_contact_key_sidebar4/i);
    assert.match(sql, /where entity_type = 'person'/i, 'organizations must stay out (N15e owns name-only uniqueness)');
    assert.match(sql, /merged_into_entity_id is null/i, 'a merge tombstone must not block its survivor');
    assert.match(sql, /created_at >= timestamptz '2026-09-22 21:00:00\+00'/i,
      'partial on created_at: the 78 pre-existing groups are not merged by this change');
    assert.match(sql, /\bis not null;/i, 'a row with neither email nor phone is excluded — name alone is not a key');
    assert.match(sql, /lower\(btrim\(email\)\)/i);
    assert.match(sql, /regexp_replace\(coalesce\(phone, ''\), '\\D', '', 'g'\)/i);
  });
});
