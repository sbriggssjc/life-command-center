import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ASC_RESEARCH_SAMPLE_SIZE,
  assertAscResearchImport,
  buildAscStructuredCapture,
  normalizeAscAddressToken,
} from '../api/_shared/asc-research-lane.js';

const sha = (digit) => digit.repeat(64);

function candidates(count = ASC_RESEARCH_SAMPLE_SIZE) {
  return Array.from({ length: count }, (_, index) => ({
    candidate_fingerprint: index.toString(16).padStart(64, '0'),
    sampling_cell: index % 2 ? 'south__single_site' : 'midwest__single_site',
    cms_identity: {
      ccn: String(100000 + index),
      npis: [String(9000000000 + index)],
      facility_name: `Synthetic ASC ${index}`,
      address: `${index + 1} Main Street Suite ${index}`,
      city: 'Tulsa',
      state: 'OK',
      zip: '74103',
    },
    cms_evidence: { pos_certified: true },
  }));
}

test('frozen ASC import requires exactly 50 unique release-bound candidates', () => {
  const input = {
    release_id: sha('a'),
    selection_fingerprint: sha('b'),
    candidate_pool_fingerprint: sha('c'),
    candidates: candidates(),
  };
  const normalized = assertAscResearchImport(input);
  assert.equal(normalized.length, 50);
  assert.equal(normalized[0].sample_ordinal, 1);
  assert.equal(normalized[49].sample_ordinal, 50);
  assert.match(normalized[0].address_token, /^1 MAIN ST\|TULSA\|OK\|74103$/);
  assert.throws(() => assertAscResearchImport({ ...input, candidates: candidates(49) }), /exactly 50/);
  const duplicate = candidates(); duplicate[49].candidate_fingerprint = duplicate[0].candidate_fingerprint;
  assert.throws(() => assertAscResearchImport({ ...input, candidates: duplicate }), /duplicates/);
});

test('sidebar evidence capture is structured-only and bound to the exact active address', () => {
  const target = {
    candidate_fingerprint: sha('d'),
    address_token: normalizeAscAddressToken({ address: '1200 South Main St.', city: 'Tulsa', state: 'OK', zip: '74119' }),
  };
  const context = {
    source: 'costar',
    page_url: 'https://example.costar.com/property/123',
    address: '1200 S Main Street, Suite 400',
    city: 'Tulsa', state: 'OK', zip: '74119-1234',
    square_footage: '18,500',
    year_built: '2018',
    tenant_name: 'Synthetic Surgery Center',
    contacts: [{ name: 'Synthetic Owner Contact' }],
    raw_html: '<html>must never be captured</html>',
    cookies: 'must never be captured',
  };
  const built = buildAscStructuredCapture(target, context);
  assert.equal(built.capture.source, 'costar');
  assert.equal(built.capture.structured_payload.square_footage, '18,500');
  assert.equal(Object.hasOwn(built.capture.structured_payload, 'raw_html'), false);
  assert.equal(Object.hasOwn(built.capture.structured_payload, 'cookies'), false);
  assert.ok(built.evidence.some((row) => row.field_name === 'tenant_name'));
  assert.throws(() => buildAscStructuredCapture(target, { ...context, address: '999 Other Road' }), /does not match/);
});

test('CoStar full display addresses bind to the same frozen street-only target', () => {
  const target = {
    candidate_fingerprint: sha('e'),
    address_token: normalizeAscAddressToken({
      address: '1101 Professional Blvd', city: 'Evansville', state: 'IN', zip: '47714',
    }),
  };
  const context = {
    source: 'costar',
    page_url: 'https://product.costar.com/detail/lookup/858677/summary',
    address: '1101 Professional Blvd, Evansville, IN 47714',
    city: 'Evansville', state: 'IN', zip: '47714',
    square_footage: '24,072',
  };
  const built = buildAscStructuredCapture(target, context);
  assert.equal(built.capture.address_token, target.address_token);
  assert.equal(built.capture.structured_payload.square_footage, '24,072');
});

test('multi-token CMS suite suffixes bind to building-level research pages', () => {
  const cmsToken = normalizeAscAddressToken({
    address: '302 W 14TH ST STE 100 B',
    city: 'JEFFERSONVILLE',
    state: 'IN',
    zip: '47130',
  });
  const costarToken = normalizeAscAddressToken({
    address: '302 W 14th St',
    city: 'Jeffersonville',
    state: 'IN',
    zip: '47130',
  });
  assert.equal(cmsToken, '302 W 14TH ST|JEFFERSONVILLE|IN|47130');
  assert.equal(cmsToken, costarToken);
});

test('Circle and Cir normalize to the same exact frozen building address', () => {
  const target = {
    candidate_fingerprint: sha('6'),
    // This literal reproduces a row frozen before CIRCLE/CIR normalization
    // existed. Runtime comparison must not require rewriting it.
    address_token: '1120 RAINTREE CIRCLE|ALLEN|TX|75013',
    cms_identity: {
      facility_name: 'Texas Health Spine Surgery Center Allen LLC',
      address: '1120 Raintree Circle Suite 100', city: 'Allen', state: 'TX', zip: '75013',
    },
  };
  const context = {
    source: 'costar',
    page_url: 'https://example.costar.com/property/allen-medical-plaza',
    address: '1120 Raintree Cir', city: 'Allen', state: 'TX', zip: '75013',
    square_footage: '44,761',
    tenants: [{ name: 'Texas Health Spine Surgery Center', occupied_sf: '15,718' }],
  };

  assert.equal(normalizeAscAddressToken(target.cms_identity), '1120 RAINTREE CIR|ALLEN|TX|75013');
  const built = buildAscStructuredCapture(target, context);
  assert.equal(built.capture.address_token, '1120 RAINTREE CIRCLE|ALLEN|TX|75013');
  assert.equal(built.capture.address, context.address);
  assert.equal(built.identity_match.mode, 'normalized_frozen_identity_address');
  assert.equal(built.identity_match.frozen_address_token_preserved, target.address_token);
  assert.equal(built.identity_match.normalized_comparison_token, '1120 RAINTREE CIR|ALLEN|TX|75013');

  for (const mismatch of [
    { address: '1122 Raintree Cir' },
    { city: 'Plano' },
    { state: 'OK' },
    { zip: '75002' },
  ]) {
    assert.throws(
      () => buildAscStructuredCapture(target, { ...context, ...mismatch }),
      /does not match/,
    );
  }
});

test('USPS Cove and Cv equivalence preserves raw addresses and requires second review', () => {
  const target = {
    candidate_fingerprint: sha('4'),
    // Reproduce a row frozen before USPS COVE/CV normalization existed.
    address_token: '4100 CEDAR COVE|TULSA|OK|74103',
    cms_identity: {
      facility_name: 'Synthetic Ambulatory Center',
      address: '4100 Cedar Cove', city: 'Tulsa', state: 'OK', zip: '74103',
    },
  };
  const context = {
    source: 'costar',
    page_url: 'https://example.costar.com/property/cedar-cove',
    address: '4100 Cedar Cv', city: 'Tulsa', state: 'OK', zip: '74103',
    square_footage: '6,390',
    tenant_name: 'Synthetic Plastic Surgery and Spa',
  };

  assert.equal(normalizeAscAddressToken(target.cms_identity), '4100 CEDAR CV|TULSA|OK|74103');
  assert.equal(normalizeAscAddressToken(context), '4100 CEDAR CV|TULSA|OK|74103');
  const built = buildAscStructuredCapture(target, context);
  assert.equal(built.capture.address_token, target.address_token);
  assert.equal(built.capture.address, context.address);
  assert.equal(built.identity_match.mode, 'usps_cove_suffix_equivalence');
  assert.equal(built.identity_match.cms_address_preserved, target.cms_identity.address);
  assert.equal(built.identity_match.captured_address_preserved, context.address);
  assert.equal(built.identity_match.second_review_required, true);

  for (const mismatch of [
    { address: '4101 Cedar Cv' },
    { city: 'Oklahoma City' },
    { state: 'AR' },
    { zip: '74104' },
  ]) {
    assert.throws(
      () => buildAscStructuredCapture(target, { ...context, ...mismatch }),
      /does not match/,
    );
  }
});

test('a single compound street split requires exact facility corroboration', () => {
  const target = {
    candidate_fingerprint: sha('5'),
    address_token: '131 SUMMERPLACE DR|WEST COLUMBIA|SC|29169',
    cms_identity: {
      facility_name: 'South Carolina Endoscopy Center',
      address: '131 Summerplace Drive', city: 'West Columbia', state: 'SC', zip: '29169',
    },
  };
  const context = {
    source: 'costar',
    page_url: 'https://example.costar.com/property/south-carolina-endoscopy-center',
    address: '131 Summer Place Dr', city: 'West Columbia', state: 'SC', zip: '29169',
    building_name: 'South Carolina Endoscopy Center',
    square_footage: '20,519',
    tenant_name: 'Consultants In Gstrntrlgy',
  };
  const built = buildAscStructuredCapture(target, context);
  assert.equal(built.capture.address_token, target.address_token);
  assert.equal(built.capture.address, context.address);
  assert.equal(built.identity_match.mode, 'facility_corroborated_compound_street_split');
  assert.equal(built.identity_match.frozen_compound_token, 'SUMMERPLACE');
  assert.deepEqual(built.identity_match.captured_street_parts, ['SUMMER', 'PLACE']);
  assert.equal(built.identity_match.corroboration_basis, 'building_name');
  assert.equal(built.identity_match.second_review_required, true);

  for (const mismatch of [
    { building_name: 'Unrelated Medical Plaza' },
    { address: '133 Summer Place Dr' },
    { address: '131 Summer Park Dr' },
    { city: 'Columbia' },
    { state: 'NC' },
    { zip: '29170' },
  ]) {
    assert.throws(
      () => buildAscStructuredCapture(target, { ...context, ...mismatch }),
      /does not match/,
    );
  }
});

test('shared-address parent buildings require explicit ASC tenant corroboration', () => {
  const target = {
    candidate_fingerprint: sha('f'),
    address_token: '100 CAMPUS DR 1ST FLOOR|TESTVILLE|MI|48000',
    cms_identity: {
      facility_name: 'Synthetic Endoscopy Center at Research Campus',
      address: '100 Campus Dr, 1st Floor, Suite D110',
      city: 'Testville', state: 'MI', zip: '48000',
    },
  };
  const context = {
    source: 'costar',
    page_url: 'https://example.costar.com/property/shared-campus',
    address: '100 Campus Dr', city: 'Testville', state: 'MI', zip: '48000',
    building_name: 'Synthetic Medical Center',
    square_footage: '193,678',
    tenants: [
      { name: 'Synthetic Health System', occupied_sf: '193,678' },
      { name: 'Synthetic Endoscopy Center', occupied_sf: '5,000' },
    ],
  };
  const built = buildAscStructuredCapture(target, context);
  assert.equal(built.capture.address_token, target.address_token);
  assert.equal(built.identity_match.mode, 'tenant_corroborated_parent_building');
  assert.equal(built.identity_match.cms_sublocation_preserved, target.cms_identity.address);

  assert.throws(
    () => buildAscStructuredCapture(target, { ...context, tenants: [{ name: 'Synthetic Health System' }] }),
    /does not match/,
  );
  assert.throws(
    () => buildAscStructuredCapture(target, { ...context, address: '100 Campus Dr', city: 'Other City' }),
    /does not match/,
  );
});

test('parent buildings allow a missing street suffix only with corroborated enrollment organization tenancy', () => {
  const target = {
    candidate_fingerprint: sha('a'),
    address_token: '100 W CENTRAL|TESTVILLE|KS|67000',
    cms_identity: {
      facility_name: 'Synthetic Surgery Center',
      address: '100 West Central, Suite One',
      city: 'Testville', state: 'KS', zip: '67000',
    },
    cms_evidence: {
      enrollment_corroborated: true,
      enrollment_org_names: ['Synthetic Family Physicians, P.A.'],
    },
  };
  const context = {
    source: 'costar',
    page_url: 'https://example.costar.com/property/enrollment-org-campus',
    address: '100 W Central Ave', city: 'Testville', state: 'KS', zip: '67000',
    square_footage: '50,000',
    tenant_name: 'Synthetic Family Physicians, P.A.',
  };
  const built = buildAscStructuredCapture(target, context);
  assert.equal(built.capture.address_token, target.address_token);
  assert.equal(built.identity_match.mode, 'enrollment_org_corroborated_parent_building');
  assert.equal(built.identity_match.corroboration_basis, 'cms_enrollment_organization');

  assert.throws(
    () => buildAscStructuredCapture({
      ...target,
      cms_evidence: { ...target.cms_evidence, enrollment_corroborated: false },
    }, context),
    /does not match/,
  );
  assert.throws(
    () => buildAscStructuredCapture(target, { ...context, tenant_name: 'Unrelated Medical Group' }),
    /does not match/,
  );
  assert.throws(
    () => buildAscStructuredCapture(target, { ...context, address: '102 W Central Ave' }),
    /does not match/,
  );
});

test('terminal Township municipality aliases require exact location and explicit tenant corroboration', () => {
  const target = {
    candidate_fingerprint: sha('8'),
    address_token: '1000 GALLOPING HILL RD|UNION|NJ|07083',
    cms_identity: {
      facility_name: 'Atlantic Surgery Center at Union',
      address: '1000 Galloping Hill Road', city: 'Union', state: 'NJ', zip: '07083',
    },
    cms_evidence: {
      enrollment_corroborated: true,
      enrollment_org_names: ['Union Surgery Center, LLC'],
    },
  };
  const context = {
    source: 'costar',
    page_url: 'https://example.costar.com/property/union-medical-park',
    address: '1000 Galloping Hill Rd', city: 'Union Township', state: 'NJ', zip: '07083',
    square_footage: '150,400',
    tenants: [{ name: 'Union Surgery Center', occupied_sf: '15,722' }],
  };
  const built = buildAscStructuredCapture(target, context);
  assert.equal(built.capture.address_token, target.address_token);
  assert.equal(built.identity_match.mode, 'tenant_corroborated_municipality_alias');
  assert.equal(built.identity_match.corroboration_basis, 'cms_enrollment_organization');
  assert.equal(built.identity_match.cms_city_preserved, 'Union');
  assert.equal(built.identity_match.captured_city, 'Union Township');
  assert.equal(built.identity_match.second_review_required, true);

  assert.throws(
    () => buildAscStructuredCapture(target, { ...context, tenants: [{ name: 'Unrelated Medical Group' }] }),
    /does not match/,
  );
  assert.throws(
    () => buildAscStructuredCapture(target, { ...context, address: '1002 Galloping Hill Rd' }),
    /does not match/,
  );
  assert.throws(
    () => buildAscStructuredCapture(target, { ...context, city: 'Union City' }),
    /does not match/,
  );
  assert.throws(
    () => buildAscStructuredCapture(target, { ...context, state: 'PA' }),
    /does not match/,
  );
  assert.throws(
    () => buildAscStructuredCapture(target, { ...context, zip: '07084' }),
    /does not match/,
  );
});

test('captured directional and street type extensions require a CMS sublocation and exact tenant corroboration', () => {
  const target = {
    candidate_fingerprint: sha('7'),
    address_token: '2704 GALLOWAY|MESQUITE|TX|75150',
    cms_identity: {
      facility_name: 'Texas GI Endoscopy Center',
      address: '2704 Galloway Suite 102', city: 'Mesquite', state: 'TX', zip: '75150',
    },
    cms_evidence: {
      enrollment_corroborated: true,
      enrollment_org_names: ['Mesquite TX Endoscopy ASC LLC'],
    },
  };
  const context = {
    source: 'costar',
    page_url: 'https://example.costar.com/property/americana-medical-plaza',
    address: '2704 N Galloway Ave', city: 'Mesquite', state: 'TX', zip: '75150',
    square_footage: '18,844',
    tenants: [{ name: 'Texas GI Endoscopy Center', occupied_sf: '4,750' }],
  };
  const built = buildAscStructuredCapture(target, context);
  assert.equal(built.capture.address_token, target.address_token);
  assert.equal(built.identity_match.mode, 'tenant_corroborated_directional_street_type_extension');
  assert.equal(built.identity_match.added_directional, 'N');
  assert.equal(built.identity_match.added_street_type, 'AVE');
  assert.equal(built.identity_match.corroboration_basis, 'facility_name');
  assert.equal(built.identity_match.cms_sublocation_preserved, '2704 Galloway Suite 102');
  assert.equal(built.identity_match.captured_building_address, '2704 N Galloway Ave');
  assert.equal(built.identity_match.second_review_required, true);

  for (const mismatch of [
    { tenants: [{ name: 'Unrelated Medical Group' }] },
    { address: '2706 N Galloway Ave' },
    { address: '2704 N Other Ave' },
    { address: '2704 N N Galloway Ave' },
    { city: 'Garland' },
    { state: 'OK' },
    { zip: '75149' },
  ]) {
    assert.throws(
      () => buildAscStructuredCapture(target, { ...context, ...mismatch }),
      /does not match/,
    );
  }
  assert.throws(
    () => buildAscStructuredCapture({
      ...target,
      cms_identity: { ...target.cms_identity, address: '2704 Galloway' },
    }, context),
    /does not match/,
  );
});

test('adjacent civic numbers require an evidence-backed candidate alias and tenant corroboration', () => {
  const alias = {
    status: 'approved',
    reason_code: 'same_physical_building_dedicated_entry',
    address_token: '12 RESEARCH LN|TESTVILLE|IL|60000',
    authorized_by: 'research_owner',
    authorized_at: '2026-08-27T12:00:00Z',
    evidence_citations: [
      { source: 'official_operator', url: 'https://example.org/operator-location' },
      { source: 'property_manager', url: 'https://example.org/property-address-alias' },
    ],
  };
  const target = {
    candidate_fingerprint: sha('b'),
    address_token: '10 RESEARCH LN|TESTVILLE|IL|60000',
    cms_identity: {
      facility_name: 'Synthetic Surgical Center Inc',
      address: '10 Research Lane', city: 'Testville', state: 'IL', zip: '60000',
    },
    cms_evidence: {
      enrollment_corroborated: true,
      enrollment_org_names: ['Synthetic Surgical Center LLC'],
      approved_parent_address_aliases: [alias],
    },
  };
  const context = {
    source: 'costar',
    page_url: 'https://example.costar.com/property/research-campus',
    address: '12 Research Ln', city: 'Testville', state: 'IL', zip: '60000',
    square_footage: '60,000', tenant_name: 'Synthetic Surgical Center Inc',
  };
  const built = buildAscStructuredCapture(target, context);
  assert.equal(built.capture.address_token, target.address_token);
  assert.equal(built.identity_match.mode, 'evidence_backed_parent_address_alias');
  assert.equal(built.identity_match.second_review_required, true);

  assert.throws(
    () => buildAscStructuredCapture({
      ...target,
      cms_evidence: { ...target.cms_evidence, approved_parent_address_aliases: [] },
    }, context),
    /does not match/,
  );
  assert.throws(
    () => buildAscStructuredCapture({
      ...target,
      cms_evidence: {
        ...target.cms_evidence,
        approved_parent_address_aliases: [{ ...alias, evidence_citations: [alias.evidence_citations[0]] }],
      },
    }, context),
    /does not match/,
  );
  assert.throws(
    () => buildAscStructuredCapture(target, { ...context, tenant_name: 'Unrelated Tenant' }),
    /does not match/,
  );
});

test('evidence-backed aliases allow only terminal legal-entity suffix differences in tenant names', () => {
  const target = {
    candidate_fingerprint: sha('c'),
    address_token: '10 RESEARCH LN|TESTVILLE|IL|60000',
    cms_identity: {
      facility_name: 'Synthetic Surgical Center Inc',
      address: '10 Research Lane', city: 'Testville', state: 'IL', zip: '60000',
    },
    cms_evidence: {
      enrollment_corroborated: true,
      enrollment_org_names: ['Synthetic Surgical Center LLC'],
      approved_parent_address_aliases: [{
        status: 'approved',
        reason_code: 'same_physical_building_dedicated_entry',
        address_token: '12 RESEARCH LN|TESTVILLE|IL|60000',
        authorized_by: 'research_owner',
        authorized_at: '2026-08-27T12:00:00Z',
        evidence_citations: [
          { source: 'official_operator', url: 'https://example.org/operator-location' },
          { source: 'property_manager', url: 'https://example.org/property-address-alias' },
        ],
      }],
    },
  };
  const context = {
    source: 'costar',
    page_url: 'https://example.costar.com/property/research-campus',
    address: '12 Research Ln', city: 'Testville', state: 'IL', zip: '60000',
    square_footage: '60,000', tenant_name: 'Synthetic Surgical Center',
  };
  const built = buildAscStructuredCapture(target, context);
  assert.equal(built.identity_match.mode, 'evidence_backed_parent_address_alias');
  assert.equal(built.identity_match.corroborated_name, 'SYNTHETIC SURGICAL CENTER');

  assert.throws(
    () => buildAscStructuredCapture(target, { ...context, tenant_name: 'Synthetic Surgical Center East' }),
    /does not match/,
  );
  assert.throws(
    () => buildAscStructuredCapture(target, { ...context, tenant_name: 'Synthetic Surgery Center' }),
    /does not match/,
  );
});

test('building ranges match only a frozen endpoint with exact location and tenant corroboration', () => {
  const target = {
    candidate_fingerprint: sha('9'),
    address_token: '120 RESEARCH DR NW|TESTVILLE|OH|44000',
    cms_identity: {
      facility_name: 'Synthetic Gastroenterology Center Inc',
      address: '120 Research Drive NW', city: 'Testville', state: 'OH', zip: '44000',
    },
    cms_evidence: {
      enrollment_corroborated: true,
      enrollment_org_names: ['Synthetic Gastroenterology Center LLC'],
    },
  };
  const context = {
    source: 'costar',
    page_url: 'https://example.costar.com/property/research-range',
    address: '100-120 Research Dr NW', city: 'Testville', state: 'OH', zip: '44000',
    square_footage: '25,000', tenant_name: 'Synthetic Gastroenterology Center',
  };
  const built = buildAscStructuredCapture(target, context);
  assert.equal(built.capture.address_token, target.address_token);
  assert.equal(built.capture.address, context.address);
  assert.equal(built.identity_match.mode, 'tenant_corroborated_range_endpoint');
  assert.equal(built.identity_match.frozen_street_number, 120);
  assert.equal(built.identity_match.captured_range_start, 100);
  assert.equal(built.identity_match.captured_range_end, 120);
  assert.equal(built.identity_match.second_review_required, true);

  assert.throws(
    () => buildAscStructuredCapture({ ...target, address_token: '110 RESEARCH DR NW|TESTVILLE|OH|44000' }, context),
    /does not match/,
  );
  assert.throws(
    () => buildAscStructuredCapture(target, { ...context, address: '100-120 Other Dr NW' }),
    /does not match/,
  );
  assert.throws(
    () => buildAscStructuredCapture(target, { ...context, zip: '44001' }),
    /does not match/,
  );
  assert.throws(
    () => buildAscStructuredCapture(target, { ...context, tenant_name: 'Synthetic Gastroenterology Center East' }),
    /does not match/,
  );
});

test('migration is private, RLS-protected, exact-50, and hard-blocks prohibited writes', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20261001120000_lcc_asc_research_swim_lane.sql', import.meta.url), 'utf8');
  for (const table of ['runs', 'candidates', 'captures', 'evidence', 'reviews']) {
    assert.match(sql, new RegExp(`healthcare_research_${table} enable row level security`, 'i'));
    assert.match(sql, new RegExp(`revoke all on public\\.healthcare_research_${table} from public, anon, authenticated`, 'i'));
  }
  assert.match(sql, /sample_size\s+integer[^;]+check \(sample_size = 50\)/is);
  assert.match(sql, /jsonb_array_length\(p_candidates\)[\s\S]+v_count <> 50/is);
  assert.match(sql, /canonical_write_authorized[^;]+check \(canonical_write_authorized = false\)/is);
  assert.match(sql, /salesforce_write_authorized[^;]+check \(salesforce_write_authorized = false\)/is);
  assert.match(sql, /outreach_authorized[^;]+check \(outreach_authorized = false\)/is);
  assert.doesNotMatch(sql, /grant\s+.+healthcare_research_.+\s+to\s+(anon|authenticated)/i);
  assert.match(sql, /revoke all on public\.healthcare_research_evidence from service_role/i);
  assert.doesNotMatch(sql, /grant\s+(update|delete)[^;]+healthcare_research_(captures|evidence)/i);
});

test('ASC routes are mounted and never invoke the dialysis/government propagator', async () => {
  const [server, intake, handler, sidepanel] = await Promise.all([
    readFile(new URL('../server.js', import.meta.url), 'utf8'),
    readFile(new URL('../api/intake.js', import.meta.url), 'utf8'),
    readFile(new URL('../api/_handlers/asc-research-handler.js', import.meta.url), 'utf8'),
    readFile(new URL('../extension/sidepanel.js', import.meta.url), 'utf8'),
  ]);
  for (const route of ['asc-research-import', 'asc-research-target', 'asc-research-capture', 'asc-research-complete']) {
    assert.match(server, new RegExp(`/api/${route}`));
    assert.match(intake, new RegExp(`case '${route}'`));
  }
  assert.doesNotMatch(handler, /propagateToDomainDb|processSidebarExtraction|sf_sync_queue|bd_opportunities|touchpoint_cadence/);
  assert.match(sidepanel, /sessionCtx\?\.address\s*&&\s*sessionCtx\?\.state\s*\?\s*sessionCtx\s*:\s*ctx/);
  assert.match(sidepanel, /toErrorMessage\(\s*capture\.data\?\.detail/);
});

test('capture retries receive only the column update privilege required by the invoker RPC', async () => {
  const sql = await readFile(
    new URL('../supabase/migrations/20261001120500_lcc_asc_capture_retry_privilege.sql', import.meta.url),
    'utf8',
  );
  assert.match(sql, /grant\s+update\s*\(\s*source_url\s*\)\s+on\s+public\.healthcare_research_captures\s+to\s+service_role/is);
  assert.doesNotMatch(sql, /grant\s+update\s+on\s+public\.healthcare_research_captures/i);
  assert.doesNotMatch(sql, /security\s+definer/i);
});

test('dual-source missingness advances without fabricating a capture and remains fail closed', async () => {
  const [sql, handler, sidepanel] = await Promise.all([
    readFile(new URL('../supabase/migrations/20261001120600_lcc_asc_dual_source_missingness.sql', import.meta.url), 'utf8'),
    readFile(new URL('../api/_handlers/asc-research-handler.js', import.meta.url), 'utf8'),
    readFile(new URL('../extension/sidepanel.js', import.meta.url), 'utf8'),
  ]);
  assert.match(sql, /p_source_dispositions\s+is\s+distinct\s+from\s+'\{"costar":"not_found","rca":"not_found"\}'::jsonb/is);
  assert.match(sql, /if\s+v_capture_count\s+<>\s+0\s+then[\s\S]+captured candidates must use normal evidence completion/is);
  assert.match(sql, /final_disposition[\s\S]+licensed_sources_not_found/is);
  assert.match(sql, /second_review_required[\s\S]+true/is);
  assert.match(sql, /set\s+status\s*=\s*'reviewed',[^;]+reviewed_at/is);
  assert.doesNotMatch(sql, /insert\s+into\s+public\.healthcare_research_(captures|evidence)/i);
  assert.doesNotMatch(sql, /delete\s+from/i);
  assert.match(handler, /Object\.keys\(source_dispositions\)\.length\s*!==\s*2/);
  assert.match(handler, /rpc\/lcc_complete_asc_candidate_missingness/);
  assert.match(sidepanel, /Complete: CoStar \+ RCA not found/);
  assert.match(sidepanel, /window\.confirm\(/);
  assert.match(sidepanel, /source_dispositions:\s*\{\s*costar:\s*'not_found',\s*rca:\s*'not_found'\s*\}/s);
});

test('dual-source missingness upsert uses the named primary key to avoid output-column ambiguity', async () => {
  const sql = await readFile(
    new URL('../supabase/migrations/20261002090100_lcc_asc_missingness_conflict_target.sql', import.meta.url),
    'utf8',
  );
  assert.match(
    sql,
    /on\s+conflict\s+on\s+constraint\s+healthcare_research_reviews_pkey\s+do\s+update/is,
  );
  assert.doesNotMatch(sql, /on\s+conflict\s*\(\s*run_id\s*,\s*candidate_fingerprint\s*\)/i);
  assert.match(sql, /security\s+invoker/i);
  assert.doesNotMatch(sql, /delete\s+from/i);
});

test('captured pending ASC targets keep their normal completion control after a refresh', async () => {
  const [handler, sidepanel] = await Promise.all([
    readFile(new URL('../api/_handlers/asc-research-handler.js', import.meta.url), 'utf8'),
    readFile(new URL('../extension/sidepanel.js', import.meta.url), 'utf8'),
  ]);
  assert.match(handler, /healthcare_research_captures\?run_id=eq/);
  assert.match(handler, /countMode:\s*'exact'/);
  assert.match(handler, /capture_count:\s*captureCount/);
  assert.match(sidepanel, /Number\(target\.capture_count\)\s*>\s*0/);
  assert.match(sidepanel, /data-asc-capture-complete/);
  assert.match(sidepanel, /Complete property capture/);
  assert.match(sidepanel, /missing\.disabled\s*=\s*true/);
});

test('single-tenant organization family corroborates an exact parent building with a preserved CMS typo', () => {
  const target = {
    candidate_fingerprint: 'a'.repeat(64),
    address_token: '30 TUSCAN BLFD FL 3|SALEM|NH|03079',
    cms_identity: {
      address: '30 Tuscan BLFD Fl 3',
      city: 'Salem',
      state: 'NH',
      zip: '03079',
      facility_name: 'MASS General Brigham Amsurg Inc',
    },
    cms_evidence: {
      enrollment_corroborated: true,
      enrollment_org_names: ['MASS GENERAL BRIGHAM AMSURG, INC.'],
    },
  };
  const context = {
    source: 'costar',
    address: '30 Tuscan Blvd',
    city: 'Salem',
    state: 'NH',
    zip: '03079',
    tenancy_type: 'Single',
    primary_tenant: 'Mass General Brigham Healthcare Center',
    square_footage: 70000,
  };
  const result = buildAscStructuredCapture(target, context);
  assert.equal(result.identity_match.mode, 'single_tenant_organization_family_parent_building');
  assert.equal(result.identity_match.organization_family, 'MASS GENERAL BRIGHAM');
  assert.equal(result.identity_match.second_review_required, true);
  assert.equal(result.identity_match.cms_sublocation_preserved, '30 Tuscan BLFD Fl 3');

  assert.throws(
    () => buildAscStructuredCapture(target, { ...context, tenancy_type: 'Multi' }),
    /does not match/,
  );
  assert.throws(
    () => buildAscStructuredCapture(target, {
      ...context,
      primary_tenant: 'Mass General Healthcare Center',
    }),
    /does not match/,
  );
  assert.throws(
    () => buildAscStructuredCapture(target, { ...context, address: '32 Tuscan Blvd' }),
    /does not match/,
  );
});

test('CoStar value-first tenancy cards preserve the explicit single-tenant gate', async () => {
  const costar = await readFile(
    new URL('../extension/content/costar.js', import.meta.url),
    'utf8',
  );
  assert.match(
    costar,
    /\/\^\(single\|multi\)\$\/i\.test\(line\)[\s\S]+\/\^tenancy\$\/i\.test\(next\)[\s\S]+data\.tenancy_type\s*=\s*line/,
  );
});
