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
  const [server, intake, handler] = await Promise.all([
    readFile(new URL('../server.js', import.meta.url), 'utf8'),
    readFile(new URL('../api/intake.js', import.meta.url), 'utf8'),
    readFile(new URL('../api/_handlers/asc-research-handler.js', import.meta.url), 'utf8'),
  ]);
  for (const route of ['asc-research-import', 'asc-research-target', 'asc-research-capture', 'asc-research-complete']) {
    assert.match(server, new RegExp(`/api/${route}`));
    assert.match(intake, new RegExp(`case '${route}'`));
  }
  assert.doesNotMatch(handler, /propagateToDomainDb|processSidebarExtraction|sf_sync_queue|bd_opportunities|touchpoint_cadence/);
});
