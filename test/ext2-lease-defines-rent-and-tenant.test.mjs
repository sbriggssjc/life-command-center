// ============================================================================
// EXT2 — the LEASE defines base rent, year 1 and the tenant; code applies it
//
// THE MEASURED RESIDUE (EXT1b floor re-run, `--control self --engines tesseract`,
// 2026-09-02). EXT1 stopped the model computing and EXT1b made the verbatim quote
// outrank its labels — so rent and expiration self-agreement reached 100%. What
// was LEFT was neither arithmetic nor a label: the model chose a DIFFERENT LINE
// for the same field, and both lines were verbatim from the same lease.
//
//   doc 255  "$8,464.00 per month" (the total) vs "$7,445 per month plus $1,019
//            per month for equipment" (base plus a separately-stated equipment
//            rent). Arguably the second is the better BASE rent answer.
//   doc 299  "$7,725.33" vs "$7,373.17 per month" — two periods of one schedule.
//   doc 425/431  a DBA vs the registered entity; an individual plus two entities
//            all named as Tenant.
//
// Scott's decision (2026-09-03): there is NO house rule — each lease defines
// these terms itself, and the tenant is the legal entity counterparty to the
// Landlord, which IS the credit absent an express guaranty (a parent named in the
// lease is not liable without one). So the model quotes the lease's definition and
// the functions here apply it. The invariants are about WHO DECIDES, again:
//   1. A separately-stated component is NEVER summed into base rent; it rides as
//      its own row and as a SEPARATE `year1_total_rent`.
//   2. Year 1 is the schedule period at Rent Commencement, else period 1 (never an
//      OPTION period), else the single base rent — and the SOURCE is recorded.
//   3. A DBA is never the legal entity; every named counterparty is carried.
//   4. A parent NAMED without a guaranty can never become the credit entity, and
//      a guarantor NAME with no quoted CLAUSE does not move it either.
//   5. The six graded consumer keys keep their names and types.
//
// Pure: a stub model, no DB, no network.
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  extractTenantFromLease, normalizeAdditionalRent, resolveYear1Rent,
  resolveYear1TotalRent, resolveCreditEntity, splitDbaFromName, __private,
} from '../api/_shared/bov-extract.js';

const SRC = readFileSync(new URL('../api/_shared/bov-extract.js', import.meta.url), 'utf8');

/**
 * ⚠️ STRIP COMMENTS ONLY — DO NOT BLANK STRING LITERALS HERE.
 *
 * The module's EXT2 header quotes the defect at length ("$7,445 per month plus
 * $1,019 per month for equipment", `parent_mentioned`, `credit_entity`) while
 * explaining its removal, so a RAW-source grep finds every banned shape present in
 * the sentence describing the fix (A5c / N18 / B1). Comments go. Literals STAY:
 * the assertions below contain literals (`credit_entity_basis`,
 * `'express_guaranty'`), and a pattern containing a literal can never match
 * literal-blanked source — it would pass its own mutation (B6d-pri-reason).
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

// --- 1. doc 255: base rent is what the lease CALLS base rent ----------------

test('doc 255 — equipment rent is a SEPARATE row and never summed into base rent', async () => {
  const r = await extract({
    base_rent: {
      amount: 7445, basis: 'monthly', as_stated: '$7,445 per month',
      defined_term: 'Base Rent',
      definition_as_stated: 'Tenant shall pay Base Rent of $7,445 per month.',
    },
    additional_rent: [
      { label: 'Equipment Rent', amount: 1019, basis: 'monthly', as_stated: '$1,019 per month for equipment', kind: 'equipment' },
    ],
  });
  const t = r.tenant;
  assert.equal(t.year1_rent, 89340, 'base rent is 7,445 x 12 — the equipment rent is not part of it');
  assert.equal(t.year1_rent_source, 'base_rent');
  assert.equal(t.year1_total_rent, 101568, 'the total the other side quoted is reported BESIDE base, not instead of it');
  assert.equal(t.year1_total_rent_note, null);
  assert.equal(t.additional_rent.length, 1);
  assert.equal(t.additional_rent[0].annual_rent, 12228);
  assert.equal(t.additional_rent[0].kind, 'equipment');
  assert.equal(t.base_rent.defined_term, 'Base Rent', "the lease's OWN label for the figure is the evidence");
  assert.match(t.base_rent.definition_as_stated, /Base Rent of \$7,445/);
});

test("⚠️ the lease's definition is CARRIED, never interpreted — a different label is not a different field", async () => {
  const r = await extract({
    base_rent: {
      amount: 75000, basis: 'annual', as_stated: '$75,000.00 per year',
      defined_term: 'Minimum Annual Rent',
      definition_as_stated: 'Minimum Annual Rent shall be $75,000.00 per year.',
    },
  });
  assert.equal(r.tenant.year1_rent, 75000);
  assert.equal(r.tenant.base_rent.defined_term, 'Minimum Annual Rent');
});

test('⚠️ a pass-through (CAM / tax / insurance) is NOT added to the total', async () => {
  // These are reimbursements a landlord bills and collects; percentage rent is
  // contingent. Folding them in would restate a gross figure as base rent, which
  // is the doc-255 blend in a different costume.
  const r = await extract({
    base_rent: { amount: 7445, basis: 'monthly', as_stated: '$7,445 per month' },
    additional_rent: [
      { label: 'CAM', amount: 500, basis: 'monthly', as_stated: '$500 per month for CAM', kind: 'cam' },
      { label: 'Taxes', amount: 300, basis: 'monthly', as_stated: '$300 per month for taxes', kind: 'tax' },
    ],
  });
  assert.equal(r.tenant.year1_rent, 89340);
  assert.equal(r.tenant.year1_total_rent, null);
  assert.equal(r.tenant.year1_total_rent_note, 'no_additional_rent_stated',
    'the pass-throughs are carried on the row and are not part of the rent total');
  assert.equal(r.tenant.additional_rent.length, 2, 'they are still REPORTED — a reader needs them');
});

test('⚠️ a component we cannot annualize BLOCKS the total and NAMES itself', async () => {
  const r = await extract({
    base_rent: { amount: 7445, basis: 'monthly', as_stated: '$7,445 per month' },
    additional_rent: [
      { label: 'Equipment Rent', amount: 1019, basis: null, as_stated: 'equipment rent of $1,019', kind: 'equipment' },
    ],
  });
  assert.equal(r.tenant.year1_rent, 89340, 'the base rent still resolves');
  assert.equal(r.tenant.year1_total_rent, null);
  assert.equal(r.tenant.year1_total_rent_note, 'unresolved_component:Equipment Rent',
    'a bare null would wear the same label as "the lease states one rent" (P180)');
  assert.equal(r.tenant.additional_rent[0].rent_basis_unresolved, true);
});

test('a lease stating one rent says so, rather than reporting a silent null total', async () => {
  const r = await extract({ base_rent: { amount: 8464, basis: 'monthly', as_stated: '$8,464.00 per month' } });
  assert.equal(r.tenant.year1_total_rent, null);
  assert.equal(r.tenant.year1_total_rent_note, 'no_additional_rent_stated');
  assert.equal(r.tenant.additional_rent, null);
});

test('normalizeAdditionalRent reconciles each row against its OWN quote (EXT1b, row by row)', () => {
  const rows = normalizeAdditionalRent([
    { label: 'Equipment', amount: 1.019, basis: 'per_sf_annual', as_stated: '$1,019 per month for equipment', kind: 'equipment' },
    { label: 'Nothing stated' },
    'not an object',
  ], 1000);
  assert.equal(rows.length, 1, 'a row with neither a figure nor a quote is dropped');
  assert.equal(rows[0].amount, 1019, 'the model amount appears nowhere in its own quote');
  assert.equal(rows[0].amount_source, 'as_stated');
  assert.equal(rows[0].basis, 'monthly');
  assert.equal(rows[0].annual_rent, 12228);
});

test('⚠️ an unrecognised kind is UNSTATED — it never joins the total by default', async () => {
  const r = await extract({
    base_rent: { amount: 7445, basis: 'monthly', as_stated: '$7,445 per month' },
    additional_rent: [{ label: 'Furniture', amount: 100, basis: 'monthly', as_stated: '$100 per month', kind: 'furniture' }],
  });
  assert.equal(r.tenant.additional_rent[0].kind, null, 'the vocabulary is closed, like RENT_BASES');
  assert.equal(r.tenant.additional_rent[0].annual_rent, 1200, 'the row is still reported in full');
  assert.equal(r.tenant.year1_total_rent, null);
  assert.equal(r.tenant.year1_total_rent_note, 'no_additional_rent_stated',
    'a kind we do not recognise is not silently added to a figure a BOV will quote');
});

// --- 2. doc 299: which period is year 1 -------------------------------------

test('doc 299 — Rent Commencement inside period 1 selects period 1, and says so', async () => {
  const r = await extract({
    rent_commencement: { date: null, as_stated: 'June 1, 2020', precision: 'formula' },
    rent_schedule: [
      { label: 'Yrs 1-5', start_date: '2020-06-01', end_date: '2025-05-31', base_rent: { amount: 7373.17, basis: 'monthly', as_stated: '$7,373.17 per month' }, status: 'Contracted' },
      { label: 'Yrs 6-10', start_date: '2025-06-01', end_date: '2030-05-31', base_rent: { amount: 7725.33, basis: 'monthly', as_stated: '$7,725.33 per month' }, status: 'Contracted' },
    ],
  });
  assert.equal(r.tenant.year1_rent, 88478.04, 'the period in force at Rent Commencement is year 1');
  assert.equal(r.tenant.year1_rent_source, 'schedule_at_rent_commencement');
  assert.equal(r.tenant.rent_commencement_detail.date, '2020-06-01',
    'Rent Commencement is its OWN quoted date and gets the same EXT1b treatment');
});

test('doc 299 — with NO rent commencement stated it falls back to period 1 and records THAT', async () => {
  const r = await extract({
    rent_schedule: [
      { label: 'Yrs 1-5', start_date: '2020-06-01', end_date: '2025-05-31', base_rent: { amount: 7373.17, basis: 'monthly', as_stated: '$7,373.17 per month' }, status: 'Contracted' },
      { label: 'Yrs 6-10', start_date: '2025-06-01', end_date: '2030-05-31', base_rent: { amount: 7725.33, basis: 'monthly', as_stated: '$7,725.33 per month' }, status: 'Contracted' },
    ],
  });
  assert.equal(r.tenant.year1_rent, 88478.04);
  assert.equal(r.tenant.year1_rent_source, 'schedule_period_1',
    'the two sources must be distinguishable — one is a measurement, one is a fallback');
});

test('⚠️ WITH BOTH A BASE RENT AND A SCHEDULE, THE SCHEDULE DECIDES', async () => {
  // The decision, stated: year 1 is the schedule period in force at Rent
  // Commencement — the schedule is the lease's own statement of what is payable
  // when, and a single "base rent" figure quoted elsewhere may be any period of
  // it. Reversing this ordering is the doc-299 disagreement restored.
  const r = await extract({
    base_rent: { amount: 7725.33, basis: 'monthly', as_stated: '$7,725.33 per month' },
    rent_commencement: { date: '2020-06-01', as_stated: 'June 1, 2020', precision: 'day' },
    rent_schedule: [
      { label: 'Yrs 1-5', start_date: '2020-06-01', end_date: '2025-05-31', base_rent: { amount: 7373.17, basis: 'monthly', as_stated: '$7,373.17 per month' }, status: 'Contracted' },
      { label: 'Yrs 6-10', start_date: '2025-06-01', end_date: '2030-05-31', base_rent: { amount: 7725.33, basis: 'monthly', as_stated: '$7,725.33 per month' }, status: 'Contracted' },
    ],
  });
  assert.equal(r.tenant.year1_rent, 88478.04, 'the base_rent quote is period TWO of this schedule');
  assert.equal(r.tenant.year1_rent_source, 'schedule_at_rent_commencement');
  assert.equal(r.tenant.base_rent.amount, 7725.33, 'the quote it came from is still carried as evidence');
});

test('⚠️ an OPTION period is NEVER year 1', () => {
  const out = resolveYear1Rent({
    rentSchedule: [
      { label: 'Option 1', start_date: '2020-01-01', end_date: '2024-12-31', annual_rent: 30000, status: 'Option' },
      { label: 'Yrs 1-5', start_date: '2020-01-01', end_date: '2024-12-31', annual_rent: 24000, status: 'Contracted' },
    ],
    rentCommencement: { date: '2020-01-01' },
  });
  assert.equal(out.year1_rent, 24000, 'rent for a term nobody has exercised is not year-1 rent');
  assert.equal(out.year1_rent_source, 'schedule_at_rent_commencement');
});

test('⚠️ a chosen period with no usable figure falls through to the base rent, not to null', () => {
  const out = resolveYear1Rent({
    baseRent: { amount: 8464, basis: 'monthly', as_stated: '$8,464.00 per month' },
    rentSchedule: [{ label: 'Yrs 1-5', start_date: '2020-01-01', annual_rent: null, status: 'Contracted' }],
    rentCommencement: { date: '2020-06-01' },
  });
  assert.equal(out.year1_rent, 101568, 'a schedule row we could not convert is a reason to prefer the other quote');
  assert.equal(out.year1_rent_source, 'base_rent');
});

test('a pre-EXT1 record with only a bare number still rides through, and names itself', async () => {
  const r = await extract({ year1_rent: 412500, lease_commencement: '2020-01-01' });
  assert.equal(r.tenant.year1_rent, 412500, 'a record written before EXT1 must not become null');
  assert.equal(r.tenant.year1_rent_source, 'model_year1_rent');
});

test('an unconvertible base rent reports no year-1 figure AND no source', async () => {
  const r = await extract({ base_rent: { amount: 12.5, basis: 'per_sf_annual', as_stated: '$12.50 per square foot per year' } });
  assert.equal(r.tenant.year1_rent, null, 'a per-SF rent with no leased SF cannot be annualized');
  assert.equal(r.tenant.year1_rent_source, null, 'a source for a figure that does not exist would be a lie');
  assert.equal(r.tenant.rent_basis_unresolved, true);
});

test('abatement is quoted verbatim and NEVER netted out of the rent', async () => {
  const r = await extract({
    base_rent: { amount: 7445, basis: 'monthly', as_stated: '$7,445 per month' },
    abatement: { as_stated: 'Base Rent shall be abated for the first three (3) months of the Term.' },
  });
  assert.equal(r.tenant.year1_rent, 89340, 'twelve months of base rent — the abatement is a separate fact');
  assert.match(r.tenant.abatement.as_stated, /abated for the first three/);
});

test('a bare-string abatement from a model that ignored the shape is still kept', async () => {
  const r = await extract({ abatement: 'first 3 months free' });
  assert.deepEqual(r.tenant.abatement, { as_stated: 'first 3 months free' },
    'losing the quote is the only real failure here');
  const empty = await extract({ abatement: { as_stated: '' } });
  assert.equal(empty.tenant.abatement, null);
});

// --- 3. doc 425 / 431: who the tenant is ------------------------------------

test('doc 425 — a DBA is the trade name, never the legal entity', async () => {
  const r = await extract({
    tenant_legal_entity: 'Acme Health Services, LLC',
    tenant_dba: 'Riverside Dialysis',
  });
  assert.equal(r.tenant.name, 'Acme Health Services, LLC');
  assert.equal(r.tenant.tenant_legal_entity, 'Acme Health Services, LLC');
  assert.equal(r.tenant.tenant_dba, 'Riverside Dialysis');
  assert.equal(r.tenant.credit_entity, 'Acme Health Services, LLC');
  assert.equal(r.tenant.credit_entity_basis, 'tenant_is_counterparty');
});

test('doc 425 — a DBA arriving INSIDE the legal-entity string is split out of it', async () => {
  const r = await extract({ tenant_legal_entity: 'Acme Health Services, LLC d/b/a Riverside Dialysis' });
  assert.equal(r.tenant.name, 'Acme Health Services, LLC',
    'the party that signs and is liable is the entity, not the trade name it operates under');
  assert.equal(r.tenant.tenant_dba, 'Riverside Dialysis');
  assert.equal(r.tenant.credit_entity, 'Acme Health Services, LLC');
});

test('splitDbaFromName splits only on a stated marker, and never infers one', () => {
  assert.deepEqual(splitDbaFromName('Acme Health Services, LLC d/b/a Riverside Dialysis'),
    { legal: 'Acme Health Services, LLC', dba: 'Riverside Dialysis' });
  assert.deepEqual(splitDbaFromName('Acme Health Services LLC dba Riverside'),
    { legal: 'Acme Health Services LLC', dba: 'Riverside' });
  assert.deepEqual(splitDbaFromName('Acme Health Services, LLC'),
    { legal: 'Acme Health Services, LLC', dba: null },
    'a plain entity name has no trade name hiding in it');
  assert.deepEqual(splitDbaFromName(null), { legal: null, dba: null });
});

test('doc 431 — an individual plus two entities: the first is the tenant, the rest are co-tenants', async () => {
  const r = await extract({
    tenant_legal_entity: 'John Q. Smith',
    co_tenants: ['Smith Nephrology, P.A.', 'Riverside Dialysis Partners, LLC', 'John Q. Smith'],
  });
  assert.equal(r.tenant.tenant_legal_entity, 'John Q. Smith');
  assert.deepEqual(r.tenant.co_tenants, ['Smith Nephrology, P.A.', 'Riverside Dialysis Partners, LLC'],
    'every named counterparty is carried; the tenant is not repeated among them');
  assert.equal(r.tenant.credit_entity, 'John Q. Smith');
  assert.equal(r.tenant.credit_entity_basis, 'tenant_is_counterparty');
});

test('⚠️ A PARENT NAMED IN THE LEASE IS NOT THE CREDIT — it can never become credit_entity', async () => {
  const r = await extract({
    tenant_legal_entity: 'Acme Dialysis of Illinois, LLC',
    parent_mentioned: 'Acme Healthcare Holdings, Inc.',
  });
  assert.equal(r.tenant.credit_entity, 'Acme Dialysis of Illinois, LLC',
    'a parent is not liable for a subsidiary without express authorization — the credit is the subsidiary');
  assert.equal(r.tenant.credit_entity_basis, 'tenant_is_counterparty');
  assert.equal(r.tenant.parent_mentioned, 'Acme Healthcare Holdings, Inc.',
    'it is carried for a reader — the credit may be a subsidiary of unknown size, and saying so is the answer');
});

test('an EXPRESS guaranty — quoted clause and all — moves the credit, and says why', async () => {
  const r = await extract({
    tenant_legal_entity: 'Acme Dialysis of Illinois, LLC',
    guarantor: 'Acme Healthcare Holdings, Inc.',
    guaranty_as_stated: 'Guarantor unconditionally guarantees all obligations of Tenant under this Lease.',
  });
  assert.equal(r.tenant.credit_entity, 'Acme Healthcare Holdings, Inc.');
  assert.equal(r.tenant.credit_entity_basis, 'express_guaranty');
  assert.match(r.tenant.guaranty_as_stated, /unconditionally guarantees/);
});

test('⚠️ a guarantor NAME with no quoted CLAUSE does not move the credit', async () => {
  const r = await extract({
    tenant_legal_entity: 'Acme Dialysis of Illinois, LLC',
    guarantor: 'Acme Healthcare Holdings, Inc.',
  });
  assert.equal(r.tenant.credit_entity, 'Acme Dialysis of Illinois, LLC',
    'the model naming a guarantor is a claim; the quoted clause is the evidence');
  assert.equal(r.tenant.credit_entity_basis, 'tenant_is_counterparty');
  assert.equal(r.tenant.guarantor, 'Acme Healthcare Holdings, Inc.', 'the claim is still reported');
});

test('a bare-string co_tenants from a model that ignored the shape is still carried', () => {
  const c = resolveCreditEntity({ tenant_legal_entity: 'Acme LLC', co_tenants: 'Smith Nephrology, P.A.' });
  assert.deepEqual(c.co_tenants, ['Smith Nephrology, P.A.'],
    'a dropped counterparty is a party to the lease nobody can see');
});

test('resolveCreditEntity reads tenant_name as the one-release alias', () => {
  const c = resolveCreditEntity({ tenant_name: 'Legacy Tenant LLC' });
  assert.equal(c.tenant_legal_entity, 'Legacy Tenant LLC');
  assert.equal(c.credit_entity, 'Legacy Tenant LLC');
  assert.equal(c.credit_entity_basis, 'tenant_is_counterparty');
});

test('a lease naming no tenant reports no credit entity and no basis', () => {
  const c = resolveCreditEntity({});
  assert.equal(c.credit_entity, null);
  assert.equal(c.credit_entity_basis, null, 'a basis for a party we do not have would be a fabricated claim');
});

// --- 4. resolveYear1TotalRent, on its own -----------------------------------

test('resolveYear1TotalRent explains every null it returns', () => {
  assert.deepEqual(resolveYear1TotalRent(89340, []),
    { year1_total_rent: null, year1_total_rent_note: 'no_additional_rent_stated' });
  assert.deepEqual(resolveYear1TotalRent(null, [{ kind: 'equipment', annual_rent: 12228, label: 'Equipment' }]),
    { year1_total_rent: null, year1_total_rent_note: 'year1_rent_unresolved' });
  assert.deepEqual(resolveYear1TotalRent(89340, [{ kind: 'equipment', annual_rent: 12228, label: 'Equipment' }]),
    { year1_total_rent: 101568, year1_total_rent_note: null });
});

// --- 5. the prompt asks for the DEFINITION, and still never for an answer ----

test('the lease prompt asks for the lease\'s OWN label and the separately-stated rows', () => {
  const p = __private.leasePrompt('LEASE TEXT');
  // ⚠️ ANCHOR ON THE SCHEMA LINE, NOT ON THE KEY ANYWHERE IN THE PROMPT. The
  // prompt's own RULES quote every key by name while explaining it ('row of
  // "additional_rent" with its own quote'), so a bare /"additional_rent"/ is
  // satisfied by the sentence describing the field and stays GREEN when the field
  // is deleted from the contract — the same "the prose satisfies the detector"
  // defect this repo keeps paying for, found here by the mutation pass. A schema
  // line STARTS with the key; prose carries it mid-sentence.
  // These two are sub-keys INSIDE the one-line base_rent shape, so there is no
  // line start to anchor on — `": string"` is what the prose ('into
  // "defined_term"') can never carry.
  assert.match(p, /"defined_term": string/, "the lease's own label for the figure is what makes 'base rent' answerable");
  assert.match(p, /"definition_as_stated": string/);
  assert.match(p, /\n\s*"additional_rent": \[/);
  assert.match(p, /\n\s*"rent_commencement": \{/, 'year 1 is the period at Rent Commencement, which is not the lease commencement');
  assert.match(p, /\n\s*"abatement": \{/);
  assert.match(p, /\n\s*"tenant_legal_entity": string/);
  assert.match(p, /\n\s*"co_tenants": \[/);
  assert.match(p, /\n\s*"guaranty_as_stated": string/);
  assert.match(p, /\n\s*"parent_mentioned": string/);
  assert.ok(!/"year1_rent"/.test(p),
    'EXT1 stands — asking the model for year1_rent is asking it to annualize');
  assert.ok(!/"year1_total_rent"/.test(p),
    'the total is OURS to add; asking the model for it is asking it to sum, which is the doc-255 defect');
});

// --- 6. structure: one owner per decision, nothing re-implemented -----------

test('the consumer routes year-1 rent, the total and the credit through the resolvers', () => {
  assert.match(CODE, /resolveYear1Rent\(\{/, 'year-1 selection has ONE owner');
  assert.match(CODE, /resolveYear1TotalRent\(year1Rent, additionalRent\)/);
  assert.match(CODE, /resolveCreditEntity\(parsed\)/);
  assert.match(CODE, /name: credit\.tenant_legal_entity/,
    'the graded tenant name must be the legal entity the resolver decided, not the raw model field');
});

test('⚠️ there is no SECOND date, basis or amount parser — EXT1b owns those', () => {
  assert.equal((CODE.match(/function parseStatedDate\b/g) || []).length, 1);
  // ONE declaration each — an unexported second copy beside the export is the
  // shape that silently wins in a shared module, so count EVERY declaration.
  assert.equal((CODE.match(/function basisFromAsStated\b/g) || []).length, 1);
  assert.equal((CODE.match(/function amountFromAsStated\b/g) || []).length, 1);
  assert.equal((CODE.match(/function annualizeRent\b/g) || []).length, 1);
  // The additional-rent rows must reuse the SAME reconcile + annualizer as base
  // rent; a private copy is the normaliser drift this repo keeps paying for.
  assert.match(CODE, /normalizeAdditionalRent[\s\S]{0,900}?reconcileBaseRentWithQuote\(normalizeBaseRent\(row\)\)/);
  assert.match(CODE, /normalizeAdditionalRent[\s\S]{0,1200}?annualizeRent\(baseRent, leasedSf\)/);
});

test('⚠️ parent_mentioned is never assigned to credit_entity anywhere in the module', () => {
  assert.ok(!/credit_entity:\s*[^,\n]*parent/i.test(CODE),
    'the whole point of carrying a parent separately is that it can never become the credit');
});

// --- 7. the consumer contract is unchanged ---------------------------------

test('the six graded consumer keys keep their names and types', async () => {
  const r = await extract({
    tenant_legal_entity: 'Acme Dialysis of Illinois, LLC', leased_sf: 3800, lease_type: 'NNN',
    base_rent: { amount: 7445, basis: 'monthly', as_stated: '$7,445 per month', defined_term: 'Base Rent' },
    additional_rent: [{ label: 'Equipment Rent', amount: 1019, basis: 'monthly', as_stated: '$1,019 per month', kind: 'equipment' }],
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
  assert.equal(t.name, 'Acme Dialysis of Illinois, LLC');
  assert.equal(t.lease_commencement, '2021-03-15');
  assert.equal(t.lease_expiration, '2031-03-14');
  assert.equal(t.year1_rent, 89340, 'the graded field is BASE rent — the total rides beside it');
  assert.equal(t.year1_total_rent, 101568);
});
