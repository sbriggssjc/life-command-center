// R26 Unit 2 — county recorder/assessor portal resolver tests.
import test from 'node:test';
import assert from 'node:assert';
import {
  bareCounty,
  pickPortal,
  portalLabel,
  resolvePortalsForProperties,
  resolvePortalForProperty,
} from '../api/_shared/county-portal-resolver.js';

test('bareCounty strips administrative suffixes', () => {
  assert.equal(bareCounty('Los Angeles County'), 'Los Angeles');
  assert.equal(bareCounty('Orleans Parish'), 'Orleans');
  assert.equal(bareCounty('Maricopa'), 'Maricopa');
  assert.equal(bareCounty('  Santa Clara  County '), 'Santa Clara');
  assert.equal(bareCounty(null), '');
});

test('pickPortal prefers recorder, then assessor, then netronline', () => {
  assert.deepEqual(
    pickPortal({ recorder_url: 'https://rec', assessor_url: 'https://ass', netronline_url: 'https://net' }),
    { url: 'https://rec', kind: 'recorder' });
  assert.deepEqual(
    pickPortal({ recorder_url: null, assessor_url: 'https://ass', netronline_url: 'https://net' }),
    { url: 'https://ass', kind: 'assessor' });
  assert.deepEqual(
    pickPortal({ recorder_url: '', assessor_url: '   ', netronline_url: 'https://net' }),
    { url: 'https://net', kind: 'records' });
});

test('pickPortal rejects non-http / empty rows', () => {
  assert.equal(pickPortal(null), null);
  assert.equal(pickPortal({ recorder_url: 'javascript:alert(1)' }), null);
  assert.equal(pickPortal({ recorder_url: 'not a url', assessor_url: '' }), null);
});

test('portalLabel formats per kind', () => {
  assert.equal(portalLabel('recorder', 'Maricopa'), 'Maricopa Recorder');
  assert.equal(portalLabel('assessor', 'Los Angeles County'), 'Los Angeles Assessor');
  assert.equal(portalLabel('records', 'Orleans'), 'Orleans records');
});

// --- batch resolution against a fake domainQuery ---
function fakeDeps(propRows, authRows) {
  return {
    domainQuery: async (_domain, _method, path) => {
      if (path.startsWith('properties')) return { ok: true, status: 200, data: propRows };
      if (path.startsWith('county_authorities')) return { ok: true, status: 200, data: authRows };
      return { ok: false, status: 404, data: null };
    },
  };
}

test('resolvePortalsForProperties matches county+state and returns the portal', async () => {
  const deps = fakeDeps(
    [{ property_id: 101, county: 'Maricopa', state: 'AZ' },
     { property_id: 102, county: 'Los Angeles', state: 'CA' }],
    [{ county_name: 'Maricopa', state_code: 'AZ', recorder_url: 'https://recorder.maricopa.gov', assessor_url: null, netronline_url: 'https://net/az' },
     { county_name: 'Los Angeles', state_code: 'CA', recorder_url: null, assessor_url: 'https://assessor.lacounty.gov', netronline_url: 'https://net/ca' }]);
  const map = await resolvePortalsForProperties('gov', [101, 102], deps);
  assert.equal(map.get('101').portal_url, 'https://recorder.maricopa.gov');
  assert.equal(map.get('101').portal_label, 'Maricopa Recorder');
  assert.equal(map.get('102').portal_url, 'https://assessor.lacounty.gov');
  assert.equal(map.get('102').portal_label, 'Los Angeles Assessor');
});

test('resolve is case/whitespace/suffix-insensitive on the join', async () => {
  const deps = fakeDeps(
    [{ property_id: 5, county: 'los angeles county', state: 'ca' }],
    [{ county_name: 'Los Angeles', state_code: 'CA', recorder_url: 'https://rec' }]);
  const out = await resolvePortalForProperty('gov', 5, deps);
  assert.equal(out.portal_url, 'https://rec');
  assert.equal(out.county, 'Los Angeles');
});

test('no county on the property → no link (absent from map)', async () => {
  const deps = fakeDeps([], []); // county=not.is.null filter excludes it server-side
  const map = await resolvePortalsForProperties('gov', [9], deps);
  assert.equal(map.size, 0);
});

test('county with no authority row → no link', async () => {
  const deps = fakeDeps(
    [{ property_id: 7, county: 'Nowhere', state: 'ZZ' }],
    []);
  const out = await resolvePortalForProperty('gov', 7, deps);
  assert.equal(out, null);
});

test('non-gov domain resolves nothing', async () => {
  const deps = fakeDeps(
    [{ property_id: 1, county: 'Cook', state: 'IL' }],
    [{ county_name: 'Cook', state_code: 'IL', recorder_url: 'https://rec' }]);
  const map = await resolvePortalsForProperties('dia', [1], deps);
  assert.equal(map.size, 0);
});

test('empty / missing deps never throw', async () => {
  assert.equal((await resolvePortalsForProperties('gov', [], { domainQuery: async () => ({}) })).size, 0);
  assert.equal((await resolvePortalsForProperties('gov', [1], {})).size, 0);
});
