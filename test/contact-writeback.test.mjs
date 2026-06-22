// R52 Units 2/3 + R52c — planContactWriteback (guards), planCompanyResolution
// (the org-requires-a-Company resolution), processContactWriteback (establish
// account → mirror → upsert contact → mirror → promote, fully-mocked deps).
// No IO except the upsertSalesforceAccount fake-fetch unit test.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  planContactWriteback,
  planCompanyResolution,
  processContactWriteback,
  isWritebackEnabled,
} from '../api/_handlers/contact-writeback.js';
import { upsertSalesforceAccount } from '../api/_shared/salesforce.js';

describe('planContactWriteback (guards)', () => {
  it('pushes a plausible person with a valid email (no accountId — resolved later)', () => {
    const p = planContactWriteback({ entity_id: 'e1', name: 'Geoff Ficke', email: 'geoff.ficke@colliers.com', phone: '(408) 459-8476', company: 'Colliers', sf_account_id: '001x' });
    assert.equal(p.ok, true);
    assert.equal(p.push.email, 'geoff.ficke@colliers.com');
    // R52c: the account is established by planCompanyResolution, not carried here.
    assert.equal(p.push.accountId, undefined);
    assert.equal(p.push.company, 'Colliers');
  });

  it('skips a generic/role inbox', () => {
    const p = planContactWriteback({ entity_id: 'e1', name: 'Jane Doe', email: 'info@firm.com' });
    assert.equal(p.ok, false);
    assert.equal(p.skip, 'generic_inbox');
  });

  it('skips a broker/firm mistyped as a person (Marcus & Millichap)', () => {
    const p = planContactWriteback({ entity_id: 'e1', name: 'Marcus & Millichap', email: 'af@greysteel.com' });
    assert.equal(p.ok, false);
    assert.equal(p.skip, 'not_plausible_person');
  });

  it('skips a firm-suffixed name', () => {
    const p = planContactWriteback({ entity_id: 'e1', name: 'Crescent Apartments LLC', email: 'srini@gmail.com' });
    assert.equal(p.ok, false);
    assert.equal(p.skip, 'not_plausible_person');
  });

  it('skips when there is no valid email', () => {
    assert.equal(planContactWriteback({ entity_id: 'e1', name: 'Jane Doe', email: 'not-an-email' }).skip, 'no_valid_email');
  });

  it('skips a structurally-junk name', () => {
    const p = planContactWriteback({ entity_id: 'e1', name: 'Seller ContactsCraig Burrows(916) 768-5544 (p)', email: 'a@b.com' });
    assert.equal(p.ok, false);
    assert.equal(p.skip, 'junk_name');
  });
});

describe('planCompanyResolution (R52c — the required Company)', () => {
  const PERSON = { entity_id: 'p1', name: 'Geoff Ficke', company: 'Colliers' };

  it('(a) linked owner org → Company = owner name, mirror onto the owner', () => {
    const r = planCompanyResolution(PERSON, { entity_id: 'owner1', name: 'Next Generation Capital LLC', entity_type: 'organization', sf_account_id: null });
    assert.equal(r.ok, true);
    assert.equal(r.source, 'owner');
    assert.equal(r.companyName, 'Next Generation Capital LLC');
    assert.equal(r.accountId, null);                  // no existing account → upsert by name
    assert.equal(r.mirrorEntityId, 'owner1');
    assert.equal(r.mirrorIsPerson, false);
  });

  it('(a) reuse — owner already SF-mapped → accountId reused, still mirror target the owner', () => {
    const r = planCompanyResolution(PERSON, { entity_id: 'owner1', name: 'NGP', entity_type: 'organization', sf_account_id: '001OWNER' });
    assert.equal(r.accountId, '001OWNER');
    assert.equal(r.mirrorEntityId, 'owner1');
  });

  it('(b) no owner, but a company field → file under the company, no entity to mirror', () => {
    const r = planCompanyResolution(PERSON, null);
    assert.equal(r.source, 'company');
    assert.equal(r.companyName, 'Colliers');
    assert.equal(r.mirrorEntityId, null);
    assert.equal(r.accountId, null);
  });

  it('(c) individual investor (no owner, no company) → Company = person name, mirror onto the person', () => {
    const r = planCompanyResolution({ entity_id: 'p2', name: 'Jane Doe' }, null);
    assert.equal(r.source, 'self');
    assert.equal(r.companyName, 'Jane Doe');
    assert.equal(r.mirrorEntityId, 'p2');
    assert.equal(r.mirrorIsPerson, true);
  });

  it('a junk owner name is not used as the Company (falls through to company, then self)', () => {
    const junkOwner = { entity_id: 'o', name: 'Seller Contacts(916) 768-5544 (p)', entity_type: 'organization' };
    assert.equal(planCompanyResolution(PERSON, junkOwner).source, 'company');           // has company → company
    assert.equal(planCompanyResolution({ entity_id: 'p3', name: 'Jane Doe' }, junkOwner).source, 'self'); // no company → self
  });
});

// Build a deps harness that records what happened. Defaults model an owner-org
// candidate whose owner has NO existing SF Account (so the account is created
// and mirrored), and a contact INSERT.
function harness(overrides = {}) {
  const calls = { resolve: [], account: [], mirrorAccount: [], upsert: [], mirror: [], promote: [] };
  return {
    calls,
    deps: {
      resolveCompany: async (row) => { calls.resolve.push(row); return overrides.resolveCompany ? overrides.resolveCompany(row) : { ok: true, companyName: 'Next Generation Capital LLC', accountId: null, mirrorEntityId: 'owner1', mirrorIsPerson: false, source: 'owner' }; },
      upsertAccount: async (a) => { calls.account.push(a); return overrides.upsertAccount ? overrides.upsertAccount(a) : { ok: true, accountId: '001NEW', created: true }; },
      mirrorAccount: async (entityId, accountId, isPerson) => { calls.mirrorAccount.push({ entityId, accountId, isPerson }); return overrides.mirrorAccount ? overrides.mirrorAccount(entityId, accountId, isPerson) : { ok: true }; },
      upsertContact: async (push) => { calls.upsert.push(push); return overrides.upsert ? overrides.upsert(push) : { ok: true, created: true, contact: { Id: '003ABC', MailingStreet: '5 SF St', MailingCity: 'Reno', MailingState: 'NV', MailingPostalCode: '89501' } }; },
      mirrorIdentity: async (row, sfId) => { calls.mirror.push({ row, sfId }); return overrides.mirror ? overrides.mirror(row, sfId) : { ok: true }; },
      promoteFields: async (entityId, incoming) => { calls.promote.push({ entityId, incoming }); return overrides.promote ? overrides.promote(entityId, incoming) : { ok: true, changed: true, fields: Object.keys(incoming) }; },
    },
  };
}

const ROW = { entity_id: 'e1', name: 'Geoff Ficke', email: 'geoff@colliers.com', workspace_id: 'w1' };

describe('processContactWriteback (R52c)', () => {
  it('owner-org: establish account → mirror onto owner → contact under that AccountId → mirror contact → promote', async () => {
    const h = harness();
    const out = await processContactWriteback(ROW, h.deps);
    assert.equal(out.outcome, 'written');
    assert.equal(out.created, true);
    assert.equal(out.sf_contact_id, '003ABC');
    // Account established + mirrored onto the OWNER entity.
    assert.equal(h.calls.account.length, 1);
    assert.equal(h.calls.mirrorAccount.length, 1);
    assert.equal(h.calls.mirrorAccount[0].entityId, 'owner1');
    assert.equal(out.account_id, '001NEW');
    assert.equal(out.account_created, true);
    assert.equal(out.account_mirrored, true);
    // Contact was upserted UNDER the resolved account.
    assert.equal(h.calls.upsert[0].accountId, '001NEW');
    assert.ok(out.promoted_fields.includes('address'));
  });

  it('individual investor: Company = person name, mirror onto the person', async () => {
    const h = harness({ resolveCompany: () => ({ ok: true, companyName: 'Geoff Ficke', accountId: null, mirrorEntityId: 'e1', mirrorIsPerson: true, source: 'self' }) });
    const out = await processContactWriteback(ROW, h.deps);
    assert.equal(out.outcome, 'written');
    assert.equal(h.calls.account[0].name, 'Geoff Ficke');
    assert.equal(h.calls.mirrorAccount[0].entityId, 'e1');
    assert.equal(h.calls.mirrorAccount[0].isPerson, true);
    assert.equal(out.company_source, 'self');
  });

  it('reuse: owner already SF-mapped → no account upsert, no re-mirror, contact filed under it', async () => {
    const h = harness({ resolveCompany: () => ({ ok: true, companyName: 'NGP', accountId: '001OWNER', mirrorEntityId: 'owner1', mirrorIsPerson: false, source: 'owner' }) });
    const out = await processContactWriteback(ROW, h.deps);
    assert.equal(out.outcome, 'written');
    assert.equal(h.calls.account.length, 0);          // reused, never upserted
    assert.equal(h.calls.mirrorAccount.length, 0);
    assert.equal(out.account_mirrored, null);
    assert.equal(h.calls.upsert[0].accountId, '001OWNER');
  });

  it('account upsert FAILS → contact is NEVER attempted, real reason reported', async () => {
    const h = harness({ upsertAccount: () => ({ ok: false, reason: 'flow_http_error', detail: "Required field missing: Name" }) });
    const out = await processContactWriteback(ROW, h.deps);
    assert.equal(out.outcome, 'unavailable');
    assert.equal(out.stage, 'account');
    assert.equal(out.detail, 'Required field missing: Name');
    assert.equal(h.calls.upsert.length, 0);           // no Contact without a Company
  });

  it('UPDATE path: existing contact (created:false) still mirrors the contact id', async () => {
    const h = harness({ upsert: () => ({ ok: true, created: false, contact: { Id: '003XYZ' } }) });
    const out = await processContactWriteback(ROW, h.deps);
    assert.equal(out.outcome, 'written');
    assert.equal(out.created, false);
    assert.equal(h.calls.mirror.length, 1);
  });

  it('mirror failure keeps the row pending (mirror_failed, not written) but reports the account', async () => {
    const h = harness({ mirror: () => ({ ok: false, detail: 'boom' }) });
    const out = await processContactWriteback(ROW, h.deps);
    assert.equal(out.outcome, 'mirror_failed');
    assert.equal(out.sf_contact_id, '003ABC');
    assert.equal(out.account_id, '001NEW');
    assert.equal(h.calls.promote.length, 0); // never promotes after a failed mirror
  });

  it('account-mirror failure never blocks the contact write (still written, account_mirrored=false)', async () => {
    const h = harness({ mirrorAccount: () => ({ ok: false }) });
    const out = await processContactWriteback(ROW, h.deps);
    assert.equal(out.outcome, 'written');
    assert.equal(out.account_mirrored, false);
    assert.equal(h.calls.upsert[0].accountId, '001NEW');
  });

  it('promotion failure never fails the writeback (still written)', async () => {
    const h = harness({ promote: () => { throw new Error('promote boom'); } });
    const out = await processContactWriteback(ROW, h.deps);
    assert.equal(out.outcome, 'written');
    assert.deepEqual(out.promoted_fields, []);
  });

  it('SF not configured (account step) → not_configured (no contact attempt)', async () => {
    const h = harness({ upsertAccount: () => ({ ok: false, reason: 'sf_not_configured' }) });
    const out = await processContactWriteback(ROW, h.deps);
    assert.equal(out.outcome, 'not_configured');
    assert.equal(h.calls.upsert.length, 0);
  });

  it('account flow not implemented → unsupported', async () => {
    const h = harness({ upsertAccount: () => ({ ok: false, reason: 'unsupported' }) });
    const out = await processContactWriteback(ROW, h.deps);
    assert.equal(out.outcome, 'unsupported');
  });

  it('a guard-skipped row never calls SF (no account, no contact)', async () => {
    const h = harness();
    const out = await processContactWriteback({ entity_id: 'e2', name: 'info', email: 'info@x.com' }, h.deps);
    assert.equal(out.outcome, 'skipped');
    assert.equal(h.calls.account.length, 0);
    assert.equal(h.calls.upsert.length, 0);
  });
});

describe('upsertSalesforceAccount (R52c — fake flow client)', () => {
  function withFakeFlow(fakeJson, fn, { ok = true, status = 200 } = {}) {
    const prevUrl = process.env.SF_LOOKUP_WEBHOOK_URL;
    const prevFetch = globalThis.fetch;
    process.env.SF_LOOKUP_WEBHOOK_URL = 'https://example.test/flow?sig=x';
    globalThis.fetch = async () => ({ ok, status, text: async () => JSON.stringify(fakeJson) });
    return Promise.resolve(fn()).finally(() => {
      globalThis.fetch = prevFetch;
      if (prevUrl === undefined) delete process.env.SF_LOOKUP_WEBHOOK_URL; else process.env.SF_LOOKUP_WEBHOOK_URL = prevUrl;
    });
  }

  it('existing account → returns the id, created:false', async () => {
    await withFakeFlow({ ok: true, created: false, account: { Id: '001EXIST', Name: 'NGP' } }, async () => {
      const r = await upsertSalesforceAccount({ name: 'NGP' });
      assert.equal(r.ok, true);
      assert.equal(r.accountId, '001EXIST');
      assert.equal(r.created, false);
    });
  });

  it('new account → create path, created:true', async () => {
    await withFakeFlow({ ok: true, created: true, account: { Id: '001CREATE', Name: 'Next Generation Capital LLC' } }, async () => {
      const r = await upsertSalesforceAccount({ name: 'Next Generation Capital LLC', idempotencyKey: 'owner1' });
      assert.equal(r.ok, true);
      assert.equal(r.accountId, '001CREATE');
      assert.equal(r.created, true);
    });
  });

  it('empty / whitespace name → no_name (no flow call)', async () => {
    let called = false;
    const prevUrl = process.env.SF_LOOKUP_WEBHOOK_URL;
    const prevFetch = globalThis.fetch;
    process.env.SF_LOOKUP_WEBHOOK_URL = 'https://example.test/flow';
    globalThis.fetch = async () => { called = true; return { ok: true, status: 200, text: async () => '{}' }; };
    try {
      const r = await upsertSalesforceAccount({ name: '   ' });
      assert.equal(r.ok, false);
      assert.equal(r.reason, 'no_name');
      assert.equal(called, false);
    } finally {
      globalThis.fetch = prevFetch;
      if (prevUrl === undefined) delete process.env.SF_LOOKUP_WEBHOOK_URL; else process.env.SF_LOOKUP_WEBHOOK_URL = prevUrl;
    }
  });

  it('not configured → sf_not_configured', async () => {
    const prevUrl = process.env.SF_LOOKUP_WEBHOOK_URL;
    delete process.env.SF_LOOKUP_WEBHOOK_URL;
    try {
      const r = await upsertSalesforceAccount({ name: 'NGP' });
      assert.equal(r.ok, false);
      assert.equal(r.reason, 'sf_not_configured');
    } finally {
      if (prevUrl !== undefined) process.env.SF_LOOKUP_WEBHOOK_URL = prevUrl;
    }
  });

  it('object-shaped flow error never throws (R52b coercion) → ok:false + string detail', async () => {
    await withFakeFlow({ error: { code: 'REQUIRED_FIELD_MISSING', message: 'Required fields are missing: [Name]' } }, async () => {
      const r = await upsertSalesforceAccount({ name: 'NGP' });
      assert.equal(r.ok, false);
      assert.equal(typeof r.detail, 'string');
      assert.match(r.detail, /Required fields are missing/);
    }, { ok: false, status: 400 });
  });
});

describe('isWritebackEnabled', () => {
  it('defaults OFF (gated)', () => {
    const prev = process.env.SF_CONTACT_WRITEBACK;
    delete process.env.SF_CONTACT_WRITEBACK;
    assert.equal(isWritebackEnabled(), false);
    process.env.SF_CONTACT_WRITEBACK = 'on';
    assert.equal(isWritebackEnabled(), true);
    if (prev === undefined) delete process.env.SF_CONTACT_WRITEBACK; else process.env.SF_CONTACT_WRITEBACK = prev;
  });
});
