// GOV-CLASSIFY1 (2026-09-23) — sidebar saves of government properties that are
// ALREADY in the gov DB failed "no_domain" (Scott, 2 screenshots).
//
//   Jellico TN  — 601 5th St, LCC d0210db5…, gov 16334 (Tennessee DHS, State).
//                 Saved from the Contacts tab: no tenant. Only evidence on the
//                 page: three OM links titled "OM_State of TN DHS - Jellico, TN".
//   Tulelake CA — 49870 State Highway 139, LCC e2a7ab46…, gov 16268
//                 ("49870 Ca-139", US Government). Tenant "Us Ranger Station".
//
// Four fixes, each pinned here: existing-record-first; numbered-route spelling
// equivalence; ranger-station / state-DHS patterns; offering-document titles.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  classifyDomain,
  classifierDocumentTitles,
  addressesIdentityEquivalent,
  findExistingDomainPropertiesForCapture,
  resolveDomainsWithExistingRecords,
} from '../api/_handlers/sidebar-pipeline.js';
import { parseRouteStreet, routeStreetsEquivalent } from '../api/_shared/route-address-equivalence.js';

// The two live captures, reduced to the fields the classifier reads.
const JELLICO = {
  entity: { id: 'd0210db5-506e-4b6f-bc30-763056d93ee6', name: '601 5th St', address: '601 5th St', city: 'Jellico', state: 'TN', asset_type: 'Office' },
  metadata: {
    tenants: [],
    contacts: [{ name: 'John C Davenport' }, { name: 'Geoff Ficke' }],
    property_subtype: 'Office',
    document_links: [
      { url: 'https://example.invalid/a.pdf', type: 'om', label: 'OM_State of TN DHS - Jellico, TN' },
      { url: 'https://example.invalid/b.pdf', type: 'om', label: 'OM_State of TN DHS - Jellico, TN' },
    ],
  },
};
const TULELAKE = {
  entity: { id: 'e2a7ab46-6a80-46c4-a4e8-0149f269f186', name: '49870 State Highway 139, Tulelake, CA 96134', address: '49870 State Highway 139, Tulelake, CA 96134', city: 'Tulelake', state: 'CA', asset_type: 'Office' },
  metadata: {
    tenant_name: 'Us Ranger Station',
    tenants: [{ name: 'Us Ranger Station', sf: '5,312 SF' }, { name: 'Agriculture, Forestry, Fishing and Hunting', sf: '5,312 SF' }],
    document_links: [],
  },
};

// A stub domain DB: rows per domain, filtered the way PostgREST would
// (state eq, address ilike '<civic>*', city ilike).
function stubDomainDb(rowsByDomain) {
  const calls = [];
  const domainQuery = async (domain, method, path) => {
    calls.push({ domain, path });
    const u = new URLSearchParams(path.split('?')[1]);
    const state = (u.get('state') || '').replace(/^eq\./, '');
    const prefix = (u.get('address') || '').replace(/^ilike\./, '').replace(/\*$/, '');
    const city = (u.get('city') || '').replace(/^ilike\./, '');
    const data = (rowsByDomain[domain] || []).filter((r) =>
      r.state === state && String(r.address).toLowerCase().startsWith(prefix.toLowerCase()) &&
      (!city || String(r.city).toLowerCase() === city.toLowerCase()));
    return { ok: true, data };
  };
  return { domainQuery, getDomainCredentials: () => ({ url: 'x', key: 'y' }), calls };
}

const GOV_ROWS = {
  government: [
    { property_id: 16334, address: '601 5th St', city: 'Jellico', state: 'TN' },
    { property_id: 16268, address: '49870 Ca-139', city: 'Tulelake', state: 'CA' },
  ],
  dialysis: [],
};

describe('GOV-CLASSIFY1 — numbered-route equivalence', () => {
  const STATE_FORMS = ['CA-139', 'Ca 139', 'State Highway 139', 'State Hwy 139', 'SR-139', 'SR 139', 'Hwy 139', 'Highway 139', 'State Route 139', 'CA Hwy 139'];
  for (const a of STATE_FORMS) {
    for (const b of STATE_FORMS) {
      it(`"${a}" == "${b}" (CA)`, () => assert.equal(routeStreetsEquivalent(a, b, 'CA'), true));
    }
  }
  it('US-route forms (Malta MT twins)', () => {
    for (const b of ['US Highway 2', 'US Hwy 2', 'U.S. 2', 'US 2', 'US Route 2', 'Hwy 2']) {
      assert.equal(routeStreetsEquivalent('US-2', b, 'MT'), true, b);
    }
  });
  it('a different number or system is NOT the same road', () => {
    assert.equal(routeStreetsEquivalent('Ca-139', 'Ca-138', 'CA'), false);
    assert.equal(routeStreetsEquivalent('US-2', 'MT-2', 'MT'), false);
    assert.equal(routeStreetsEquivalent('US-2 W', 'US-2 E', 'MT'), false);
  });
  it('a 2-letter prefix counts as a state route only for the capture\'s own state', () => {
    assert.equal(parseRouteStreet('TX-139', 'CA'), null);
    assert.equal(parseRouteStreet('CA-139', 'CA')?.kind, 'state');
  });
  it('ordinals and ordinary streets are not routes', () => {
    assert.equal(parseRouteStreet('NE 139th St', 'NE'), null);
    assert.equal(parseRouteStreet('5th St', 'TN'), null);
    assert.equal(routeStreetsEquivalent('5th St', '5th Street', 'TN'), null);
  });
});

describe('GOV-CLASSIFY1 — addressesIdentityEquivalent', () => {
  it('Tulelake: captured "State Highway 139, Tulelake, CA 96134" == gov "49870 Ca-139"', () => {
    assert.equal(addressesIdentityEquivalent('49870 State Highway 139, Tulelake, CA 96134', '49870 Ca-139', 'CA'), true);
  });
  it('Jellico: suffix spelling folds', () => {
    assert.equal(addressesIdentityEquivalent('601 5th Street', '601 5th St', 'TN'), true);
  });
  it('SIDEBAR3-c directional folding is reused', () => {
    assert.equal(addressesIdentityEquivalent('920 S Washington Ave', '920 South Washington Ave', 'PA'), true);
  });
  it('civic number must match exactly (GOV-AVAIL1: 6120 vs 5110)', () => {
    assert.equal(addressesIdentityEquivalent('6120 South Yale Ave', '5110 South Yale Ave', 'OK'), false);
    assert.equal(addressesIdentityEquivalent('49871 State Highway 139', '49870 Ca-139', 'CA'), false);
    assert.equal(addressesIdentityEquivalent('4550-4666 S Kirkman Rd', '4600 S Kirkman Rd', 'FL'), false);
  });
  it('different street at the same civic number is not a match', () => {
    assert.equal(addressesIdentityEquivalent('601 6th St', '601 5th St', 'TN'), false);
  });
});

describe('GOV-CLASSIFY1 — existing-record lookup', () => {
  it('Tulelake resolves to gov 16268 despite the spelling', async () => {
    const db = stubDomainDb(GOV_ROWS);
    const out = await findExistingDomainPropertiesForCapture(TULELAKE.entity, TULELAKE.metadata, db);
    assert.deepEqual(out.matches.map((m) => [m.domain, m.property_id]), [['government', 16268]]);
  });
  it('Jellico resolves to gov 16334', async () => {
    const db = stubDomainDb(GOV_ROWS);
    const out = await findExistingDomainPropertiesForCapture(JELLICO.entity, JELLICO.metadata, db);
    assert.deepEqual(out.matches.map((m) => [m.domain, m.property_id]), [['government', 16334]]);
  });
  it('two equivalent candidates are ambiguous, never a match', async () => {
    const db = stubDomainDb({
      government: [
        { property_id: 1, address: '49870 Ca-139', city: 'Tulelake', state: 'CA' },
        { property_id: 2, address: '49870 State Hwy 139', city: 'Tulelake', state: 'CA' },
      ],
    });
    const out = await findExistingDomainPropertiesForCapture(TULELAKE.entity, TULELAKE.metadata, db);
    assert.equal(out.matches.length, 0);
    assert.deepEqual(out.ambiguous[0].property_ids, [1, 2]);
  });
  it('a query error is no evidence (fails open)', async () => {
    const out = await findExistingDomainPropertiesForCapture(TULELAKE.entity, TULELAKE.metadata, {
      domainQuery: async () => { throw new Error('boom'); },
      getDomainCredentials: () => ({}),
    });
    assert.equal(out.matches.length, 0);
  });
});

describe('GOV-CLASSIFY1 — existing record wins over patterns, both directions', () => {
  it('existing gov record beats a dialysis pattern hit', () => {
    const r = resolveDomainsWithExistingRecords('dialysis', ['dialysis'], { matches: [{ domain: 'government', property_id: 16334 }] });
    assert.equal(r.primary, 'government');
    assert.deepEqual(r.all, ['government']);
    assert.equal(r.source, 'existing_record');
  });
  it('existing dia record beats a government pattern hit', () => {
    const r = resolveDomainsWithExistingRecords('government', ['government'], { matches: [{ domain: 'dialysis', property_id: 24703 }] });
    assert.equal(r.primary, 'dialysis');
    assert.deepEqual(r.all, ['dialysis']);
  });
  it('a building in both DBs keeps both, pattern pick as primary', () => {
    const r = resolveDomainsWithExistingRecords('government', ['government'], {
      matches: [{ domain: 'dialysis', property_id: 1 }, { domain: 'government', property_id: 2 }],
    });
    assert.equal(r.primary, 'government');
    assert.deepEqual(r.all, ['government', 'dialysis']);
  });
  it('no existing record leaves the pattern result unchanged', () => {
    const r = resolveDomainsWithExistingRecords('dialysis', ['dialysis', 'government'], { matches: [] });
    assert.deepEqual([r.primary, r.all, r.source], ['dialysis', ['dialysis', 'government'], 'pattern']);
  });
});

describe('GOV-CLASSIFY1 — pattern gaps (no DB needed)', () => {
  it('Tulelake: "Us Ranger Station" classifies government', () => {
    assert.equal(classifyDomain(TULELAKE.metadata, TULELAKE.entity), 'government');
  });
  it('Jellico: the OM title classifies government', () => {
    assert.equal(classifyDomain(JELLICO.metadata, JELLICO.entity), 'government');
  });
  for (const t of ['U.S. National Archives & Records Administration', 'Ranger District Office', 'Bureau of Land Management', 'BLM Field Office', 'USFWS', 'National Wildlife Refuge', 'Tennessee DHS', 'TN DHS']) {
    it(`"${t}" classifies government`, () => {
      assert.equal(classifyDomain({ tenant_name: t }, {}), 'government');
    });
  }
  for (const t of ['Ranger Construction', 'Texas Rangers Team Store', 'DHS Dental', 'Office']) {
    it(`"${t}" does NOT classify government`, () => {
      assert.equal(classifyDomain({ tenant_name: t }, {}), null);
    });
  }
});

describe('GOV-CLASSIFY1 — offering document titles', () => {
  it('OM titles are read, deduped', () => {
    assert.deepEqual(classifierDocumentTitles(JELLICO.metadata), ['OM_State of TN DHS - Jellico, TN']);
  });
  it('a non-offering document title is NOT evidence', () => {
    const md = { document_links: [{ type: 'site_plan', label: 'City of Austin zoning map' }] };
    assert.deepEqual(classifierDocumentTitles(md), []);
    assert.equal(classifyDomain(md, {}), null);
  });
  it('an untyped document counts when its title says it is an offering', () => {
    assert.deepEqual(classifierDocumentTitles({ documents: [{ title: 'Offering Memorandum - VA Clinic' }] }), ['Offering Memorandum - VA Clinic']);
  });
});

describe('GOV-CLASSIFY1 — pipeline wiring (source shape)', () => {
  const src = readFileSync(new URL('../api/_handlers/sidebar-pipeline.js', import.meta.url), 'utf8')
    .replace(/\/\/[^\n]*/g, '');
  it('the pipeline runs the existing-record lookup before classifying', () => {
    assert.match(src, /const existingRecords = await findExistingDomainPropertiesForCapture\(entity, metadata\)[\s\S]{0,200}classifyAndUpdateDomain\(entity, metadata, workspaceId, \{ existing: existingRecords \}\)/);
  });
  it('the domain set comes from resolveDomainsWithExistingRecords', () => {
    assert.match(src, /const allDomains = resolveDomainsWithExistingRecords\(\s*domain, classifyAllApplicableDomains\(metadata, entity\), existingRecords,\s*\)\.all;/);
  });
  it('an equivalence attach never PATCHes the stored address', () => {
    assert.match(src, /if \(attachedViaMergeLedger \|\| attachedViaEquivalence\) \{\s*delete propertyData\.address;/);
  });
});
