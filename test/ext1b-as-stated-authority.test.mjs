// ============================================================================
// EXT1b — the verbatim quote is the AUTHORITY; the model's label is the fallback
//
// THE MEASURED DEFECT (EXT1 floor re-run, `--control self --engines tesseract`,
// 2026-09-02). EXT1 made the model QUOTE instead of compute, and the run proved
// the quotes are reliably verbatim while the LABELS beside them are not:
//
//   doc 431 rent  `as_stated: "$8,796.50 per month"` with `basis:"per_sf_annual"`
//                 and `amount: 8.7965` — the quote says per month in plain
//                 English and the amount was divided by 1,000 ⇒ null year1_rent.
//   doc 336 rent  `as_stated` holds the rent SCHEDULE, `amount` is null, and the
//                 year-1 figure is the first `$` on the line.
//   doc 431 dates `as_stated: "March 15, 2021"` came back `precision:"formula"`
//                 on one run and `"day"` on the next — a plain calendar date,
//                 classified non-deterministically. That flip is the WHOLE
//                 self-disagreement on both date fields (80% / 80%).
//
// So the invariants are about WHO DECIDES, again — one layer further in than
// EXT1's. Three named rows are fixtures, and the negatives matter as much:
//   1. A quote that states the basis in English overrules the model's `basis`.
//   2. The model's amount must appear in the model's OWN quote, or the quote's
//      first `$` figure wins — the 1,000× scaling error has no tolerance that
//      distinguishes it from a different figure on the page.
//   3. A quote that IS a calendar date sets precision/date; a FORMULA is never
//      turned into one, including a formula that merely CONTAINS a date.
//   4. Where the quote is silent or ambiguous, the model's label stands.
//   5. The six consumer keys are untouched.
//
// Pure: a stub model, no DB, no network.
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  extractTenantFromLease, basisFromAsStated, amountFromAsStated,
  precisionFromAsStated, reconcileBaseRentWithQuote, reconcileQuotedDateWithQuote,
  resolveQuotedDate,
} from '../api/_shared/bov-extract.js';

const SRC = readFileSync(new URL('../api/_shared/bov-extract.js', import.meta.url), 'utf8');

/**
 * ⚠️ STRIP COMMENTS ONLY — DO NOT BLANK STRING LITERALS HERE.
 *
 * This file's source assertions are IDENTIFIER shapes (`reconcileBaseRentWithQuote(
 * normalizeBaseRent(`), which contain no literals, so blanking literals would be
 * inert; but the module's EXT1b header quotes `"$8,796.50 per month"`,
 * `per_sf_annual` and `March 15, 2021` at length while explaining the fix, so a
 * RAW-source grep finds the defect present in the sentence describing its removal
 * (A5c / N18 / B1). Comments go; literals stay, because a pattern that contains a
 * literal can never match literal-blanked source and passes its own mutation
 * (B6d-pri-reason).
 */
function codeOnly(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((l) => l.replace(/(^|\s)\/\/.*$/, '$1'))
    .join('\n');
}
const CODE = codeOnly(SRC);

/** Drive the REAL consumer with a stub model so the tenant shape is the real one. */
async function extract(model) {
  return extractTenantFromLease(
    { document_id: 'x', raw_text: 'lease', pages: null },
    { invokeExtractionAI: async () => ({ ok: true, data: { response: JSON.stringify(model) } }) },
  );
}

// --- 1. the three named rows, end to end through the real consumer ----------

test('doc 431 rent — the quote says "per month" and the model said per_sf_annual', async () => {
  const r = await extract({
    leased_sf: 1000,
    base_rent: { amount: 8.7965, basis: 'per_sf_annual', as_stated: '$8,796.50 per month' },
  });
  assert.equal(r.tenant.year1_rent, 105558,
    '$8,796.50 per month is $105,558/yr — the tesseract side returned null because the LABEL was wrong');
  assert.equal(r.tenant.rent_basis_unresolved, false);
  assert.equal(r.tenant.base_rent.basis, 'monthly');
  assert.equal(r.tenant.base_rent.basis_source, 'as_stated');
  assert.equal(r.tenant.base_rent.amount, 8796.5,
    '8.7965 is the same figure divided by 1,000 and appears nowhere in the quote');
  assert.equal(r.tenant.base_rent.amount_source, 'as_stated');
  assert.equal(r.tenant.base_rent.as_stated, '$8,796.50 per month', 'the verbatim figure is the audit trail');
});

test('doc 336 rent — as_stated holds the SCHEDULE and amount is null', async () => {
  const r = await extract({
    base_rent: {
      amount: null, basis: null,
      as_stated: 'Lease Years 1-5: $75,000.00 per year ($6,250.00 per month) and Lease Years 6-10: $82,500.00 per year',
    },
  });
  assert.equal(r.tenant.year1_rent, 75000, 'the year-1 figure is the FIRST $ in the quote');
  assert.equal(r.tenant.base_rent.basis, 'annual',
    'the basis belongs to the FIRST figure — the parenthetical monthly restatement is a different figure');
  assert.equal(r.tenant.base_rent.amount_source, 'as_stated');
});

test('doc 431 dates — a plain calendar date labelled "formula" resolves to a DAY', async () => {
  const r = await extract({ lease_commencement: { date: null, as_stated: 'March 15, 2021', precision: 'formula' } });
  assert.equal(r.tenant.lease_commencement, '2021-03-15');
  assert.equal(r.tenant.lease_commencement_detail.precision, 'day');
  assert.equal(r.tenant.lease_commencement_detail.precision_source, 'as_stated');
  assert.equal(r.tenant.lease_commencement_detail.as_stated, 'March 15, 2021', 'the verbatim text is never discarded');
});

test('doc 255 is UNCHANGED — EXT1b must not move the row EXT1 already fixed', async () => {
  const r = await extract({ base_rent: { amount: 8464, basis: 'monthly', as_stated: '$8,464.00 per month' } });
  assert.equal(r.tenant.year1_rent, 101568);
  assert.equal(r.tenant.base_rent.basis, 'monthly');
  assert.equal(r.tenant.base_rent.amount, 8464, 'the model AGREES with its own quote, so its amount stands');
  assert.equal(r.tenant.base_rent.amount_source, 'model');
});

// --- 2. basisFromAsStated: the window, and what silence means ---------------

test('basisFromAsStated reads the period the quote states', () => {
  assert.equal(basisFromAsStated('$8,796.50 per month'), 'monthly');
  assert.equal(basisFromAsStated('$132,430 per year'), 'annual');
  assert.equal(basisFromAsStated('$132,430 per annum'), 'annual');
  assert.equal(basisFromAsStated('$25.00 per square foot per year'), 'per_sf_annual');
  assert.equal(basisFromAsStated('$2.50/sf/mo'), 'per_sf_monthly');
});

test('⚠️ a per-SF quote with NO period stated returns null, never a guessed annual', () => {
  // "$12.50 per rentable square foot" is the EXT1 fixture. The convention that
  // per-SF means annual is a market convention, not something this lease said.
  assert.equal(basisFromAsStated('$12.50 per rentable square foot'), null);
});

test('⚠️ two periods in one window is AMBIGUOUS — the model label stands', async () => {
  assert.equal(basisFromAsStated('annual base rent of $105,558.00, payable in monthly installments of $8,796.50'), null,
    'a quote naming both an annual figure and a monthly one does not state ONE basis for one figure');
  const r = await extract({
    base_rent: {
      amount: 8796.5, basis: 'monthly',
      as_stated: 'annual base rent of $105,558.00, payable in monthly installments of $8,796.50',
    },
  });
  assert.equal(r.tenant.base_rent.basis_source, 'model', 'silence hands the decision back, it does not flip a coin');
  assert.equal(r.tenant.year1_rent, 105558);
});

test('⚠️ the basis window is read around the CHOSEN figure, not always the first', async () => {
  // A security deposit is the first $ on the line and is not the rent. The model
  // picked the right figure (it appears in its own quote), so the basis must be
  // read around THAT one — the deposit's neighbourhood says nothing about rent.
  const r = await extract({
    base_rent: {
      amount: 8796.5, basis: null,
      as_stated: 'a security deposit of $10,000 and base rent of $8,796.50 per month',
    },
  });
  assert.equal(r.tenant.base_rent.amount, 8796.5, 'the model named a figure present in its quote — it keeps it');
  assert.equal(r.tenant.base_rent.amount_source, 'model');
  assert.equal(r.tenant.base_rent.basis, 'monthly');
  assert.equal(r.tenant.year1_rent, 105558);
});

test('a quote with no basis words at all leaves the model alone', async () => {
  const r = await extract({ base_rent: { amount: 90000, basis: 'annual', as_stated: 'Base Rent: $90,000.00' } });
  assert.equal(r.tenant.base_rent.basis, 'annual');
  assert.equal(r.tenant.base_rent.basis_source, 'model');
  assert.equal(r.tenant.year1_rent, 90000);
});

// --- 3. amountFromAsStated: presence in the quote, never a tolerance --------

test('amountFromAsStated returns the FIRST $ figure, and null when there is none', () => {
  assert.equal(amountFromAsStated('Lease Years 1-5: $75,000.00 per year ($6,250.00 per month)'), 75000);
  assert.equal(amountFromAsStated('$8,796.50 per month'), 8796.5);
  assert.equal(amountFromAsStated('Lease Years 1-5: rent to be determined'), null);
  assert.equal(amountFromAsStated(null), null);
});

test('⚠️ a quote carrying NO $ figure cannot correct the model amount', async () => {
  const r = await extract({ base_rent: { amount: 8796.5, basis: 'monthly', as_stated: '8,796.50 per month' } });
  assert.equal(r.tenant.base_rent.amount, 8796.5);
  assert.equal(r.tenant.base_rent.amount_source, 'model');
  assert.equal(r.tenant.year1_rent, 105558);
});

// --- 4. precisionFromAsStated: a formula is NEVER resolved ------------------

test('precisionFromAsStated parses the date forms leases actually state', () => {
  assert.deepEqual(precisionFromAsStated('March 15, 2021'), { precision: 'day', date: '2021-03-15' });
  assert.deepEqual(precisionFromAsStated('1st day of April, 2000'), { precision: 'day', date: '2000-04-01' });
  assert.deepEqual(precisionFromAsStated('15 March 2021'), { precision: 'day', date: '2021-03-15' });
  assert.deepEqual(precisionFromAsStated('3/15/2021'), { precision: 'day', date: '2021-03-15' });
  assert.deepEqual(precisionFromAsStated('2021-03-15'), { precision: 'day', date: '2021-03-15' });
  assert.deepEqual(precisionFromAsStated('April 2000'), { precision: 'month', date: null });
  assert.deepEqual(precisionFromAsStated('on the 1st day of April, 2000.'), { precision: 'day', date: '2000-04-01' });
  assert.deepEqual(precisionFromAsStated('midnight on May 31, 2031'), { precision: 'day', date: '2031-05-31' });
});

test('⚠️ A FORMULA IS NEVER TURNED INTO A DATE — including one that CONTAINS a date', () => {
  assert.equal(precisionFromAsStated("Five days after Landlord's Work is Substantially Complete"), null);
  assert.equal(precisionFromAsStated('midnight on the last day of the 15th Lease Year'), null);
  assert.equal(precisionFromAsStated('ten (10) Lease Years from the Commencement Date'), null);
  // The dangerous one: a `.search()` for a date pattern would resolve this into a
  // day and re-commit the exact defect EXT1 removed.
  assert.equal(precisionFromAsStated('the earlier of March 1, 2021 or thirty days after Delivery'), null);
  assert.equal(precisionFromAsStated('2026-02-31'), null, 'a non-existent calendar day is not a date');
});

test('a formula-quoted date still resolves to NO date through the real consumer', async () => {
  const stated = "Five days after Landlord's Work is Substantially Complete";
  const r = await extract({ lease_commencement: { date: null, as_stated: stated, precision: 'formula' } });
  assert.equal(r.tenant.lease_commencement, '');
  assert.equal(r.tenant.lease_commencement_detail.precision, 'formula');
  assert.equal(r.tenant.lease_commencement_detail.as_stated, stated);
});

test('⚠️ the quote decides in BOTH directions — a month-only quote drops an invented day', () => {
  const d = reconcileQuotedDateWithQuote({ date: '2000-04-01', as_stated: 'April 2000', precision: 'day' });
  assert.equal(d.date, null, 'the lease states a month; the day was the model resolving in its head');
  assert.equal(d.precision, 'month');
  assert.equal(d.as_stated, 'April 2000');
});

test('a quote that AGREES with the model records the corroboration and changes nothing', () => {
  const d = reconcileQuotedDateWithQuote({ date: '2021-03-15', as_stated: 'March 15, 2021', precision: 'day' });
  assert.equal(d.date, '2021-03-15');
  assert.equal(d.precision, 'day');
  assert.equal(d.precision_source, 'as_stated');
});

test('reconcileQuotedDateWithQuote is a no-op with no quote to read', () => {
  const d = { date: null, as_stated: null, precision: null };
  assert.equal(reconcileQuotedDateWithQuote(d), d);
  assert.equal(reconcileQuotedDateWithQuote(null), null);
});

// --- 5. ONE date parser, reused by resolveQuotedDate ------------------------

test('the bare-string branch of resolveQuotedDate reads the SAME parser', () => {
  // EXT1 behaviour preserved exactly...
  assert.deepEqual(resolveQuotedDate('2020-01-01'), { date: '2020-01-01', as_stated: '2020-01-01', precision: 'day' });
  assert.equal(resolveQuotedDate('2026-02-31').date, null);
  assert.equal(resolveQuotedDate('2026-06').precision, 'month');
  assert.deepEqual(resolveQuotedDate(null), { date: null, as_stated: null, precision: null });
  // ...and a legacy record carrying a prose date now resolves instead of falling
  // through as unparseable, because there is ONE parser rather than two.
  assert.deepEqual(resolveQuotedDate('March 15, 2021'),
    { date: '2021-03-15', as_stated: 'March 15, 2021', precision: 'day' });
});

// --- 6. the rent SCHEDULE gets the same authority, row by row ---------------

test('a rent-schedule period reconciles against its own quote', async () => {
  const r = await extract({
    leased_sf: 1000,
    rent_schedule: [
      { label: 'Yrs 1-5', base_rent: { amount: 2.0, basis: 'per_sf_annual', as_stated: '$2,000.00 per month' }, status: 'Contracted' },
    ],
  });
  assert.equal(r.tenant.rent_schedule[0].annual_rent, 24000,
    'the same mislabelling defect appears row by row in a schedule');
});

// --- 7. structure: the reconcile is wired, and there is ONE date parser -----

test('the consumer reconciles the rent and BOTH dates against their quotes', () => {
  assert.match(CODE, /reconcileBaseRentWithQuote\(normalizeBaseRent\(/,
    'the rent quote must be the authority before annualizeRent runs');
  // ⚠️ EXT2 (2026-09-03) added a THIRD quoted date (`rent_commencement`), so a
  // COUNT of the wiring stopped describing the shipped code. The substance was
  // never the count — it is that EVERY quoted date goes through the reconcile;
  // one wired and one not is the silent half-fix. Assert that per NAMED date, so
  // the next date added is covered rather than turning this red.
  for (const field of ['lease_commencement', 'lease_expiration', 'rent_commencement']) {
    assert.ok(CODE.includes(`reconcileQuotedDateWithQuote(resolveQuotedDate(parsed.${field}))`),
      `${field} must be reconciled against its own quote`);
  }
});

test('there is exactly ONE date parser in the module', () => {
  const defs = CODE.match(/function parseStatedDate\b/g) || [];
  assert.equal(defs.length, 1, 'a second date parser beside this one is the normaliser drift the repo keeps paying for');
  assert.match(CODE, /parseStatedDate\(s\)/, 'resolveQuotedDate must route its bare-string branch through it');
});

// --- 8. the consumer contract is unchanged ---------------------------------

test('the six graded consumer keys keep their names and types', async () => {
  const r = await extract({
    tenant_name: 'Acme Dialysis LLC', leased_sf: 3800, lease_type: 'NNN',
    base_rent: { amount: 8.7965, basis: 'per_sf_annual', as_stated: '$8,796.50 per month' },
    lease_commencement: { date: null, as_stated: 'March 15, 2021', precision: 'formula' },
    lease_expiration: { date: null, as_stated: 'March 14, 2031', precision: 'formula' },
  });
  const t = r.tenant;
  for (const k of ['name', 'lease_commencement', 'lease_expiration', 'year1_rent', 'sf', 'lease_type']) {
    assert.ok(k in t, `graded key ${k} must still be emitted`);
  }
  assert.equal(typeof t.name, 'string');
  assert.equal(typeof t.lease_commencement, 'string');
  assert.equal(typeof t.lease_expiration, 'string');
  assert.equal(typeof t.year1_rent, 'number');
  assert.equal(typeof t.sf, 'number');
  assert.equal(typeof t.lease_type, 'string');
  assert.equal(t.lease_commencement, '2021-03-15');
  assert.equal(t.lease_expiration, '2031-03-14');
  assert.equal(t.year1_rent, 105558);
});

test('reconcileBaseRentWithQuote is a no-op on a rent with no quote', () => {
  assert.equal(reconcileBaseRentWithQuote(null), null);
  const b = reconcileBaseRentWithQuote({ amount: 412500, basis: 'annual', as_stated: null });
  assert.equal(b.basis, 'annual');
  assert.equal(b.amount, 412500);
  assert.equal(b.basis_source, 'model');
});
