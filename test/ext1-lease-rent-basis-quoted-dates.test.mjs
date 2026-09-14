// ============================================================================
// EXT1 — the lease extractor must not do arithmetic or pick date defaults
//
// THE MEASURED DEFECT (OCR1c `--control self`, 2026-09-02): the SAME model, on
// the SAME DocAI text, twice, disagreed with ITSELF on 29% of `lease_expiration`
// decisions and 11% of `year1_rent`. On one lease it returned 84,464 on one call
// and 89,496 on the next as the ANNUAL rent from a text stating `$8,464.00 per
// month` — a figure matching neither 12x nor anything on the page. The prompt
// said "NEVER guess a value" two lines above a format rule that forced the guess.
//
// So the invariants below are about WHO decides, not about a rate:
//   1. The prompt asks for a quoted rent (amount + basis) and a quoted date
//      (date + precision), and never asks for `year1_rent` or a bare date.
//   2. The annualization is deterministic, in code, on named inputs.
//   3. A model `year1_rent` number is IGNORED whenever a quote is present —
//      belt and braces against a model that annualizes anyway.
//   4. A date the lease states by FORMULA resolves to no date and keeps the
//      formula verbatim; an expiration is derived only from a stated day plus a
//      stated term, and says so.
//   5. The six consumer keys the BOV generator and the bake-off read are
//      unchanged in name and type.
//
// Pure: a stub model, no DB, no network.
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  extractTenantFromLease, annualizeRent, normalizeBaseRent,
  resolveQuotedDate, normalizeLeaseTerm, deriveExpirationFromTerm, __private,
} from '../api/_shared/bov-extract.js';

const SRC = readFileSync(new URL('../api/_shared/bov-extract.js', import.meta.url), 'utf8');

/**
 * ⚠️ STRIP COMMENTS, THEN BLANK STRING LITERALS — IN THAT ORDER.
 *
 * This module's comments quote every hazard they remove by name and at length
 * ("84,464", "annualize", `year1_rent`), so a raw-source grep finds the defect
 * present in the sentence explaining the fix (A5c / N18). And the PROMPT ITSELF
 * is a wall of string literals naming `base_rent`, `basis` and `precision`, so a
 * source check for a CODE shape matches the prompt text instead of the code
 * (OCR1c). Order matters: blanking literals first lets a bare apostrophe in
 * ordinary prose ("the model's own arithmetic") open a string the scanner never
 * closes, swallowing real code behind it.
 */
function codeOnly(src) {
  const noComments = String(src)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((l) => l.replace(/(^|\s)\/\/.*$/, '$1'))
    .join('\n');
  return noComments.replace(/(['"`])(?:\\.|(?!\1)[\s\S])*?\1/g, (m) => m[0] + ' '.repeat(Math.max(0, m.length - 2)) + m[0]);
}

const CODE = codeOnly(SRC);

/** Drive the REAL consumer with a stub model so the tenant shape is the real one. */
async function extract(model, row = {}) {
  return extractTenantFromLease(
    { document_id: 'x', raw_text: 'lease', pages: null, ...row },
    { invokeExtractionAI: async () => ({ ok: true, data: { response: JSON.stringify(model) } }) },
  );
}

// --- 1. the prompt asks for a QUOTE, not an answer --------------------------

test('the lease prompt asks for base_rent {amount, basis} and never for year1_rent', () => {
  const p = __private.leasePrompt('LEASE TEXT');
  assert.match(p, /"base_rent"/, 'the prompt must request a quoted rent object');
  assert.match(p, /"basis"/, 'the quoted rent must carry the basis the lease states it on');
  assert.match(p, /"per_sf_annual"/, 'per-SF is a stated basis and must be expressible');
  assert.ok(!/"year1_rent"/.test(p),
    'asking the model for year1_rent is asking it to annualize — the measured defect (84,464 vs 89,496 on one $8,464/month lease)');
});

test('the lease prompt asks for a date PRECISION and forbids resolving a formula', () => {
  const p = __private.leasePrompt('LEASE TEXT');
  assert.match(p, /"precision"/, 'a quoted date must say how precise the lease actually is');
  assert.match(p, /"formula"/, 'a date defined by an event must be expressible as a formula, not a guessed day');
  assert.match(p, /"as_stated"/, 'the verbatim text is what a human reads when there is no date');
  assert.ok(!/"lease_commencement": "YYYY-MM-DD"/.test(p),
    'a bare YYYY-MM-DD field is the instruction that produced 29% self-disagreement on lease_expiration');
});

// --- 2. the arithmetic is ours, deterministic, on named inputs --------------

test('annualizeRent converts on named inputs and never on an unstated basis', () => {
  // The lease from the self-control run: "$8,464.00 per month".
  assert.deepEqual(annualizeRent({ amount: 8464, basis: 'monthly' }, null),
    { year1_rent: 101568, rent_basis_unresolved: false });
  assert.deepEqual(annualizeRent({ amount: 12.5, basis: 'per_sf_annual' }, 3800),
    { year1_rent: 47500, rent_basis_unresolved: false });
  assert.deepEqual(annualizeRent({ amount: 1.25, basis: 'per_sf_monthly' }, 3800),
    { year1_rent: 57000, rent_basis_unresolved: false });
  assert.deepEqual(annualizeRent({ amount: 132430, basis: 'annual' }, null),
    { year1_rent: 132430, rent_basis_unresolved: false });

  // A per-SF rent with no SF cannot be annualized — say so, do not guess.
  assert.deepEqual(annualizeRent({ amount: 12.5, basis: 'per_sf_annual' }, null),
    { year1_rent: null, rent_basis_unresolved: true });

  // An amount with NO stated basis: reporting it verbatim asserts an annual
  // figure the lease never made. That is the guess, in the other direction.
  assert.deepEqual(annualizeRent({ amount: 90000, basis: null }, 3800),
    { year1_rent: null, rent_basis_unresolved: true });

  // ⚠️ "the lease states no rent" is a DIFFERENT fact from "we cannot convert
  // the rent it states" — a null amount must not raise the unresolved flag.
  assert.deepEqual(annualizeRent({ amount: null, basis: 'monthly', as_stated: 'TBD' }, 3800),
    { year1_rent: null, rent_basis_unresolved: false });
  assert.deepEqual(annualizeRent(null, 3800), { year1_rent: null, rent_basis_unresolved: false });
});

test('an unrecognised basis is treated as unstated, not as annual', () => {
  assert.equal(normalizeBaseRent({ amount: 100, basis: 'quarterly' }).basis, null);
  assert.deepEqual(annualizeRent({ amount: 100, basis: 'quarterly' }, null),
    { year1_rent: null, rent_basis_unresolved: true });
});

test('the annualized figure carries cents, not float noise', () => {
  // ⚠️ THE MUTATION CONTROL PICKED THIS INPUT. `12.51 * 3810` happens to be exact
  // in IEEE-754, so an assertion built on it passes with the rounding REMOVED —
  // a green test over a mutated function. `8464.33 * 12` is 101571.95999999999.
  assert.equal(annualizeRent({ amount: 8464.33, basis: 'monthly' }, null).year1_rent, 101571.96);
  assert.equal(annualizeRent({ amount: 12.51, basis: 'per_sf_annual' }, 3810).year1_rent, 47663.1);
});

// --- 3. a model that annualizes anyway is overruled -------------------------

test('a model year1_rent number is IGNORED when a quoted base_rent is present', async () => {
  const r = await extract({
    tenant_name: 'Acme', leased_sf: 3800,
    base_rent: { amount: 8464, basis: 'monthly', as_stated: '$8,464.00 per month' },
    year1_rent: 89496, // the model doing it in its head, wrongly, as measured
  });
  assert.ok(r.ok);
  assert.equal(r.tenant.year1_rent, 101568, 'the quote must win over the model arithmetic');
  assert.equal(r.tenant.base_rent.as_stated, '$8,464.00 per month', 'the verbatim figure is the audit trail');
});

test('a quoted rent we cannot convert nulls year1_rent rather than passing the model number through', async () => {
  const r = await extract({
    base_rent: { amount: 12.5, basis: 'per_sf_annual', as_stated: '$12.50 per rentable square foot' },
    year1_rent: 47500, // model guessed an SF we do not have
  });
  assert.equal(r.tenant.year1_rent, null);
  assert.equal(r.tenant.rent_basis_unresolved, true);
});

test('with NO quote at all a legacy model number still rides through', async () => {
  const r = await extract({ year1_rent: 412500, lease_commencement: '2020-01-01' });
  assert.equal(r.tenant.year1_rent, 412500, 'a record written before EXT1 must not become null');
  assert.equal(r.tenant.rent_basis_unresolved, false);
});

// --- 4. dates are quoted, and a derivation says it is one -------------------

test('a formula-defined date resolves to NO date and keeps the formula verbatim', async () => {
  const stated = 'the first day of the month following Delivery';
  const r = await extract({
    lease_commencement: { date: null, as_stated: stated, precision: 'formula' },
  });
  assert.equal(r.tenant.lease_commencement, '', 'the consumer key stays a string, and it stays empty');
  assert.equal(r.tenant.lease_commencement_detail.as_stated, stated);
  assert.equal(r.tenant.lease_commencement_detail.precision, 'formula');
});

test('a date the model filled in beside a vague precision is DROPPED', () => {
  // The model resolving a formula in its head is the 29% self-disagreement.
  const r = resolveQuotedDate({ date: '2030-05-15', precision: 'formula', as_stated: 'the last day of the 120th month' });
  assert.equal(r.date, null);
  assert.equal(r.as_stated, 'the last day of the 120th month');
  assert.equal(resolveQuotedDate({ date: '2026-06-01', precision: 'month', as_stated: 'June 2026' }).date, null);
});

test('resolveQuotedDate accepts a bare string and rejects an impossible day', () => {
  assert.deepEqual(resolveQuotedDate('2020-01-01'), { date: '2020-01-01', as_stated: '2020-01-01', precision: 'day' });
  assert.equal(resolveQuotedDate('2026-02-31').date, null, 'a non-existent calendar day is not a date');
  assert.equal(resolveQuotedDate('2026-06').precision, 'month');
  assert.deepEqual(resolveQuotedDate(null), { date: null, as_stated: null, precision: null });
});

test('an expiration is derived from a stated DAY plus a stated term, and is stamped', async () => {
  const r = await extract({
    lease_commencement: { date: '2020-06-01', as_stated: 'June 1, 2020', precision: 'day' },
    lease_expiration: { date: null, as_stated: 'ten (10) Lease Years from the Commencement Date', precision: 'formula' },
    lease_term: { as_stated: 'ten (10) Lease Years', years: 10, months: null },
  });
  assert.equal(r.tenant.lease_expiration, '2030-05-31', 'a 10-year term from 2020-06-01 ends the day before 2030-06-01');
  assert.equal(r.tenant.lease_expiration_detail.derived_from_term, true,
    'a derivation must be distinguishable from a date the lease states');
});

test('the derivation refuses a partial input rather than defaulting', () => {
  const day = { date: '2020-06-01', precision: 'day', as_stated: 'June 1, 2020' };
  assert.equal(deriveExpirationFromTerm(day, { years: 10 }), '2030-05-31');
  assert.equal(deriveExpirationFromTerm(day, { years: null, months: null }), null, 'no term length ⇒ no derivation');
  assert.equal(deriveExpirationFromTerm(day, null), null);
  assert.equal(deriveExpirationFromTerm({ date: null, precision: 'formula' }, { years: 10 }), null,
    'no stated commencement day ⇒ no derivation');
  assert.equal(deriveExpirationFromTerm({ date: '2026-06', precision: 'month' }, { years: 10 }), null);
  // Month-end must clamp, not roll into the next month.
  assert.equal(deriveExpirationFromTerm({ date: '2020-01-31', precision: 'day' }, { years: 0, months: 1 }), '2020-02-28');
});

test('a stated expiration is NEVER overwritten by a derivation', async () => {
  const r = await extract({
    lease_commencement: { date: '2020-06-01', precision: 'day' },
    lease_expiration: { date: '2031-05-31', precision: 'day', as_stated: 'May 31, 2031' },
    lease_term: { years: 10 },
  });
  assert.equal(r.tenant.lease_expiration, '2031-05-31');
  assert.notEqual(r.tenant.lease_expiration_detail.derived_from_term, true);
});

test('normalizeLeaseTerm keeps prose when the numbers are absent', () => {
  assert.deepEqual(normalizeLeaseTerm({ as_stated: 'the Initial Term', years: null, months: null }),
    { as_stated: 'the Initial Term', years: null, months: null });
  assert.equal(normalizeLeaseTerm(null), null);
  assert.equal(normalizeLeaseTerm({}), null);
});

// --- 5. rent_schedule annualizes the same way -------------------------------

test('a rent-schedule period annualizes from its own quote and keeps annual_rent', async () => {
  const r = await extract({
    leased_sf: 1000,
    rent_schedule: [
      { label: 'Yrs 1-5', start_date: '2020-01-01', end_date: '2024-12-31', base_rent: { amount: 2000, basis: 'monthly' }, status: 'Contracted' },
      { label: 'Option 1', start_date: '2025-01-01', end_date: '2029-12-31', base_rent: { amount: 30, basis: 'per_sf_annual' }, status: 'Option' },
    ],
  });
  assert.equal(r.tenant.rent_schedule[0].annual_rent, 24000);
  assert.equal(r.tenant.rent_schedule[1].annual_rent, 30000, 'per-SF periods use the tenant leased SF');
  assert.equal(r.tenant.rent_schedule[1].status, 'Option');
});

test('a period quote overrules a model annual_rent, one row at a time', async () => {
  // The year-1 rule applies per PERIOD too: a schedule stated monthly must stop
  // being annualized in the model's head row by row.
  const r = await extract({
    leased_sf: 1000,
    rent_schedule: [{ label: 'Yrs 1-5', base_rent: { amount: 2000, basis: 'monthly' }, annual_rent: 23880 }],
  });
  assert.equal(r.tenant.rent_schedule[0].annual_rent, 24000, 'the quote must win over the model arithmetic');
});

test('a period with only a legacy annual_rent still rides through', async () => {
  const r = await extract({ rent_schedule: [{ label: 'Yrs 1-5', annual_rent: 23880 }] });
  assert.equal(r.tenant.rent_schedule[0].annual_rent, 23880);
  assert.equal(r.tenant.rent_schedule[0].rent_basis_unresolved, false);
});

test('cleanRentPeriod is called with the leased SF, not the array index', () => {
  // `.map(cleanRentPeriod)` passes (element, INDEX, array) — the index would land
  // silently in the SF slot and make period 0 unconvertible and period 1 a 1-SF
  // building. Nothing errors; the numbers are just wrong.
  assert.ok(!/\.map\(cleanRentPeriod\)/.test(CODE),
    'rent_schedule must not map cleanRentPeriod bare — the array index would be read as leased SF');
  assert.match(CODE, /cleanRentPeriod\(p,\s*sf\)/);
});

// --- 6. the consumer contract is unchanged ----------------------------------

test('the six graded consumer keys keep their names and types', async () => {
  const r = await extract({
    tenant_name: 'Acme Dialysis LLC', leased_sf: 3800, lease_type: 'NNN',
    base_rent: { amount: 8464, basis: 'monthly' },
    lease_commencement: { date: '2020-06-01', precision: 'day' },
    lease_expiration: { date: '2030-05-31', precision: 'day' },
  });
  const t = r.tenant;
  for (const k of ['name', 'lease_commencement', 'lease_expiration', 'year1_rent', 'sf', 'lease_type']) {
    assert.ok(k in t, `graded key ${k} must still be emitted — the bake-off scores both_null on a renamed key`);
  }
  assert.equal(typeof t.name, 'string');
  assert.equal(typeof t.lease_commencement, 'string');
  assert.equal(typeof t.lease_expiration, 'string');
  assert.equal(typeof t.year1_rent, 'number');
  assert.equal(typeof t.sf, 'number');
  assert.equal(typeof t.lease_type, 'string');
  // And the evidence rides BESIDE them, never instead of them.
  assert.equal(t.base_rent.basis, 'monthly');
  assert.equal(t.lease_commencement_detail.precision, 'day');
});

// --- 7. the bake-off harness's own stub speaks the new shape ----------------

test('the harness stub emits the quoted shape and the real consumer resolves it', async () => {
  // ⚠️ PLUMBING PROOF, NOT A MEASUREMENT. The sandbox has no OCR engine, so
  // `--control self --engines tesseract` cannot run here. What CAN be proven is
  // that the harness's offline stub and the consumer still meet: a stub that
  // kept emitting the pre-EXT1 shape would exercise the legacy fallback on every
  // self-test and leave the production path untested by the one command that
  // runs without a model.
  const { stubExtractionAI, GRADED_FIELDS, assertGradedFieldsReadable } = await import('../scripts/ocr-bakeoff.mjs');
  const leaseText = [
    'TENANT: Blackwood Medical Partners LLC', 'RENTABLE SF: 14250',
    'BASE RENT: $412500', 'COMMENCEMENT: 2019-06-01', 'EXPIRATION: 2034-05-31',
    'LEASE TYPE: NNN',
  ].join('\n');
  const res = await extractTenantFromLease(
    { document_id: 'FIXTURE', raw_text: leaseText, pages: null },
    { invokeExtractionAI: stubExtractionAI },
  );
  assert.ok(res.ok, 'the stub must still drive a successful extraction');
  assert.deepEqual(assertGradedFieldsReadable(res.tenant), []);
  assert.equal(res.tenant.year1_rent, 412500);
  assert.equal(res.tenant.base_rent.basis, 'annual', 'the stub must quote a basis, not hand over a bare number');
  assert.equal(res.tenant.lease_commencement, '2019-06-01');
  assert.equal(res.tenant.lease_expiration, '2034-05-31');
  for (const f of GRADED_FIELDS) assert.notEqual(res.tenant[f.key], undefined, `${f.label} unreadable`);
});
