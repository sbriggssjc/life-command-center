// R52 Units 2/3 — planContactWriteback (guards) + processContactWriteback
// (upsert → mirror → promote, fully-mocked deps). No IO.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  planContactWriteback,
  processContactWriteback,
  isWritebackEnabled,
} from '../api/_handlers/contact-writeback.js';

describe('planContactWriteback (guards)', () => {
  it('pushes a plausible person with a valid email', () => {
    const p = planContactWriteback({ entity_id: 'e1', name: 'Geoff Ficke', email: 'geoff.ficke@colliers.com', phone: '(408) 459-8476', company: 'Colliers', sf_account_id: '001x' });
    assert.equal(p.ok, true);
    assert.equal(p.push.email, 'geoff.ficke@colliers.com');
    assert.equal(p.push.accountId, '001x');
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

// Build a deps harness that records what happened.
function harness(overrides = {}) {
  const calls = { upsert: [], mirror: [], promote: [] };
  return {
    calls,
    deps: {
      upsertContact: async (push) => { calls.upsert.push(push); return overrides.upsert ? overrides.upsert(push) : { ok: true, created: true, contact: { Id: '003ABC', MailingStreet: '5 SF St', MailingCity: 'Reno', MailingState: 'NV', MailingPostalCode: '89501' } }; },
      mirrorIdentity: async (row, sfId) => { calls.mirror.push({ row, sfId }); return overrides.mirror ? overrides.mirror(row, sfId) : { ok: true }; },
      promoteFields: async (entityId, incoming) => { calls.promote.push({ entityId, incoming }); return overrides.promote ? overrides.promote(entityId, incoming) : { ok: true, changed: true, fields: Object.keys(incoming) }; },
    },
  };
}

const ROW = { entity_id: 'e1', name: 'Geoff Ficke', email: 'geoff@colliers.com', workspace_id: 'w1' };

describe('processContactWriteback', () => {
  it('INSERT path: upsert created → mirror → promote address (written/created)', async () => {
    const h = harness();
    const out = await processContactWriteback(ROW, h.deps);
    assert.equal(out.outcome, 'written');
    assert.equal(out.created, true);
    assert.equal(out.sf_contact_id, '003ABC');
    assert.equal(h.calls.mirror.length, 1);
    assert.ok(out.promoted_fields.includes('address'));
  });

  it('UPDATE path: upsert created:false → written, not created', async () => {
    const h = harness({ upsert: () => ({ ok: true, created: false, contact: { Id: '003XYZ' } }) });
    const out = await processContactWriteback(ROW, h.deps);
    assert.equal(out.outcome, 'written');
    assert.equal(out.created, false);
  });

  it('mirror failure keeps the row pending (mirror_failed, not written)', async () => {
    const h = harness({ mirror: () => ({ ok: false, detail: 'boom' }) });
    const out = await processContactWriteback(ROW, h.deps);
    assert.equal(out.outcome, 'mirror_failed');
    assert.equal(out.sf_contact_id, '003ABC');
    assert.equal(h.calls.promote.length, 0); // never promotes after a failed mirror
  });

  it('promotion failure never fails the writeback (still written)', async () => {
    const h = harness({ promote: () => { throw new Error('promote boom'); } });
    const out = await processContactWriteback(ROW, h.deps);
    assert.equal(out.outcome, 'written');
    assert.deepEqual(out.promoted_fields, []);
  });

  it('SF not configured → not_configured (no mirror)', async () => {
    const h = harness({ upsert: () => ({ ok: false, reason: 'sf_not_configured' }) });
    const out = await processContactWriteback(ROW, h.deps);
    assert.equal(out.outcome, 'not_configured');
    assert.equal(h.calls.mirror.length, 0);
  });

  it('flow not implemented → unsupported', async () => {
    const h = harness({ upsert: () => ({ ok: false, reason: 'unsupported' }) });
    const out = await processContactWriteback(ROW, h.deps);
    assert.equal(out.outcome, 'unsupported');
  });

  it('a guard-skipped row never calls SF', async () => {
    const h = harness();
    const out = await processContactWriteback({ entity_id: 'e2', name: 'info', email: 'info@x.com' }, h.deps);
    assert.equal(out.outcome, 'skipped');
    assert.equal(h.calls.upsert.length, 0);
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
