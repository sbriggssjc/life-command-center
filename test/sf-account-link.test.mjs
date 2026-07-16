// SF-CONFLATION Unit C/B — sf-account-link.js tests.
//
// The SF-Account modeling choke point:
//   C1 — contactPersonName: the person name comes from CONTACT fields only.
//   B  — accountBindingDecision / sfContactAccountMismatch: email-domain-
//        authoritative binding (agree→bind account, disagree→demote).
//   C2 — relatePersonToSfAccount: relate person→org edge (deps-injected), NEVER
//        stamp a salesforce/Account identity on the person.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  contactPersonName,
  accountBindingDecision,
  sfContactAccountMismatch,
  relatePersonToSfAccount,
} from '../api/_shared/sf-account-link.js';

// ── C1: contactPersonName — never the account name ───────────────────────────
describe('contactPersonName (C1)', () => {
  it('prefers structured first+last over a firm-contaminated name', () => {
    // the "Boyd Watterson Global on Eric Dowling" bleed: first/last win.
    assert.equal(contactPersonName({ name: 'Boyd Watterson Global', first: 'Eric', last: 'Dowling' }), 'Eric Dowling');
  });
  it('uses name when only name is present (a Contact.Name is the person)', () => {
    assert.equal(contactPersonName({ name: 'Joseph Capra' }), 'Joseph Capra');
  });
  it('falls back to a single name part', () => {
    assert.equal(contactPersonName({ first: 'Cher' }), 'Cher');
    assert.equal(contactPersonName({ last: 'Prince' }), 'Prince');
  });
  it('returns null when nothing usable', () => {
    assert.equal(contactPersonName({}), null);
    assert.equal(contactPersonName({ name: '   ', first: '', last: null }), null);
  });
});

// ── B: mismatch detector + binding decision ──────────────────────────────────
describe('sfContactAccountMismatch (B)', () => {
  it('flags a firm-domain email on a disagreeing account (Dowling/Arbor)', () => {
    const m = sfContactAccountMismatch({ email: 'edowling@boydwatterson.com', accountName: 'Arbor Realty Trust' });
    assert.equal(m.mismatch, true);
    assert.equal(m.email_domain, 'boydwatterson.com');
  });
  it('agrees when the account matches the email domain (Capra/Boyd)', () => {
    assert.equal(sfContactAccountMismatch({ email: 'jcapra@boydwatterson.com', accountName: 'Boyd Watterson Asset Management LLC' }).mismatch, false);
  });
  it('cannot judge personal / generic / missing signals', () => {
    assert.equal(sfContactAccountMismatch({ email: 'someone@gmail.com', accountName: 'Arbor Realty Trust' }).mismatch, false);
    assert.equal(sfContactAccountMismatch({ email: 'info@boydwatterson.com', accountName: 'Arbor' }).mismatch, false);
    assert.equal(sfContactAccountMismatch({ email: '', accountName: 'Arbor' }).mismatch, false);
    assert.equal(sfContactAccountMismatch({ email: 'x@boydwatterson.com', accountName: '' }).mismatch, false);
  });
});

describe('accountBindingDecision (B)', () => {
  it('binds the account when it agrees', () => {
    assert.deepEqual(accountBindingDecision({ email: 'jcapra@boydwatterson.com', accountName: 'Boyd Watterson' }), { bind: 'account', mismatch: false });
  });
  it('binds when agreement cannot be judged (personal email)', () => {
    assert.equal(accountBindingDecision({ email: 'x@gmail.com', accountName: 'Arbor Realty Trust' }).bind, 'account');
  });
  it('refuses to bind a disagreeing account', () => {
    const d = accountBindingDecision({ email: 'edowling@boydwatterson.com', accountName: 'Arbor Realty Trust' });
    assert.equal(d.bind, 'none');
    assert.equal(d.mismatch, true);
  });
  it('never binds with no account name', () => {
    assert.equal(accountBindingDecision({ email: 'x@boydwatterson.com', accountName: '' }).bind, 'none');
  });
});

// ── C2: relatePersonToSfAccount — org edge, never account-on-person ───────────
function recordingDeps(overrides = {}) {
  const calls = { ensureEntityLink: [], linkPersonToEntity: [], mergePersonSfAccountMeta: [], findUniqueEmailDomainOrg: [] };
  const deps = {
    ensureEntityLink: async (a) => { calls.ensureEntityLink.push(a); return { ok: true, entityId: 'org-1', createdEntity: true }; },
    linkPersonToEntity: async (a) => { calls.linkPersonToEntity.push(a); return { ok: true, linked: true }; },
    mergePersonSfAccountMeta: async (id, m) => { calls.mergePersonSfAccountMeta.push({ id, ...m }); return true; },
    findUniqueEmailDomainOrg: async (a) => { calls.findUniqueEmailDomainOrg.push(a); return null; },
    ...overrides,
  };
  return { deps, calls };
}

describe('relatePersonToSfAccount (C2/B)', () => {
  it('agreeing account: creates the ORG entity + person→org edge, never account-on-person', async () => {
    const { deps, calls } = recordingDeps();
    const r = await relatePersonToSfAccount({
      workspaceId: 'ws-1', personEntityId: 'per-1', personEmail: 'jcapra@boydwatterson.com',
      accountId: '0018W00002X08rlQAB', accountName: 'Boyd Watterson Asset Management LLC', deps,
    });
    assert.equal(r.ok, true);
    assert.equal(r.bound, 'account_org');
    assert.equal(r.orgEntityId, 'org-1');
    // the account identity went onto the ORG (ensureEntityLink source_type=Account)
    assert.equal(calls.ensureEntityLink.length, 1);
    assert.equal(calls.ensureEntityLink[0].sourceType, 'Account');
    assert.equal(calls.ensureEntityLink[0].seedFields.name, 'Boyd Watterson Asset Management LLC');
    // person→org edge written (org=from, person=to)
    assert.equal(calls.linkPersonToEntity.length, 1);
    assert.equal(calls.linkPersonToEntity[0].entityId, 'org-1');
    assert.equal(calls.linkPersonToEntity[0].contactEntityId, 'per-1');
    // provenance always written on the person
    assert.equal(calls.mergePersonSfAccountMeta.length >= 1, true);
  });

  it('no account name: provenance only, NEVER creates an org / stamps account on person', async () => {
    const { deps, calls } = recordingDeps();
    const r = await relatePersonToSfAccount({
      workspaceId: 'ws-1', personEntityId: 'per-1', personEmail: 'karl@foundrycommercial.com',
      accountId: '0018W00002X0S7OQAV', accountName: null, deps,
    });
    assert.equal(r.ok, true);
    assert.equal(r.bound, 'none');
    assert.equal(r.reason, 'no_account_name');
    assert.equal(calls.ensureEntityLink.length, 0);   // no org created
    assert.equal(calls.linkPersonToEntity.length, 0); // no edge
    assert.equal(calls.mergePersonSfAccountMeta.length, 1); // provenance kept
  });

  it('disagreeing account + a unique email-domain org: bind that org, demote the account', async () => {
    const { deps, calls } = recordingDeps({ findUniqueEmailDomainOrg: async () => 'org-boyd' });
    const r = await relatePersonToSfAccount({
      workspaceId: 'ws-1', personEntityId: 'per-dowling', personEmail: 'edowling@boydwatterson.com',
      accountId: '001ARBOR', accountName: 'Arbor Realty Trust', deps,
    });
    assert.equal(r.bound, 'email_domain_org');
    assert.equal(r.orgEntityId, 'org-boyd');
    assert.deepEqual(r.demoted, ['001ARBOR']);
    // never created the (wrong) Arbor account org
    assert.equal(calls.ensureEntityLink.length, 0);
    assert.equal(calls.linkPersonToEntity[0].entityId, 'org-boyd');
  });

  it('disagreeing account + no email-domain org: needs the lane, never binds the wrong account', async () => {
    const { deps, calls } = recordingDeps();  // findUniqueEmailDomainOrg → null
    const r = await relatePersonToSfAccount({
      workspaceId: 'ws-1', personEntityId: 'per-dowling', personEmail: 'edowling@boydwatterson.com',
      accountId: '001ARBOR', accountName: 'Arbor Realty Trust', deps,
    });
    assert.equal(r.bound, 'none');
    assert.equal(r.needs_lane, true);
    assert.deepEqual(r.demoted, ['001ARBOR']);
    assert.equal(calls.ensureEntityLink.length, 0);   // never bound Arbor
    assert.equal(calls.linkPersonToEntity.length, 0);
  });

  it('missing input → ok:false, no writes', async () => {
    const { deps, calls } = recordingDeps();
    const r = await relatePersonToSfAccount({ workspaceId: 'ws-1', personEntityId: null, accountId: '001X', deps });
    assert.equal(r.ok, false);
    assert.equal(calls.mergePersonSfAccountMeta.length, 0);
  });

  it('never self-links when the account resolves to the person itself', async () => {
    const { deps, calls } = recordingDeps({ ensureEntityLink: async () => ({ ok: true, entityId: 'per-1' }) });
    const r = await relatePersonToSfAccount({
      workspaceId: 'ws-1', personEntityId: 'per-1', personEmail: 'x@boydwatterson.com',
      accountId: '001X', accountName: 'Boyd Watterson', deps,
    });
    assert.equal(r.bound, 'none');
    assert.equal(r.reason, 'org_is_person');
    assert.equal(calls.linkPersonToEntity.length, 0);
  });
});
