// ============================================================================
// OCR1 bake-off harness — guards for the comparison logic.
//
// The harness's whole value is one number (field agreement), and the two ways
// that number lies are guarded here:
//
//   1. BOTH-NULL COUNTED AS AGREEMENT. If a document defeats both engines every
//      field is null on both sides; naive equality then reports 100% agreement
//      over a total failure. `agreement_rate` must EXCLUDE both-null.
//   2. A GRADED KEY THE CONSUMER NEVER EMITS. `extractTenantFromLease` renames
//      on the way out (tenant_name→name, leased_sf→sf). Grading on the model's
//      JSON names reads `undefined`, normalizes to null on both sides, and
//      scores `both_null` forever — a field silently not measured. THIS WAS LIVE
//      in the harness's first run, on 2 of 6 fields.
//
// Pure functions only: no network, no model, no OCR binary.
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GRADED_FIELDS, assertGradedFieldsReadable, normalizeField, compareField,
  scoreDocument, garbleStats, clauseLegibility,
} from '../scripts/ocr-bakeoff.mjs';
import { extractTenantFromLease } from '../api/_shared/bov-extract.js';

const T = (over = {}) => ({
  name: 'Acme Dialysis LLC', lease_commencement: '2019-06-01', lease_expiration: '2034-05-31',
  year1_rent: 412500, sf: 14250, lease_type: 'NNN', ...over,
});

// --- 1. the both-null trap --------------------------------------------------

test('both-null is its own verdict and is never agreement', () => {
  assert.equal(compareField(GRADED_FIELDS[0], null, null), 'both_null');
  assert.equal(compareField(GRADED_FIELDS[0], '', ''), 'both_null');
});

test('a document where both engines found nothing scores null, NOT 1.0', () => {
  const s = scoreDocument({}, {});
  assert.equal(s.tally.both_null, GRADED_FIELDS.length);
  assert.equal(s.decided_fields, 0);
  assert.equal(s.agreement_rate, null, 'a mutual total failure must not render as a perfect score');
});

test('agreement_rate denominator excludes both_null', () => {
  // 3 agree, 1 disagree, 2 both-null → 3/4 = 75%, never 3/6 or 4/6.
  const base = T({ year1_rent: null, sf: null });
  const cand = T({ year1_rent: null, sf: null, lease_type: 'Gross' });
  const s = scoreDocument(base, cand);
  assert.equal(s.tally.both_null, 2);
  assert.equal(s.decided_fields, 4);
  assert.equal(s.agreement_rate, 0.75);
});

test('a local miss and a local win are distinguished, and neither is agreement', () => {
  assert.equal(compareField(GRADED_FIELDS[3], 412500, null), 'baseline_only'); // local LOST it
  assert.equal(compareField(GRADED_FIELDS[3], null, 412500), 'candidate_only'); // local WON it
  const s = scoreDocument(T(), T({ year1_rent: null }));
  assert.equal(s.tally.baseline_only, 1);
  assert.equal(s.tally.agree, 5);
  assert.ok(s.agreement_rate < 1, 'a field the local engine lost must reduce the rate');
});

// --- 2. graded keys must exist on the CONSUMER's object ---------------------

test('every graded key is one extractTenantFromLease actually emits', async () => {
  // Drive the real consumer with a stub model so the tenant shape is the real one.
  const model = {
    tenant_name: 'Acme', leased_sf: 100, lease_type: 'NNN', year1_rent: 1,
    lease_commencement: '2020-01-01', lease_expiration: '2030-01-01',
  };
  const res = await extractTenantFromLease(
    { document_id: 'x', raw_text: 'lease', pages: null },
    { invokeExtractionAI: async () => ({ ok: true, data: { response: JSON.stringify(model) } }) },
  );
  assert.ok(res.ok, 'stub extraction should succeed');
  const unreadable = assertGradedFieldsReadable(res.tenant);
  assert.deepEqual(unreadable, [],
    `graded keys absent from the consumer tenant object: ${unreadable.join(', ')} — these would score both_null forever`);
  // And the values must actually arrive, not just the keys exist.
  for (const f of GRADED_FIELDS) {
    assert.notEqual(res.tenant[f.key], undefined, `${f.label} (key ${f.key}) unreadable`);
  }
});

test('assertGradedFieldsReadable names a renamed key instead of scoring both_null', () => {
  const missing = assertGradedFieldsReadable({ lease_type: 'NNN' });
  assert.ok(missing.includes('tenant_name'));
  assert.ok(missing.includes('leased_sf'));
  assert.equal(assertGradedFieldsReadable(null).length, GRADED_FIELDS.length);
});

// --- 3. normalization dispatches on TYPE, not on field name -----------------

test('money and SF normalize past $ and commas; dates past surrounding text', () => {
  assert.equal(normalizeField('number', '$412,500'), 412500);
  assert.equal(normalizeField('number', 412500), 412500);
  assert.equal(normalizeField('date', 'commencing 2019-06-01 hereof'), '2019-06-01');
  assert.equal(normalizeField('string', ' Acme  Dialysis, LLC. '), 'acme dialysis llc');
  assert.equal(normalizeField('number', 'not a number'), null);
});

test('a digit error is a DISAGREEMENT, never smoothed away by a tolerance', () => {
  // 412500 vs 412600 is exactly the OCR failure the bake-off exists to catch.
  assert.equal(compareField(GRADED_FIELDS[3], 412500, 412600), 'disagree');
});

// --- 4. context signals -----------------------------------------------------

test('garbleStats separates a clean read from a same-length garbled one', () => {
  const clean = garbleStats('The Tenant shall pay Base Rent monthly in advance');
  const garbled = garbleStats('Tl1e T3nant 5h@ll p@y B@se R3nt m0nthly 1n adv@nce');
  assert.ok(garbled.wordlike_ratio < clean.wordlike_ratio,
    'a garbled read of similar length must score lower on wordlike_ratio');
});

test('garbleStats reports empty text honestly rather than as a zero score', () => {
  const g = garbleStats('');
  assert.equal(g.chars, 0);
  assert.equal(g.wordlike_ratio, null, 'no text means cannot be measured, not measured-as-0');
});

test('clauseLegibility finds back-half clauses and reports where they sit', () => {
  const text = `${'filler '.repeat(400)}Tenant shall have the option to extend the term. `
    + 'Upon an event of default Tenant shall have a cure period. Any holding over is at 150%.';
  const c = clauseLegibility(text);
  assert.equal(c.renewal_options.found, true);
  assert.equal(c.default_cure.found, true);
  assert.equal(c.holdover.found, true);
  assert.equal(c.early_termination.found, false, 'a clause the text does not state must read false');
  assert.ok(c.renewal_options.position > 0.5, 'a back-half clause should report a back-half position');
  assert.equal(c.found_count, 3);
});
