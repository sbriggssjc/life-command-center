// R16 Unit 1 — contact-acquisition worker tests.
//
// Covers the deps-injected per-entity core (acquireForEntity), the don't-
// re-hammer guard (isAcqExhausted), and the shared contact-attach machinery
// (linkPersonToEntity dupe-guard + stampCadenceContactById metadata merge).
// The reachability gate (Unit 2) is SQL and is verified at the DB layer.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { acquireForEntity, isAcqExhausted, isSelfContactablePerson } from '../api/_handlers/contact-acquisition.js';
import { linkPersonToEntity, stampCadenceContactById } from '../api/_shared/contact-attach.js';

const originalFetch = global.fetch;

function jsonResponse(body, ok = true, status = 200, headers = {}) {
  return {
    ok, status,
    headers: { get(name) { return headers[name.toLowerCase()] || headers[name] || null; } },
    async text() { return JSON.stringify(body); },
  };
}

function recordingDeps(overrides = {}) {
  const calls = { ensurePerson: [], linkPerson: [], stampCadence: [], getSfContacts: [] };
  const deps = {
    getSfContacts: async (acct) => { calls.getSfContacts.push(acct); return { ok: true, contacts: [] }; },
    ensurePerson: async (c) => { calls.ensurePerson.push(c); return { ok: true, entity: { id: 'person-' + c.Id } }; },
    linkPerson: async (entityId, personId) => { calls.linkPerson.push([entityId, personId]); return { ok: true }; },
    stampCadence: async (cadenceId, args) => { calls.stampCadence.push([cadenceId, args]); return { ok: true }; },
    ...overrides,
  };
  return { deps, calls };
}

describe('acquireForEntity (R16 Unit 1)', () => {
  const candidate = { cadence_id: 'cad-1', entity_id: 'ent-1', sf_account_id: '001AAA', attempts: 0 };

  it('SF-mapped contactless → contacts pulled, persons created+linked, primary stamped', async () => {
    const { deps, calls } = recordingDeps({
      getSfContacts: async () => ({ ok: true, contacts: [
        { Id: '003A', Name: 'Jane Doe', Email: 'jane@x.com', Title: 'CFO' },
        { Id: '003B', Name: 'John Roe' },
      ] }),
    });
    const out = await acquireForEntity(candidate, deps);
    assert.equal(out.outcome, 'acquired');
    assert.equal(out.contacts_created, 2);
    assert.equal(calls.ensurePerson.length, 2);
    assert.equal(calls.linkPerson.length, 2);
    // Primary (first contact) stamped onto the cadence with both ids.
    const [cadId, stampArgs] = calls.stampCadence[0];
    assert.equal(cadId, 'cad-1');
    assert.equal(stampArgs.contactEntityId, 'person-003A');
    assert.equal(stampArgs.sfContactId, '003A');
    assert.equal(stampArgs.acquisitionMeta.status, 'acquired');
    assert.equal(stampArgs.acquisitionMeta.count, 2);
  });

  it('SF returns no contacts → no_contacts recorded, no contact stamped (falls to P-CONTACT)', async () => {
    const { deps, calls } = recordingDeps({ getSfContacts: async () => ({ ok: true, contacts: [] }) });
    const out = await acquireForEntity(candidate, deps);
    assert.equal(out.outcome, 'no_contacts');
    assert.equal(out.contacts_created, 0);
    assert.equal(calls.ensurePerson.length, 0);
    const [, stampArgs] = calls.stampCadence[0];
    assert.equal(stampArgs.acquisitionMeta.status, 'no_contacts');
    assert.equal(stampArgs.contactEntityId, undefined); // nothing stamped → stays contactless
    assert.equal(stampArgs.sfContactId, undefined);
  });

  it('all returned contacts rejected by guards → no_usable_contacts, never invents', async () => {
    const { deps, calls } = recordingDeps({
      getSfContacts: async () => ({ ok: true, contacts: [{ Id: '003C', Name: 'Acme Holdings LLC' }] }),
      ensurePerson: async () => ({ ok: false, skipped: 'implausible_person_name' }),
    });
    const out = await acquireForEntity(candidate, deps);
    assert.equal(out.outcome, 'no_contacts');
    assert.equal(calls.linkPerson.length, 0);
    const [, stampArgs] = calls.stampCadence[0];
    assert.equal(stampArgs.acquisitionMeta.status, 'no_usable_contacts');
  });

  it('SF unavailable → unavailable recorded with incremented attempts (retryable)', async () => {
    const { deps, calls } = recordingDeps({ getSfContacts: async () => ({ ok: false, reason: 'flow_http_error' }) });
    const out = await acquireForEntity({ ...candidate, attempts: 1 }, deps);
    assert.equal(out.outcome, 'unavailable');
    const [, stampArgs] = calls.stampCadence[0];
    assert.equal(stampArgs.acquisitionMeta.status, 'unavailable');
    assert.equal(stampArgs.acquisitionMeta.attempts, 2);
  });
});

// Phase 2 (2026-07-13) — the worklist SF cheap-win reuses acquireForEntity with
// a stampCadence that routes through stampContactOnActiveCadence(seedIfValuable),
// so a high-value worklist owner with NO cadence gains a contact AND a seeded
// cadence (the maybeSeedValuableCadence wire) → it becomes workable outreach.
describe('worklist SF path — acquire attaches a contact + seeds a cadence (Phase 2)', () => {
  const owner = { cadence_id: null, entity_id: 'owner-9', sf_account_id: '001WWW', attempts: 0 };

  it('SF contacts pulled → persons linked, primary stamps a NEWLY-SEEDED cadence', async () => {
    const seeds = [];
    // The worklist stamp: contact-carrying calls seed a value-gated cadence;
    // no-contact (failure metadata) calls are a no-op (no cadence yet).
    const worklistStamp = async (cadenceId, args) => {
      if (!args || (!args.contactEntityId && !args.sfContactId)) return { ok: true };
      seeds.push(args);
      return { ok: true, seeded: true, cadenceId: 'seeded-cad-1' };
    };
    const { deps, calls } = recordingDeps({
      getSfContacts: async () => ({ ok: true, contacts: [
        { Id: '003AAA', Name: 'Adam Kamlet', Title: 'Managing Director', Email: 'adam@x.com' },
      ] }),
      stampCadence: worklistStamp,
    });
    const out = await acquireForEntity(owner, deps);
    assert.equal(out.outcome, 'acquired');
    assert.equal(out.contacts_created, 1);
    assert.equal(calls.linkPerson.length, 1, 'person linked to the owner');
    assert.equal(seeds.length, 1, 'the primary contact stamped/seeded a cadence');
    assert.equal(seeds[0].contactEntityId, 'person-003AAA');
    assert.equal(seeds[0].sfContactId, '003AAA');
  });

  it('empty SF account → no_contacts (no cadence seeded, falls to manual acquisition)', async () => {
    const seeds = [];
    const worklistStamp = async (_cid, args) => {
      if (!args || (!args.contactEntityId && !args.sfContactId)) return { ok: true };
      seeds.push(args); return { ok: true, seeded: true };
    };
    const { deps } = recordingDeps({
      getSfContacts: async () => ({ ok: true, contacts: [] }),
      stampCadence: worklistStamp,
    });
    const out = await acquireForEntity(owner, deps);
    assert.equal(out.outcome, 'no_contacts');
    assert.equal(seeds.length, 0, 'no cadence seeded when there is no contact');
  });
});

describe('isAcqExhausted — don\'t re-hammer (R16 Unit 1)', () => {
  it('treats definitive empty + acquired + capped-unavailable as exhausted; transient/unset as retryable', () => {
    assert.equal(isAcqExhausted(null), false);
    assert.equal(isAcqExhausted({}), false);
    assert.equal(isAcqExhausted({ contact_acquisition: { status: 'acquired' } }), true);
    assert.equal(isAcqExhausted({ contact_acquisition: { status: 'no_contacts' } }), true);
    assert.equal(isAcqExhausted({ contact_acquisition: { status: 'no_usable_contacts' } }), true);
    assert.equal(isAcqExhausted({ contact_acquisition: { status: 'unavailable', attempts: 4 } }), true);
    assert.equal(isAcqExhausted({ contact_acquisition: { status: 'unavailable', attempts: 1 } }), false);
  });
});

describe('isSelfContactablePerson — person is their own contact (R20)', () => {
  it('person with an email self-stamps (becomes its own contact)', () => {
    assert.equal(isSelfContactablePerson({ entity_type: 'person', name: 'Steven Manela', email: 'steven@x.com' }), true);
  });

  it('person with only a phone self-stamps', () => {
    assert.equal(isSelfContactablePerson({ entity_type: 'person', name: 'Neil McMurry', phone: '(307) 555-1212' }), true);
  });

  it('person with no email and no phone stays cold (P-CONTACT)', () => {
    assert.equal(isSelfContactablePerson({ entity_type: 'person', name: 'Jane Cold', email: '', phone: null }), false);
    assert.equal(isSelfContactablePerson({ entity_type: 'person', name: 'Jane Cold' }), false);
  });

  it('an organization is never its own contact (even with an email)', () => {
    assert.equal(isSelfContactablePerson({ entity_type: 'organization', name: 'Acme Capital', email: 'info@acme.com' }), false);
  });

  it('a firm mistyped as a person is not self-stamped (looksLikePersonName guard)', () => {
    assert.equal(isSelfContactablePerson({ entity_type: 'person', name: 'Townsend Capital LLC', email: 'x@y.com' }), false);
    assert.equal(isSelfContactablePerson({ entity_type: 'person', name: 'Leibsohn Family Trust', phone: '5551212' }), false);
  });

  it('a junk/orphan-flagged person is excluded', () => {
    assert.equal(isSelfContactablePerson({ entity_type: 'person', name: 'Real Person', email: 'r@x.com', metadata: { junk_name_flagged: true } }), false);
    assert.equal(isSelfContactablePerson({ entity_type: 'person', name: 'Real Person', email: 'r@x.com', metadata: { orphan_flagged: true } }), false);
  });

  it('whitespace-only email/phone does not count', () => {
    assert.equal(isSelfContactablePerson({ entity_type: 'person', name: 'Hollow Contact', email: '   ', phone: '  ' }), false);
  });
});

describe('contact-attach shared helpers (R16)', () => {
  beforeEach(() => { process.env.OPS_SUPABASE_URL = 'https://ops.example.com'; process.env.OPS_SUPABASE_KEY = 'k'; });
  afterEach(() => { global.fetch = originalFetch; });

  it('stampCadenceContactById merges metadata + writes contact ids', async () => {
    let patchBody = null;
    global.fetch = async (url, opts = {}) => {
      const u = String(url); const m = (opts.method || 'GET').toUpperCase();
      if (u.includes('/touchpoint_cadence') && m === 'PATCH') { patchBody = JSON.parse(opts.body); return jsonResponse([{}], true, 200, { 'content-range': '0-0/1' }); }
      throw new Error('unexpected ' + m + ' ' + u);
    };
    const r = await stampCadenceContactById('cad-9', {
      contactEntityId: 'p-1', sfContactId: '003Z',
      acquisitionMeta: { status: 'acquired', count: 1 },
      existingMetadata: { keep: 'me' },
    });
    assert.equal(r.ok, true);
    assert.equal(patchBody.contact_id, 'p-1');
    assert.equal(patchBody.sf_contact_id, '003Z');
    assert.equal(patchBody.metadata.keep, 'me');             // existing preserved
    assert.equal(patchBody.metadata.contact_acquisition.status, 'acquired');
  });

  it('linkPersonToEntity is dupe-guarded — skips POST when an edge exists', async () => {
    let posted = false;
    global.fetch = async (url, opts = {}) => {
      const u = String(url); const m = (opts.method || 'GET').toUpperCase();
      if (u.includes('/entity_relationships') && m === 'GET') return jsonResponse([{ id: 'rel-1' }], true, 200, { 'content-range': '0-0/1' });
      if (u.includes('/entity_relationships') && m === 'POST') { posted = true; return jsonResponse([{ id: 'rel-2' }]); }
      throw new Error('unexpected ' + m + ' ' + u);
    };
    const r = await linkPersonToEntity({ workspaceId: 'ws', entityId: 'ent', contactEntityId: 'p-1' });
    assert.equal(r.ok, true);
    assert.equal(r.existed, true);
    assert.equal(posted, false);
  });

  it('linkPersonToEntity inserts when no edge exists', async () => {
    let posted = false;
    global.fetch = async (url, opts = {}) => {
      const u = String(url); const m = (opts.method || 'GET').toUpperCase();
      if (u.includes('/entity_relationships') && m === 'GET') return jsonResponse([], true, 200, { 'content-range': '*/0' });
      if (u.includes('/entity_relationships') && m === 'POST') { posted = true; return jsonResponse([{ id: 'rel-2' }]); }
      throw new Error('unexpected ' + m + ' ' + u);
    };
    const r = await linkPersonToEntity({ workspaceId: 'ws', entityId: 'ent', contactEntityId: 'p-1' });
    assert.equal(r.ok, true);
    assert.equal(posted, true);
  });
});
