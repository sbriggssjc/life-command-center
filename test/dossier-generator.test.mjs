// Unit tests for the grounded dossier generator's no-fabrication contract.
// Pure functions only — no DB / network. Run: node --test test/dossier-generator.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateDossier, __test__ } from '../api/_shared/dossier-generator.js';

const { renderTag, sanitizeAnalysisFragment, NA } = __test__;

test('absent field renders exactly "Not on file"', () => {
  assert.equal(renderTag(undefined), NA);
  assert.equal(renderTag(null), NA);
  assert.equal(renderTag({ v: null }), NA);
  assert.match(NA, /Not on file/);
});

test('tagged value carries provenance chip', () => {
  const html = renderTag({ v: 181959, source: 'lease (documented)', as_of: '2018-06-06', confidence: 1 });
  assert.match(html, /181959/);
  assert.match(html, /source: lease \(documented\)/);
  assert.match(html, /as-of 2018-06-06/);
});

test('derived value is labeled Derived with inputs', () => {
  const html = renderTag({ v: '5.78%', derived: 'rent $181,959 ÷ sale $3,150,000' });
  assert.match(html, /Derived:/);
  assert.match(html, /181,959/);
});

test('conflict is surfaced, not silently resolved', () => {
  const html = renderTag({ reconciled: 13, conflict: 'stations 171 vs 13' });
  assert.match(html, /Conflict:/);
  assert.match(html, /171 vs 13/);
});

test('analysis fragment sanitizer strips non-<li> tags and scripts', () => {
  const raw = '<li>Derived: cap 5.78%</li><script>alert(1)</script><li>Second <b>point</b></li>';
  const frag = sanitizeAnalysisFragment(raw);
  assert.ok(!/script/i.test(frag));
  assert.ok(!/<b>/i.test(frag));
  assert.match(frag, /Derived: cap 5.78%/);
  assert.match(frag, /Second point/);
});

test('analysis sanitizer returns null when no list items', () => {
  assert.equal(sanitizeAnalysisFragment('just prose, no items'), null);
  assert.equal(sanitizeAnalysisFragment(''), null);
});

test('generateDossier renders facts from packet and omits missing (LLM unavailable → no analysis, still valid)', async () => {
  // No OLLAMA_URL / OPENAI_API_KEY in the test env → invokeExtractionAI fails →
  // analysis is omitted but the fact dossier still renders.
  const packet = {
    meta: { title: '5247 Airways Blvd, Memphis, TN', subtitle: 'Shelby County · Dialysis', domain_label: 'Dialysis', footer_ids: 'property 23654 · CCN 442740' },
    identity: {
      property_type: { v: 'single-tenant medical', source: 'properties' },
      building_sf: { v: 6308, source: 'properties' },
      year_built: { v: 2016, source: 'properties' },
      // land_acres OMITTED → must render "Not on file"
      price_per_sf: { v: 497, derived: 'value 3137221 ÷ 6308 SF' },
    },
    ownership: {
      owner_of_record: { v: 'Kingsbarn Realty', source: 'reconciled property owner', confidence: 'recorded deed owner' },
      operator_tenant: { v: 'DaVita', source: 'operator (not the owner)' },
    },
    tenancy_lease: {
      tenant: { v: 'DaVita Dialysis', source: 'leases' },
      annual_base_rent: { v: 181959, source: 'lease (documented)', as_of: '2018-06-06' },
    },
    operations: {
      stations: { v: 13, source: 'CMS (medicare_clinics)' },
      _conflicts: [{ field: 'stations', values: [{ v: 13, source: 'CMS' }, { v: 171, source: 'properties denorm' }], reconciled: 13 }],
    },
    valuation: { model_estimate: { v: 3137221, source: 'LCC valuation model', confidence: 'low' } },
    transactions: [{ date: '2018-06-01', grantor: 'DaVita HealthCare Partners', grantee: 'Kingsbarn Realty', price: 3150000, source: 'deed' }],
    documents: [],
  };
  const out = await generateDossier({ kind: 'property', packet, entityId: 'test-entity' });
  assert.match(out.html, /<!doctype html>/i);
  assert.match(out.html, /Kingsbarn Realty/);
  assert.match(out.html, /the operator, not the owner/);      // owner ≠ operator
  assert.match(out.html, /Not on file/);                       // land_acres omitted
  assert.match(out.html, /Conflict/);                          // stations conflict surfaced
  assert.match(out.html, /Derived: value 3137221/);            // price/SF labeled derived
  assert.match(out.html, /must be verified against source documents/); // footer
  assert.ok(typeof out.source_hash === 'string' && out.source_hash.length === 64);
  assert.equal(out.analysis.ok, false); // no LLM configured in test → analysis omitted, dossier still valid
});

test('source_hash is stable across generated_date changes (true staleness key)', async () => {
  const base = { meta: { title: 'X' }, identity: { year_built: { v: 2016 } }, transactions: [], documents: [] };
  const a = await generateDossier({ kind: 'property', packet: { ...base, meta: { ...base.meta, generated_date: '2026-01-01' } }, entityId: 'e' });
  const b = await generateDossier({ kind: 'property', packet: { ...base, meta: { ...base.meta, generated_date: '2026-12-31' } }, entityId: 'e' });
  assert.equal(a.source_hash, b.source_hash);
});
