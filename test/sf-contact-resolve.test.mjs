// SF-CONTACT-RECONCILE Unit 2 — the WhoId resolver worker tests.
//
// Covers the deps-injected per-WhoId core (resolveWhoId): resolve/mint,
// reconcile-by-email, no_data, retry→dead-letter, guard-rejection, mismatch
// flag, and the not_configured pass-through. Plus getSalesforceContactById
// field-mapping (fetch-mocked) — the by-id flow adapter.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWhoId } from '../api/_handlers/sf-contact-resolve.js';
import { getSalesforceContactById, isSfContactByIdConfigured } from '../api/_shared/salesforce.js';
import { defaultResolveOrCreateSfContact } from '../api/_handlers/sf-activity-ingest.js';

// ── resolveWhoId (deps-injected core) ────────────────────────────────────────
function recordingDeps(overrides = {}) {
  const calls = { getContactById: [], mintContact: [], detectMismatch: [], openMismatch: [], markRow: [] };
  const deps = {
    maxAttempts: 3,
    getContactById: async (whoId) => { calls.getContactById.push(whoId); return { ok: true, contact: { id: whoId, name: 'Joseph Capra', email: null, account_id: '001B', account_name: 'Boyd Watterson' } }; },
    mintContact: async (a) => { calls.mintContact.push(a); return { ok: true, entityId: 'ent-' + a.whoId, createdEntity: true, resolvedByEmail: false }; },
    detectMismatch: (a) => { calls.detectMismatch.push(a); return { mismatch: false }; },
    openMismatch: async (a) => { calls.openMismatch.push(a); return true; },
    markRow: async (whoId, patch) => { calls.markRow.push([whoId, patch]); },
    ...overrides,
  };
  return { deps, calls };
}

describe('resolveWhoId (SF-CONTACT-RECONCILE Unit 2)', () => {
  const row = { who_id: '003zzz', workspace_id: 'ws-1', attempts: 0 };

  it('mints the contact and marks the row resolved (+ entity_id)', async () => {
    const { deps, calls } = recordingDeps();
    const out = await resolveWhoId(row, deps);
    assert.equal(out.outcome, 'resolved');
    assert.equal(out.entity_id, 'ent-003zzz');
    assert.equal(out.created, true);
    assert.equal(calls.mintContact.length, 1);
    assert.equal(calls.mintContact[0].workspaceId, 'ws-1');
    const [, patch] = calls.markRow.at(-1);
    assert.equal(patch.status, 'resolved');
    assert.equal(patch.resolved_entity_id, 'ent-003zzz');
    assert.equal(patch.attempts, 1);
    assert.equal(patch.detail, 'minted');
  });

  it('records the reconcile-by-email path (attach to existing person, no dup)', async () => {
    const { deps, calls } = recordingDeps({
      mintContact: async (a) => ({ ok: true, entityId: 'ent-existing', createdEntity: false, resolvedByEmail: true }),
    });
    const out = await resolveWhoId(row, deps);
    assert.equal(out.outcome, 'resolved');
    assert.equal(out.reconciled, true);
    assert.equal(out.created, false);
    assert.equal(calls.markRow.at(-1)[1].detail, 'reconciled_email');
  });

  it('marks no_data when the by-id flow returns no contact (Lead / blank / deleted)', async () => {
    const { deps, calls } = recordingDeps({ getContactById: async () => ({ ok: false, reason: 'no_data' }) });
    const out = await resolveWhoId(row, deps);
    assert.equal(out.outcome, 'no_data');
    assert.equal(calls.mintContact.length, 0, 'never mints when there is no contact');
    assert.equal(calls.markRow.at(-1)[1].status, 'no_data');
  });

  it('marks no_data on a malformed contact id (never crashes)', async () => {
    const { deps } = recordingDeps({ getContactById: async () => ({ ok: false, reason: 'bad_contact_id' }) });
    const out = await resolveWhoId(row, deps);
    assert.equal(out.outcome, 'no_data');
  });

  it('retries a transient outage (keeps status seen, bumps attempts)', async () => {
    const { deps, calls } = recordingDeps({ getContactById: async () => ({ ok: false, reason: 'unavailable' }) });
    const out = await resolveWhoId({ who_id: '003zzz', workspace_id: 'ws-1', attempts: 0 }, deps);
    assert.equal(out.outcome, 'retry');
    const patch = calls.markRow.at(-1)[1];
    assert.equal(patch.status, 'seen');
    assert.equal(patch.attempts, 1);
  });

  it('dead-letters a transient outage once attempts reach the cap', async () => {
    const { deps, calls } = recordingDeps({ getContactById: async () => ({ ok: false, reason: 'unavailable' }) });
    // attempts=2, maxAttempts=3 → this attempt (3) hits the cap.
    const out = await resolveWhoId({ who_id: '003zzz', workspace_id: 'ws-1', attempts: 2 }, deps);
    assert.equal(out.outcome, 'dead');
    assert.equal(calls.markRow.at(-1)[1].status, 'dead');
  });

  it('guard-rejected mint (no usable name) → no_data, no mismatch check', async () => {
    const { deps, calls } = recordingDeps({ mintContact: async () => ({ ok: false, reason: 'guard_rejected' }) });
    const out = await resolveWhoId(row, deps);
    assert.equal(out.outcome, 'guard_rejected');
    assert.equal(calls.markRow.at(-1)[1].status, 'no_data');
    assert.equal(calls.openMismatch.length, 0);
  });

  // 2026-07-15 field-map fix: an empty NAME (adapter/field-map miss) is honestly
  // 'no_name', NOT a guard rejection — the mislabel that hid the by-id field bug.
  it('empty name (field-map miss) → no_name, NOT guard_rejected', async () => {
    const { deps, calls } = recordingDeps({ mintContact: async () => ({ ok: false, reason: 'no_name' }) });
    const out = await resolveWhoId(row, deps);
    assert.equal(out.outcome, 'no_name');
    const patch = calls.markRow.at(-1)[1];
    assert.equal(patch.status, 'no_data');
    assert.equal(patch.detail, 'no_name');
    assert.equal(calls.openMismatch.length, 0);
  });

  // A GENUINE name-guard rejection still surfaces as guard_rejected (with the
  // real skip reason in detail), distinct from a null name.
  it('a real name-guard skip → guard_rejected with the true reason in detail', async () => {
    const { deps, calls } = recordingDeps({ mintContact: async () => ({ ok: false, reason: 'implausible_person_name' }) });
    const out = await resolveWhoId(row, deps);
    assert.equal(out.outcome, 'guard_rejected');
    assert.equal(calls.markRow.at(-1)[1].detail, 'implausible_person_name');
  });

  // A create/link failure (DB/RLS/transient) is retried, not terminally stranded.
  it('create_failed (DB/link error) is transient → retry (keeps status seen)', async () => {
    const { deps, calls } = recordingDeps({ mintContact: async () => ({ ok: false, reason: 'create_failed', detail: 'RLS denied' }) });
    const out = await resolveWhoId({ who_id: '003zzz', workspace_id: 'ws-1', attempts: 0 }, deps);
    assert.equal(out.outcome, 'retry');
    const patch = calls.markRow.at(-1)[1];
    assert.equal(patch.status, 'seen');
    assert.match(patch.detail, /create_failed/);
    assert.match(patch.detail, /RLS denied/);
  });

  it('create_failed dead-letters at the attempts cap', async () => {
    const { deps, calls } = recordingDeps({ mintContact: async () => ({ ok: false, reason: 'create_failed' }) });
    const out = await resolveWhoId({ who_id: '003zzz', workspace_id: 'ws-1', attempts: 2 }, deps);
    assert.equal(out.outcome, 'dead');
    assert.equal(calls.markRow.at(-1)[1].status, 'dead');
  });

  // The EXACT lowercase by-id payload (Eric Dowling) flows end-to-end to a
  // resolved entity — no guard_rejected — once the adapter maps the name.
  it('resolves the exact lowercase by-id payload (Eric Dowling) end-to-end', async () => {
    let mintArg = null;
    const { deps } = recordingDeps({
      getContactById: async (whoId) => getSalesforceContactById(whoId),
      mintContact: async (a) => { mintArg = a; return a.contact.name ? { ok: true, entityId: 'ent-' + a.whoId, createdEntity: true } : { ok: false, reason: 'no_name' }; },
    });
    const savedUrl = process.env.SF_CONTACT_BYID_URL;
    const savedFetch = global.fetch;
    process.env.SF_CONTACT_BYID_URL = 'https://pa.example/byid?sig=x';
    global.fetch = async () => ({ ok: true, status: 200, async text() {
      return JSON.stringify({
        id: '0038W00002PRqkNQAT', name: 'Eric Dowling', email: 'edowling@boydwatterson.com',
        first_name: 'Eric', last_name: 'Dowling', phone: '3127773704', title: 'Analyst',
        account_id: '0018W00001dRmM1QAK', account_name: 'Arbor Realty Trust',
      });
    } });
    try {
      const out = await resolveWhoId({ who_id: '0038W00002PRqkNQAT', workspace_id: 'ws-1', attempts: 0 }, deps);
      assert.equal(out.outcome, 'resolved');
      assert.equal(out.entity_id, 'ent-0038W00002PRqkNQAT');
      // The mint received a fully-mapped contact (name reached the resolver).
      assert.equal(mintArg.contact.name, 'Eric Dowling');
      assert.equal(mintArg.contact.email, 'edowling@boydwatterson.com');
    } finally {
      global.fetch = savedFetch;
      if (savedUrl === undefined) delete process.env.SF_CONTACT_BYID_URL; else process.env.SF_CONTACT_BYID_URL = savedUrl;
    }
  });

  it('flags the SF account/email mismatch (Dowling on Arbor) via the Decision-Center producer', async () => {
    const { deps, calls } = recordingDeps({
      getContactById: async () => ({ ok: true, contact: { id: '003ddd', name: 'Eric Dowling', email: 'edowling@boydwatterson.com', account_id: '001A', account_name: 'Arbor Realty Trust' } }),
      detectMismatch: () => ({ mismatch: true, email_domain: 'boydwatterson.com', account_name: 'Arbor Realty Trust' }),
    });
    const out = await resolveWhoId({ who_id: '003ddd', workspace_id: 'ws-1', attempts: 0 }, deps);
    assert.equal(out.outcome, 'resolved');
    assert.equal(out.mismatch_flagged, true);
    assert.equal(calls.openMismatch.length, 1);
    assert.equal(calls.openMismatch[0].detail.sf_contact_id, '003ddd');
    assert.equal(calls.openMismatch[0].detail.account_name, 'Arbor Realty Trust');
  });

  it('does not flag when email + account agree (Capra on Boyd)', async () => {
    const { deps, calls } = recordingDeps({
      getContactById: async () => ({ ok: true, contact: { id: '003ccc', name: 'Joseph Capra', email: 'jcapra@boydwatterson.com', account_id: '001B', account_name: 'Boyd Watterson Asset Management LLC' } }),
      detectMismatch: () => ({ mismatch: false }),
    });
    const out = await resolveWhoId({ who_id: '003ccc', workspace_id: 'ws-1', attempts: 0 }, deps);
    assert.equal(out.outcome, 'resolved');
    assert.equal(out.mismatch_flagged, false);
    assert.equal(calls.openMismatch.length, 0);
  });

  it('does not run the mismatch detector without both email AND account_name', async () => {
    const { deps, calls } = recordingDeps({
      getContactById: async () => ({ ok: true, contact: { id: '003eee', name: 'No Account', email: 'x@firmdomain.com', account_id: null, account_name: null } }),
    });
    await resolveWhoId({ who_id: '003eee', workspace_id: 'ws-1', attempts: 0 }, deps);
    assert.equal(calls.detectMismatch.length, 0);
  });

  it('not_configured passes through without touching the row', async () => {
    const { deps, calls } = recordingDeps({ getContactById: async () => ({ ok: false, reason: 'not_configured' }) });
    const out = await resolveWhoId(row, deps);
    assert.equal(out.outcome, 'not_configured');
    assert.equal(calls.markRow.length, 0, 'never burns an attempt on unconfigured');
  });
});

// ── getSalesforceContactById (the by-id flow adapter) ────────────────────────
const originalFetch = global.fetch;
function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, async text() { return JSON.stringify(body); } };
}

describe('getSalesforceContactById', () => {
  beforeEach(() => { process.env.SF_CONTACT_BYID_URL = 'https://pa.example/byid?sig=x'; });
  afterEach(() => { global.fetch = originalFetch; delete process.env.SF_CONTACT_BYID_URL; });

  it('is unconfigured (worker no-ops) when the env is unset', async () => {
    delete process.env.SF_CONTACT_BYID_URL;
    assert.equal(isSfContactByIdConfigured(), false);
    const r = await getSalesforceContactById('003aaa000000001');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'not_configured');
  });

  it('rejects a malformed WhoId without an HTTP call', async () => {
    let called = false;
    global.fetch = async () => { called = true; return jsonResponse({}); };
    const r = await getSalesforceContactById('not-an-id');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'bad_contact_id');
    assert.equal(called, false);
  });

  it('maps the flow response (snake_case) to a normalized contact', async () => {
    global.fetch = async () => jsonResponse({
      id: '003aaa000000001', name: 'Joseph Capra', email: 'jcapra@boydwatterson.com',
      first_name: 'Joseph', last_name: 'Capra', phone: '555-1000', title: 'MD',
      account_id: '001bbb000000001', account_name: 'Boyd Watterson Asset Management LLC',
    });
    const r = await getSalesforceContactById('003aaa000000001');
    assert.equal(r.ok, true);
    assert.equal(r.contact.name, 'Joseph Capra');
    assert.equal(r.contact.email, 'jcapra@boydwatterson.com');
    assert.equal(r.contact.first, 'Joseph');
    assert.equal(r.contact.title, 'MD');
    assert.equal(r.contact.account_name, 'Boyd Watterson Asset Management LLC');
  });

  it('tolerates PascalCase + a { contact:{…} } envelope', async () => {
    global.fetch = async () => jsonResponse({ ok: true, contact: { Id: '003aaa000000002', Name: 'Eric Dowling', Email: 'edowling@boydwatterson.com', AccountName: 'Arbor Realty Trust' } });
    const r = await getSalesforceContactById('003aaa000000002');
    assert.equal(r.ok, true);
    assert.equal(r.contact.id, '003aaa000000002');
    assert.equal(r.contact.name, 'Eric Dowling');
    assert.equal(r.contact.account_name, 'Arbor Realty Trust');
  });

  // The EXACT lowercase Response body the PA flow returns (2026-07-15 receipts).
  // Every field must map — the miss that mislabeled every contact guard_rejected.
  it('maps the EXACT lowercase by-id payload (Eric Dowling) — all fields', async () => {
    global.fetch = async () => jsonResponse({
      id: '0038W00002PRqkNQAT', name: 'Eric Dowling', email: 'edowling@boydwatterson.com',
      first_name: 'Eric', last_name: 'Dowling', phone: '3127773704', title: 'Analyst',
      account_id: '0018W00001dRmM1QAK', account_name: 'Arbor Realty Trust',
    });
    const r = await getSalesforceContactById('0038W00002PRqkNQAT');
    assert.equal(r.ok, true);
    assert.deepEqual(r.contact, {
      id: '0038W00002PRqkNQAT', name: 'Eric Dowling', email: 'edowling@boydwatterson.com',
      first: 'Eric', last: 'Dowling', phone: '3127773704', title: 'Analyst',
      account_id: '0018W00001dRmM1QAK', account_name: 'Arbor Realty Trust',
    });
  });

  // A raw Salesforce record (PascalCase API names + nested Account.Name).
  it('maps a raw SF record (PascalCase + nested Account.Name)', async () => {
    global.fetch = async () => jsonResponse({
      attributes: { type: 'Contact' },
      Id: '0038W00002PRo0iQAD', Name: 'Joseph Capra', Email: 'jcapra@boydwatterson.com',
      FirstName: 'Joseph', LastName: 'Capra', AccountId: '0018W00001aaa',
      Account: { Name: 'Boyd Watterson Asset Management LLC' },
    });
    const r = await getSalesforceContactById('0038W00002PRo0iQAD');
    assert.equal(r.ok, true);
    assert.equal(r.contact.name, 'Joseph Capra');
    assert.equal(r.contact.first, 'Joseph');
    assert.equal(r.contact.account_id, '0018W00001aaa');
    assert.equal(r.contact.account_name, 'Boyd Watterson Asset Management LLC');
  });

  it('unwraps a { body:{…} } / { value:[…] } envelope', async () => {
    global.fetch = async () => jsonResponse({ body: { id: '003aaa000000009', name: 'Wrapped Person' } });
    const rb = await getSalesforceContactById('003aaa000000009');
    assert.equal(rb.ok, true);
    assert.equal(rb.contact.name, 'Wrapped Person');

    global.fetch = async () => jsonResponse({ value: [{ id: '003aaa000000010', name: 'List Person' }] });
    const rv = await getSalesforceContactById('003aaa000000010');
    assert.equal(rv.ok, true);
    assert.equal(rv.contact.name, 'List Person');
  });

  it('returns no_data on a 200 with no contact id (Lead / blank)', async () => {
    global.fetch = async () => jsonResponse({});
    const r = await getSalesforceContactById('00Qaaa000000001');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'no_data');
  });

  it('returns unavailable on a non-2xx (transient / bad key)', async () => {
    global.fetch = async () => jsonResponse({ error: 'unauthorized' }, false, 401);
    const r = await getSalesforceContactById('003aaa000000003');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'unavailable');
    assert.equal(r.status, 401);
  });

  it('returns unavailable on a network throw (never crashes)', async () => {
    global.fetch = async () => { throw new Error('ECONNRESET'); };
    const r = await getSalesforceContactById('003aaa000000004');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'unavailable');
  });
});

// ── defaultResolveOrCreateSfContact (the mint contract) ──────────────────────
describe('defaultResolveOrCreateSfContact', () => {
  // The empty-name early return is pure (no DB / no ensureEntityLink call): a
  // by-id result with no usable name/email is honestly 'no_name', NOT a guard
  // rejection — the mislabel the 2026-07-15 field-map fix un-conflates.
  it('empty name/email → { ok:false, reason:"no_name" } (no guard reject)', async () => {
    const r = await defaultResolveOrCreateSfContact({ workspaceId: 'ws-1', whoId: '003zzz', name: null, email: null, first: null, last: null });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'no_name');
  });

  it('whitespace-only name/email still → no_name', async () => {
    const r = await defaultResolveOrCreateSfContact({ workspaceId: 'ws-1', whoId: '003zzz', name: '   ', email: '  ', first: '', last: '' });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'no_name');
  });
});
