// R-asset-linking — ensureAssetEntityForProperty helpers + reconcile sweep.
// Pure-function coverage (domain normalization + metadata builders) plus a
// stubbed-deps end-to-end that proves: hollow stub → gold-standard shape,
// fill-blanks (never clobber curated), and idempotence.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.OPS_SUPABASE_URL = 'https://ops.test.local';
process.env.OPS_SUPABASE_KEY = 'service-key';

const mod = await import('../api/_shared/asset-entity.js');
const { ensureAssetEntityForProperty, __test__ } = mod;
const { domainLongForm, buildTenants, buildSalesHistory, buildContacts } = __test__;

describe('domainLongForm', () => {
  it('accepts short + long forms, rejects junk', () => {
    assert.equal(domainLongForm('dia'), 'dialysis');
    assert.equal(domainLongForm('dialysis'), 'dialysis');
    assert.equal(domainLongForm('gov'), 'government');
    assert.equal(domainLongForm('government'), 'government');
    assert.equal(domainLongForm('cre'), null);
  });
});

describe('metadata builders', () => {
  it('buildTenants prefers live-lease tenant, dedups, keeps expiration', () => {
    const t = buildTenants([
      { tenant: 'Fresenius Kidney Care', lease_expiration: '2038-08-31' },
      { tenant: 'fresenius kidney care', lease_expiration: '2030-01-01' },
      { operator: 'DaVita' },
    ]);
    assert.equal(t.length, 2);
    assert.equal(t[0].name, 'Fresenius Kidney Care');
    assert.equal(t[0].lease_expiration, '2038-08-31');
    assert.equal(t[1].name, 'DaVita');
  });

  it('buildSalesHistory never fabricates absent parties', () => {
    const s = buildSalesHistory([{ sale_date: '2026-07-24', sold_price: '15729896.00', is_northmarq: true }]);
    assert.equal(s.length, 1);
    assert.equal(s[0].seller, null);
    assert.equal(s[0].buyer, null);
    assert.equal(s[0].is_northmarq, true);
    assert.equal(s[0].sale_price, '15729896.00');
  });

  it('buildContacts drops nameless rows and echoes company==name', () => {
    const c = buildContacts([
      { contact_name: 'Chris Bodnar', role: 'listing_broker', company: 'CBRE Inc.', contact_email: 'chris.bodnar@cbre.com' },
      { contact_phone: '(000) 000-0000' },
    ]);
    assert.equal(c.length, 1);
    assert.equal(c[0].name, 'Chris Bodnar');
    assert.equal(c[0].company, 'CBRE Inc.');
    assert.equal(c[0].email, 'chris.bodnar@cbre.com');
  });
});

// Stubbed-deps integration: mimics dia property 35724 with a hollow existing
// entity, proves the enrich path corrects the stub name + fills metadata.
describe('ensureAssetEntityForProperty (stubbed deps)', () => {
  function makeDeps() {
    const entity = {
      id: 'e-35724', name: 'Woodland Hills', address: 'Woodland Hills',
      city: 'Woodland Hills', state: 'CA', zip: null, county: null,
      latitude: null, longitude: null, asset_type: null, metadata: {},
    };
    const patches = [];
    const opsQuery = async (method, path, body) => {
      if (method === 'GET' && path.startsWith('entities?')) {
        return { ok: true, data: [entity] };
      }
      if (method === 'PATCH' && path.startsWith('entities?')) {
        patches.push(body);
        Object.assign(entity, body);
        return { ok: true, data: [entity] };
      }
      return { ok: true, data: [] };
    };
    const domainQuery = async (_dom, _m, path) => {
      if (path.startsWith('properties?')) return { ok: true, data: [{
        property_id: 35724, address: '20931 Burbank Blvd, Ste A', city: 'Woodland Hills',
        state: 'CA', zip_code: '91367', county: 'Los Angeles', latitude: 34.17, longitude: -118.58,
        property_type: 'Healthcare',
      }] };
      if (path.startsWith('leases?')) return { ok: true, data: [{ tenant: 'Fresenius Medical Care', lease_expiration: '2038-08-31' }] };
      if (path.startsWith('sales_transactions?')) return { ok: true, data: [{ sale_date: '2026-07-24', sold_price: '15729896.00', is_northmarq: true }] };
      if (path.startsWith('contacts?')) return { ok: true, data: [{ contact_name: 'Chris Bodnar', role: 'listing_broker', company: 'CBRE Inc.' }] };
      return { ok: true, data: [] };
    };
    const ensureEntityLink = async () => ({ ok: true, entity: { id: 'e-35724' }, createdEntity: false, createdIdentity: false });
    return { deps: { opsQuery, domainQuery, ensureEntityLink }, entity, patches };
  }

  it('corrects the stub name to street plus operator and fills metadata', async () => {
    const { deps, entity } = makeDeps();
    const r = await ensureAssetEntityForProperty({ domain: 'dia', propertyId: 35724, deps });
    assert.equal(r.ok, true);
    assert.equal(r.entity_id, 'e-35724');
    assert.equal(r.enriched, true);
    assert.equal(entity.name, '20931 Burbank Blvd, Ste A - Fresenius Medical Care'); // stub name corrected
    assert.equal(entity.address, '20931 Burbank Blvd, Ste A'); // filled from domain
    assert.equal(entity.asset_type, 'Healthcare');
    assert.equal(entity.metadata.tenants[0].name, 'Fresenius Medical Care');
    assert.equal(entity.metadata.sales_history[0].sale_price, '15729896.00');
    assert.equal(entity.metadata.contacts[0].name, 'Chris Bodnar');
    assert.equal(entity.metadata.domain_property_id, 35724);
  });

  it('is idempotent — a second run makes no further patch', async () => {
    const { deps, patches } = makeDeps();
    await ensureAssetEntityForProperty({ domain: 'dia', propertyId: 35724, deps });
    const afterFirst = patches.length;
    await ensureAssetEntityForProperty({ domain: 'dia', propertyId: 35724, deps });
    assert.equal(patches.length, afterFirst); // no new patch on the second pass
  });
});
