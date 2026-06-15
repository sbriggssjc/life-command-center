// Stage B Unit 1 — lease extractor: the dual-purpose core (attach-resolver +
// factual enricher). Pure normalize/plan + the resolver (proves an in-file
// address resolves the DaVita-ambiguity that path-anchor can't) + the deps-
// injected writer (provenance-first, guarantor entity, TI rows).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
process.env.OPS_SUPABASE_URL = 'https://ops.test.local';
process.env.OPS_SUPABASE_KEY = 'k';
process.env.DIA_SUPABASE_URL = 'https://dia.test.local';
process.env.DIA_SUPABASE_KEY = 'k';
process.env.GOV_SUPABASE_URL = 'https://gov.test.local';
process.env.GOV_SUPABASE_KEY = 'k';
process.env.SHAREPOINT_FETCH_URL = 'https://pa.test.local/fetch';

import {
  buildLeaseExtractionPrompt, normalizeLeaseExtraction, planLeaseWrites,
  resolveAttachFromExtraction, applyLeaseEnrichment, LEASE_FIELD_MAP,
  extractLeaseDoc, planExpenseFinancials, attachLeaseDoc, leaseValuesEqual, runLeaseExtraction,
  guarantorContradictsTenant,
} from '../api/_handlers/lease-extractor.js';

const RAW = {
  property_identity: { address: '4601 Madison Ave', city: 'Kansas City', state: 'mo', tenant: 'DaVita' },
  factual: {
    tenant: 'DaVita Inc', guarantor: 'Total Renal Care, Inc.', annual_rent: '$1,250,000',
    rent_psf: '25.00', leased_sf: '50,000', lease_structure: 'NNN', firm_term_years: '10',
    commencement_date: '2021-06-01', expiration_date: '2036-05-31', renewal_options: '4x5yr',
  },
  ti_schedule: [
    { schedule_year: 1, period_start: '2021-06-01', period_end: '2022-05-31', ti_excess_amount: '$100,000', cumulative_ti: '$100,000', burn_off_date: '2031-05-31' },
    { schedule_year: 2, ti_excess_amount: null, cumulative_ti: null, burn_off_date: null }, // dropped (all null)
  ],
  expense_schedule: [{ year: 2022, category: 'CAM', amount: '$80,000' }],
};

describe('lease extractor — prompt + normalize', () => {
  it('prompt asks for identity + factual + TI, never a sale price/cap', () => {
    const p = buildLeaseExtractionPrompt();
    assert.match(p, /property_identity/);
    assert.match(p, /ti_schedule/);
    assert.match(p, /guarantor/);
    assert.match(p, /Do NOT invent a sale price or cap rate/);
  });

  it('coerces $/commas/dates, uppercases state, drops empty TI rows', () => {
    const n = normalizeLeaseExtraction(RAW);
    assert.equal(n.property_identity.state, 'MO');
    assert.equal(n.factual.annual_rent, 1250000);
    assert.equal(n.factual.rent_psf, 25);
    assert.equal(n.factual.leased_sf, 50000);
    assert.equal(n.factual.guarantor, 'Total Renal Care, Inc.');
    assert.equal(n.factual.commencement_date, '2021-06-01');
    assert.equal(n.ti_schedule.length, 1);          // the all-null row dropped
    assert.equal(n.ti_schedule[0].ti_excess_amount, 100000);
    assert.equal(n.expense_schedule[0].amount, 80000);
  });

  it('tolerates a missing/empty extraction', () => {
    const n = normalizeLeaseExtraction(null);
    assert.deepEqual(n.factual, {});
    assert.deepEqual(n.ti_schedule, []);
  });
});

describe('lease extractor — domain write plan', () => {
  it('maps to gov.leases columns (tenant→tenant_agency, rent_psf→rent_psf)', () => {
    const plan = planLeaseWrites('government', normalizeLeaseExtraction(RAW));
    assert.equal(plan.table, 'leases');
    assert.equal(plan.leaseFields.tenant_agency, 'DaVita Inc');
    assert.equal(plan.leaseFields.annual_rent, 1250000);
    assert.equal(plan.leaseFields.rent_psf, 25);
    assert.equal(plan.leaseFields.guarantor, 'Total Renal Care, Inc.');
    assert.equal(plan.guarantor, 'Total Renal Care, Inc.');
    assert.equal(plan.tiRows[0].source, 'folder_feed_lease');
    assert.deepEqual(plan.warnings, []);             // no factual field is a reported field
  });

  it('maps to dia.leases columns (rent_psf→rent_per_sf, leased_sf→leased_area, structure→expense_structure)', () => {
    const plan = planLeaseWrites('dialysis', normalizeLeaseExtraction(RAW));
    assert.equal(plan.leaseFields.tenant, 'DaVita Inc');
    assert.equal(plan.leaseFields.rent_per_sf, 25);
    assert.equal(plan.leaseFields.leased_area, 50000);
    assert.equal(plan.leaseFields.expense_structure, 'NNN');  // lease_structure → expense_structure
    assert.ok(!('rent_psf' in plan.leaseFields));
  });
});

describe('lease extractor — expense_schedule → property_financials (#64 leg, boundary-safe)', () => {
  it('aggregates the expense schedule by fiscal year, maps categories, preserves line_items', () => {
    const n = normalizeLeaseExtraction({
      ...RAW,
      expense_schedule: [
        { year: 2022, category: 'CAM', amount: '$80,000' },
        { year: 2022, category: 'Real Estate Taxes', amount: '$50,000' },
        { year: 2022, category: 'Insurance', amount: '$10,000' },
        { year: 2023, category: 'CAM', amount: '$82,000' },
        { year: 1700, category: 'junk', amount: '$1' },   // out-of-range year dropped
      ],
    });
    const rows = planExpenseFinancials(n);
    assert.equal(rows.length, 2);
    const y22 = rows.find(r => r.fiscal_year === 2022);
    assert.equal(y22.cam, 80000);
    assert.equal(y22.taxes, 50000);
    assert.equal(y22.insurance, 10000);
    assert.equal(y22.operating_expenses, 140000);          // sum of all categories
    assert.equal(y22.line_items.source, 'folder_feed_lease');
    assert.equal(y22.line_items.entries.length, 3);
    assert.ok(rows.every(r => r.fiscal_year >= 2022));      // junk year dropped
  });

  it('empty / no expense schedule → no rows (the leg is a no-op)', () => {
    assert.deepEqual(planExpenseFinancials(normalizeLeaseExtraction({ ...RAW, expense_schedule: [] })), []);
    assert.deepEqual(planExpenseFinancials({}), []);
  });

  it('applyLeaseEnrichment writes the financial rows via the dep and counts them', async () => {
    let finCall = null;
    const deps = {
      mergeField: async () => ({ decision: 'write' }),
      patchLease: async () => ({ ok: true }),
      insertTiRows: async (a) => ({ ok: true, count: a.rows.length }),
      insertPropertyFinancials: async (a) => { finCall = a; return { ok: true, count: a.rows.length }; },
      ensureGuarantorEntity: async () => ({ entity_id: 'g1', edge_ok: true }),
    };
    const n = normalizeLeaseExtraction(RAW);
    const out = await applyLeaseEnrichment({ domain: 'government', propertyId: 555, leaseId: 1, normalized: n }, deps);
    assert.equal(out.ok, true);
    assert.equal(out.financial_rows, 1);                    // one FY in the RAW schedule
    assert.equal(finCall.rows[0].fiscal_year, 2022);
    assert.equal(finCall.rows[0].cam, 80000);
  });
});

describe('lease extractor — attach-resolver (closes the DaVita-ambiguity gap)', () => {
  // Path-anchor on tenant+city ("DaVita"+"Kansas City") returns 13 properties →
  // ambiguous. The IN-FILE ADDRESS resolves exactly one — that's the unlock.
  const onlyAddressMatches = async (domain, address /* state, city, tenant */) => {
    if (domain === 'dialysis' && /4601 madison/i.test(address)) {
      return { property_id: 30441, address: '4601 Madison Ave', confidence: 0.95, reason: 'canonical' };
    }
    return null;
  };

  it('resolves a single property from the in-file address', async () => {
    const n = normalizeLeaseExtraction(RAW);
    const res = await resolveAttachFromExtraction(n, { matchAgainstDomain: onlyAddressMatches });
    assert.equal(res.status, 'matched');
    assert.equal(res.domain, 'dialysis');
    assert.equal(res.property_id, 30441);
    assert.ok(res.confidence >= 0.85);
  });

  it('routes to review when the address hits BOTH domains', async () => {
    const n = normalizeLeaseExtraction(RAW);
    const both = async () => ({ property_id: 1, address: 'x', confidence: 0.9 });
    const res = await resolveAttachFromExtraction(n, { matchAgainstDomain: both });
    assert.equal(res.status, 'review_required');
  });

  it('unmatched (no in-file address) → terminal, never a guess', async () => {
    const n = normalizeLeaseExtraction({ property_identity: { tenant: 'DaVita' }, factual: {} });
    const res = await resolveAttachFromExtraction(n, { matchAgainstDomain: async () => ({ property_id: 9 }) });
    assert.equal(res.status, 'unmatched');
    assert.equal(res.reason, 'no_in_file_address');
  });
});

describe('lease extractor — writer (provenance-first, guarantor entity, TI)', () => {
  it('fills fields via merge_field, mints the guarantor entity, inserts TI, attaches the doc', async () => {
    const calls = { merge: [], patch: null, ti: null, guarantor: null, doc: null };
    const deps = {
      mergeField: async (a) => { calls.merge.push(a.field); return { decision: 'write' }; },
      patchLease: async (a) => { calls.patch = a; return { ok: true }; },
      insertTiRows: async (a) => { calls.ti = a; return { ok: true, count: a.rows.length }; },
      ensureGuarantorEntity: async (a) => { calls.guarantor = a; return { entity_id: 'ent-guar-1' }; },
      attachDoc: async (a) => { calls.doc = a; return { document_id: 9001 }; },
    };
    const n = normalizeLeaseExtraction(RAW);
    const out = await applyLeaseEnrichment(
      { domain: 'dialysis', propertyId: 30441, leaseId: 7001, normalized: n,
        doc: { fileName: 'DaVita KCMO Lease.pdf', sourceUrl: '/sites/x/PROPERTIES/.../lease.pdf' } },
      deps,
    );
    assert.equal(out.ok, true);
    assert.ok(out.fields_filled > 0);
    assert.equal(out.guarantor_entity_id, 'ent-guar-1');
    assert.equal(out.ti_rows, 1);
    assert.equal(out.document_id, 9001);
    // provenance was consulted per field BEFORE the UPDATE.
    assert.ok(calls.merge.includes('annual_rent'));
    assert.ok(calls.merge.includes('guarantor'));
    assert.equal(calls.guarantor.name, 'Total Renal Care, Inc.');  // guarantor entity from the credit parent
    assert.equal(calls.patch.fields.rent_per_sf, 25);              // dia column mapping reached the writer
  });

  it('reports the guaranteed_by edge outcome (edge_ok=true → no warning)', async () => {
    const deps = {
      mergeField: async () => ({ decision: 'write' }),
      patchLease: async () => ({ ok: true }),
      insertTiRows: async (a) => ({ ok: true, count: a.rows.length }),
      ensureGuarantorEntity: async () => ({ entity_id: 'g1', asset_entity_id: 'a1', edge_ok: true }),
    };
    const n = normalizeLeaseExtraction(RAW);
    const out = await applyLeaseEnrichment({ domain: 'government', propertyId: 555, leaseId: 1, normalized: n }, deps);
    assert.equal(out.guarantor_entity_id, 'g1');
    assert.equal(out.guaranteed_by_edge, true);
    assert.ok(!out.warnings.some(w => /edge/.test(w)));
  });

  it('surfaces a warning (never silently drops) when the guaranteed_by edge cannot be written', async () => {
    const deps = {
      mergeField: async () => ({ decision: 'write' }),
      patchLease: async () => ({ ok: true }),
      insertTiRows: async (a) => ({ ok: true, count: a.rows.length }),
      ensureGuarantorEntity: async () => ({ entity_id: 'g1', asset_entity_id: 'a1', edge_ok: false, warning: 'guaranteed_by_edge_write_failed:400' }),
    };
    const n = normalizeLeaseExtraction(RAW);
    const out = await applyLeaseEnrichment({ domain: 'government', propertyId: 555, leaseId: 1, normalized: n }, deps);
    assert.equal(out.guarantor_entity_id, 'g1');           // entity still minted
    assert.equal(out.guaranteed_by_edge, false);           // but the graph edge is incomplete
    assert.ok(out.warnings.some(w => /guaranteed_by_edge_write_failed/.test(w)));
  });

  it('TRUE fill-blanks: NEVER overwrites a populated field; routes the disagreement to the Decision Center', async () => {
    // The lease-14365 clobber: curated tenant_agency + annual_rent are POPULATED
    // and DISAGREE with the doc; genuinely-NULL fields are blank. The writer must
    // fill ONLY the blanks and route the two disagreements to a conflict — never
    // PATCH the populated columns.
    const calls = { patch: null, conflicts: [], merged: [] };
    const deps = {
      getLeaseRow: async () => ({
        tenant_agency: 'DaVita (Covington Mill Dialysis)',  // populated + disagrees
        annual_rent: 193330.00,                              // populated + disagrees (193329.48)
        guarantor: null, rent_psf: null, lease_structure: null, renewal_options: null,
        firm_term_years: null, total_term_years: null, commencement_date: null, expiration_date: null,
      }),
      mergeField: async (a) => { calls.merged.push(a.field); return { decision: 'write' }; },
      recordConflict: async (a) => { calls.conflicts.push(a.field); return { ok: true }; },
      patchLease: async (a) => { calls.patch = a; return { ok: true }; },
      insertTiRows: async (a) => ({ ok: true, count: a.rows.length }),
      ensureGuarantorEntity: async () => ({ entity_id: 'g1', edge_ok: true }),
    };
    const n = normalizeLeaseExtraction(RAW);   // tenant 'DaVita Inc', annual_rent 1,250,000
    const out = await applyLeaseEnrichment({ domain: 'government', propertyId: 555, leaseId: 1, normalized: n }, deps);
    assert.equal(out.ok, true);
    // The two populated disagreements were routed to conflict, NOT written.
    assert.ok(calls.conflicts.includes('tenant_agency'), 'tenant disagreement → conflict');
    assert.ok(calls.conflicts.includes('annual_rent'), 'rent disagreement → conflict');
    assert.equal(out.conflicts, 2);
    assert.ok(!('tenant_agency' in (calls.patch?.fields || {})), 'populated tenant NEVER patched');
    assert.ok(!('annual_rent' in (calls.patch?.fields || {})), 'populated rent NEVER patched');
    // The genuinely-NULL fields filled (e.g. guarantor) with provenance recorded.
    assert.ok('guarantor' in (calls.patch?.fields || {}), 'blank guarantor filled');
    assert.ok(calls.merged.includes('guarantor'));
    assert.ok(out.fields_filled >= 1);
  });

  it('a populated field that AGREES with the doc is a no-op (no conflict, no patch)', async () => {
    const calls = { conflicts: 0, patch: null };
    const deps = {
      getLeaseRow: async () => ({ annual_rent: 1250000, tenant_agency: 'DaVita Inc' }),  // both equal the doc
      mergeField: async () => ({ decision: 'write' }),
      recordConflict: async () => { calls.conflicts++; return { ok: true }; },
      patchLease: async (a) => { calls.patch = a; return { ok: true }; },
      insertTiRows: async (a) => ({ ok: true, count: a.rows.length }),
      ensureGuarantorEntity: async () => ({ entity_id: 'g1', edge_ok: true }),
    };
    const n = normalizeLeaseExtraction({ ...RAW, factual: { tenant: 'DaVita Inc', annual_rent: 1250000 }, ti_schedule: [], expense_schedule: [] });
    const out = await applyLeaseEnrichment({ domain: 'government', propertyId: 555, leaseId: 1, normalized: n }, deps);
    assert.equal(out.conflicts, 0);
    assert.deepEqual(calls.patch?.fields || {}, {});  // nothing to write
  });
});

describe('lease extractor — guarantorContradictsTenant (multi-tenant cross-attribution guard)', () => {
  it('flags the real bug: a Hertz tenant "guaranteed by" Total Renal Care (DIA fallback, no parents)', () => {
    assert.equal(guarantorContradictsTenant({
      tenant: 'THE HERTZ CORPORATION', guarantor: 'Total Renal Care, Inc.',
    }), true);
  });
  it('does NOT flag a normal dialysis lease (DaVita tenant + Total Renal Care guarantor — same family)', () => {
    assert.equal(guarantorContradictsTenant({
      tenant: 'DaVita Inc', guarantor: 'Total Renal Care, Inc.',
    }), false);
  });
  it('same resolved operator parent → consistent (operating sub + its credit parent)', () => {
    assert.equal(guarantorContradictsTenant({
      tenant: 'Operating Sub LLC', guarantor: 'Credit Parent Inc',
      tenantParent: 'ent-davita', guarantorParent: 'ent-davita',
    }), false);
  });
  it('different resolved operator parents → cross-attribution', () => {
    assert.equal(guarantorContradictsTenant({
      tenant: 'Tenant A', guarantor: 'Guarantor B',
      tenantParent: 'ent-fresenius', guarantorParent: 'ent-davita',
    }), true);
  });
  it('a non-operator guarantor cannot contradict (e.g. a generic LLC guarantor)', () => {
    assert.equal(guarantorContradictsTenant({
      tenant: 'THE HERTZ CORPORATION', guarantor: 'Hertz Holdings LLC',
    }), false);
  });
  it('no guarantor → never a contradiction', () => {
    assert.equal(guarantorContradictsTenant({ tenant: 'THE HERTZ CORPORATION', guarantor: null }), false);
    assert.equal(guarantorContradictsTenant({}), false);
  });
});

describe('lease extractor — cross-attribution guard withholds the contaminated guarantor', () => {
  // The exact 2026-06-15 finding: a genuine Hertz lease in a multi-tenant
  // "DaVita Anchored" deal folder extracted with a dialysis guarantor bled from
  // the anchor. The guard must withhold the guarantor (never write the column,
  // never mint the entity/edge) + route a conflict — while the real Hertz facts
  // (rent/dates/SF) still land.
  const HERTZ_RAW = {
    property_identity: { address: '2936 S 6th St', city: 'Springfield', state: 'IL', tenant: 'THE HERTZ CORPORATION' },
    factual: {
      tenant: 'THE HERTZ CORPORATION', guarantor: 'Total Renal Care, Inc.',
      annual_rent: 24000, rent_psf: 16, leased_sf: 1500, lease_structure: 'NNN',
      commencement_date: '2023-02-01', expiration_date: '2028-01-31',
      renewal_options: '3 additional periods of 3 years',
    },
    ti_schedule: [], expense_schedule: [],
  };

  it('create path: guarantor withheld + conflict routed; tenant/rent still written; NO guarantor entity/edge', async () => {
    const calls = { ensureFields: null, conflicts: [], guarantorMinted: false };
    const deps = {
      // DIA fallback alone catches it, but exercise the resolver dep too.
      resolveOperatorParent: async (name) => /renal|davita/i.test(String(name || '')) ? 'ent-davita' : null,
      ensureLeaseRow: async (a) => { calls.ensureFields = a.fields; return { ok: true, lease_id: 25312, created: true }; },
      mergeField: async () => ({ decision: 'write' }),
      recordConflict: async (a) => { calls.conflicts.push({ field: a.field, attempted: a.attemptedValue, reason: a.reason }); return { ok: true }; },
      insertTiRows: async (a) => ({ ok: true, count: a.rows.length }),
      ensureGuarantorEntity: async () => { calls.guarantorMinted = true; return { entity_id: 'should-not-exist' }; },
      attachDoc: async () => ({ document_id: 1 }),
    };
    const n = normalizeLeaseExtraction(HERTZ_RAW);
    const out = await applyLeaseEnrichment({ domain: 'dialysis', propertyId: 40041, normalized: n }, deps);
    assert.equal(out.ok, true);
    assert.equal(out.guarantor_withheld, true);
    assert.equal(out.guarantor_entity_id, null, 'no contaminated guarantor entity');
    assert.equal(calls.guarantorMinted, false, 'guaranteed_by edge never minted');
    // The contaminated guarantor was NOT written to the lease row (create-insert fields).
    assert.ok(!('guarantor' in (calls.ensureFields || {})), 'guarantor column never written');
    // But the real Hertz facts seeded the row.
    assert.equal(calls.ensureFields.tenant, 'THE HERTZ CORPORATION');
    assert.equal(calls.ensureFields.annual_rent, 24000);
    // The disagreement was routed to the Decision Center conflict lane.
    assert.equal(out.conflicts, 1);
    assert.ok(calls.conflicts.some(c => c.field === 'guarantor' && c.reason === 'guarantor_contradicts_tenant'));
    assert.ok(out.warnings.some(w => /guarantor_contradicts_tenant/.test(w)));
  });

  it('a CLEAN dialysis lease is untouched (guarantor written, entity minted, no conflict)', async () => {
    const calls = { conflicts: 0, guarantorName: null };
    const deps = {
      resolveOperatorParent: async (name) => /renal|davita/i.test(String(name || '')) ? 'ent-davita' : null,
      ensureLeaseRow: async () => ({ ok: true, lease_id: 7001, created: false }),
      getLeaseRow: async () => ({ guarantor: null, tenant: null, annual_rent: null, rent_per_sf: null, expense_structure: null, renewal_options: null, lease_start: null, lease_expiration: null }),
      mergeField: async () => ({ decision: 'write' }),
      recordConflict: async () => { calls.conflicts++; return { ok: true }; },
      patchLease: async () => ({ ok: true }),
      insertTiRows: async (a) => ({ ok: true, count: a.rows.length }),
      ensureGuarantorEntity: async (a) => { calls.guarantorName = a.name; return { entity_id: 'g-davita', edge_ok: true }; },
    };
    const n = normalizeLeaseExtraction(RAW);   // DaVita Inc tenant + Total Renal Care guarantor
    const out = await applyLeaseEnrichment({ domain: 'dialysis', propertyId: 30441, normalized: n }, deps);
    assert.equal(out.ok, true);
    assert.equal(out.guarantor_withheld, false);
    assert.equal(out.guarantor_entity_id, 'g-davita');
    assert.equal(calls.guarantorName, 'Total Renal Care, Inc.');
    assert.equal(out.conflicts, 0, 'no false-positive conflict on a clean dialysis lease');
  });
});

describe('lease extractor — leaseValuesEqual (the no-clobber comparator)', () => {
  it('numeric exact (193330 ≠ 193329.48 is a disagreement; $1,250,000 == 1250000)', () => {
    assert.equal(leaseValuesEqual(193330.00, 193329.48), false);
    assert.equal(leaseValuesEqual('$1,250,000', 1250000), true);
  });
  it('dates compare as strings, never collapse to a year', () => {
    assert.equal(leaseValuesEqual('2021-06-01', '2036-05-31'), false);
    assert.equal(leaseValuesEqual('2021-06-01', '2021-06-01'), true);
  });
  it('text case-insensitive; one-sided null is a disagreement', () => {
    assert.equal(leaseValuesEqual('DaVita Inc', 'davita inc'), true);
    assert.equal(leaseValuesEqual('DaVita', 'Renal Treatment Centers'), false);
    assert.equal(leaseValuesEqual(null, 'x'), false);
    assert.equal(leaseValuesEqual(null, null), true);
  });
});

describe('lease extractor — lease-less property (create the lease, never orphan the guarantor)', () => {
  // The 30430 gap: a property with NO existing lease row. The lease doc IS the
  // lease, so the writer creates one from the facts, then the fields land, the
  // TI rows write, and the guaranteed_by edge forms.
  it('creates the lease, fills the factual fields, inserts TI, mints the guarantor', async () => {
    const calls = { ensure: null, created: false, ti: null, guarantor: null, provenance: [] };
    const deps = {
      ensureLeaseRow: async (a) => { calls.ensure = a; return { ok: true, lease_id: 88001, created: true }; },
      mergeField: async (a) => { calls.provenance.push(a.field); return { decision: 'write' }; },
      patchLease: async () => { throw new Error('patchLease must NOT run on the create path'); },
      insertTiRows: async (a) => { calls.ti = a; return { ok: true, count: a.rows.length }; },
      ensureGuarantorEntity: async (a) => { calls.guarantor = a; return { entity_id: 'g-created' }; },
      attachDoc: async () => ({ document_id: 4242 }),
    };
    const n = normalizeLeaseExtraction(RAW);
    const out = await applyLeaseEnrichment(
      { domain: 'dialysis', propertyId: 30430, normalized: n,
        doc: { fileName: 'lease.pdf', sourceUrl: '/x/lease.pdf' } },
      deps,
    );
    assert.equal(out.ok, true);
    assert.equal(out.lease_created, true);
    assert.equal(out.lease_id, 88001);
    assert.ok(out.fields_filled > 0);          // the create wrote the factual fields
    assert.equal(out.ti_rows, 1);
    assert.equal(out.guarantor_entity_id, 'g-created');
    assert.equal(out.document_id, 4242);
    // ensureLeaseRow got the mapped factual fields to seed the new row
    assert.equal(calls.ensure.fields.tenant, 'DaVita Inc');
    // TI + guarantor linked to the CREATED lease
    assert.equal(calls.ti.leaseId, 88001);
    assert.equal(calls.guarantor.leaseId, 88001);
    // provenance recorded for observability against the real lease_id
    assert.ok(calls.provenance.includes('guarantor'));
  });

  it('NEVER mints the guarantor when the lease cannot be created/linked', async () => {
    let guarantorMinted = false, tiAttempted = false;
    const deps = {
      ensureLeaseRow: async () => ({ ok: false, reason: 'no_factual_fields' }),
      mergeField: async () => ({ decision: 'write' }),
      insertTiRows: async () => { tiAttempted = true; return { ok: true, count: 1 }; },
      ensureGuarantorEntity: async () => { guarantorMinted = true; return { entity_id: 'should-not-exist' }; },
      attachDoc: async () => ({ document_id: 1 }),
    };
    const n = normalizeLeaseExtraction(RAW);
    const out = await applyLeaseEnrichment({ domain: 'government', propertyId: 30430, normalized: n }, deps);
    assert.equal(out.ok, false);
    assert.equal(out.guarantor_entity_id, null, 'no orphan guarantor');
    assert.equal(guarantorMinted, false);
    assert.equal(tiAttempted, false, 'no TI without a lease');
    assert.equal(out.fields_filled, 0);
    assert.ok(out.warnings.some(w => /lease_unresolved/.test(w)));
  });

  it('an EXISTING active lease is reused (no duplicate), fields fill via the patch path', async () => {
    const calls = { patch: null };
    const deps = {
      ensureLeaseRow: async () => ({ ok: true, lease_id: 70707, created: false }),  // dedupe hit
      mergeField: async () => ({ decision: 'write' }),
      patchLease: async (a) => { calls.patch = a; return { ok: true }; },
      insertTiRows: async (a) => ({ ok: true, count: a.rows.length }),
      ensureGuarantorEntity: async () => ({ entity_id: 'g-existing' }),
    };
    const n = normalizeLeaseExtraction(RAW);
    const out = await applyLeaseEnrichment({ domain: 'dialysis', propertyId: 30441, normalized: n }, deps);
    assert.equal(out.ok, true);
    assert.equal(out.lease_created, false);
    assert.equal(out.lease_id, 70707);
    assert.equal(calls.patch.leaseId, 70707);  // patched the resolved existing lease
    assert.ok(out.fields_filled > 0);
    assert.equal(out.guarantor_entity_id, 'g-existing');
  });
});

describe('lease extractor — folder-feed channel (attachLeaseDoc: in-domain enrich, never guess)', () => {
  // Deps that resolve the in-file address (4601 Madison) to one dia property and
  // succeed on every write. raw:RAW bypasses the AI.
  const enrichDeps = () => ({
    matchAgainstDomain: async (domain, address) =>
      (domain === 'dialysis' && /4601 madison/i.test(address)) ? { property_id: 30441, confidence: 0.95, reason: 'canonical' } : null,
    domainsFor: () => ['dialysis', 'government'],
    ensureLeaseRow: async () => ({ ok: true, lease_id: 7001, created: false }),
    mergeField: async () => ({ decision: 'write' }),
    patchLease: async () => ({ ok: true }),
    insertTiRows: async (x) => ({ ok: true, count: x.rows.length }),
    insertPropertyFinancials: async (x) => ({ ok: true, count: x.rows.length }),
    ensureGuarantorEntity: async () => ({ entity_id: 'g1', edge_ok: true }),
    attachDoc: async () => ({ document_id: 9001 }),
  });

  it('in-file address resolves → enriches (lease+TI+financials), shaped like an attach', async () => {
    const out = await attachLeaseDoc(
      { raw: RAW, fileName: 'lease.pdf', subjectHint: { vertical: 'dia' }, workspaceId: 'w', actorId: 'u' },
      { deps: enrichDeps(), matchByPathAnchor: async () => null, emitMatchDisambiguation: async () => {} });
    assert.equal(out.attached, true);
    assert.equal(out.lease, true);
    assert.equal(out.domain, 'dialysis');
    assert.equal(out.property_id, 30441);
    assert.equal(out.boundary_ok, true);
    assert.ok(out.applied.financial_rows >= 1);   // the #64 expense leg ran
    assert.equal(out.applied.guaranteed_by_edge, true);
  });

  it('in-file miss → PATH ANCHOR resolves the property', async () => {
    const deps = { ...enrichDeps(), matchAgainstDomain: async () => null };
    const out = await attachLeaseDoc(
      { raw: RAW, fileName: 'lease.pdf', subjectHint: { vertical: 'gov', tenant_brand: 'X' }, workspaceId: 'w', actorId: 'u' },
      { deps, matchByPathAnchor: async () => ({ status: 'matched', domain: 'government', property_id: 555, reason: 'tenant_city' }),
        emitMatchDisambiguation: async () => {} });
    assert.equal(out.attached, true);
    assert.equal(out.domain, 'government');
    assert.equal(out.property_id, 555);
  });

  it('ambiguous (≥2 in-domain near-misses) → match_disambiguation, never a guess', async () => {
    let emitted = false;
    const deps = { ...enrichDeps(), matchAgainstDomain: async () => null };
    const out = await attachLeaseDoc(
      { raw: RAW, fileName: 'lease.pdf', subjectHint: { vertical: 'gov', tenant_brand: 'X' }, workspaceId: 'w', actorId: 'u' },
      { deps, matchByPathAnchor: async () => ({ status: 'review_required', candidates: [{ property_id: 1 }, { property_id: 2 }] }),
        emitMatchDisambiguation: async () => { emitted = true; } });
    assert.equal(out.attached, false);
    assert.equal(out.emitted_disambiguation, true);
    assert.equal(out.match_status, 'review_required');
    assert.equal(emitted, true);
  });

  it('no in-domain property → unresolved_no_domain (terminal, never a create/guess)', async () => {
    const deps = { ...enrichDeps(), matchAgainstDomain: async () => null };
    const out = await attachLeaseDoc(
      { raw: RAW, fileName: 'lease.pdf', subjectHint: { vertical: 'gov' }, workspaceId: 'w', actorId: 'u' },
      { deps, matchByPathAnchor: async () => ({ status: 'unmatched' }), emitMatchDisambiguation: async () => {} });
    assert.equal(out.attached, false);
    assert.equal(out.no_domain, true);
  });

  it('scanned PDF (no text layer) → needs_ocr, ok:true (never a 500)', async () => {
    // PA fetch returns a no-text buffer (base64 of 0x000000) → leaseTextFromBytes ''.
    const blankFetch = async () => ({ ok: true, status: 200,
      text: async () => JSON.stringify({ ok: true, content_base64: 'AAAA', content_type: 'application/octet-stream' }) });
    const ext = await runLeaseExtraction({ storageRef: '/x/scanned-lease.pdf', fetchImpl: blankFetch });
    assert.equal(ext.needs_ocr, true);
    assert.equal(ext.normalized, null);
    const out = await attachLeaseDoc(
      { storageRef: '/x/scanned-lease.pdf', fileName: 'scanned.pdf', subjectHint: { vertical: 'dia' }, workspaceId: 'w', actorId: 'u' },
      { deps: { fetchImpl: blankFetch }, matchByPathAnchor: async () => null, emitMatchDisambiguation: async () => {} });
    assert.equal(out.ok, true);
    assert.equal(out.needs_ocr, true);
    assert.equal(out.match_status, 'needs_ocr');
  });

  it('dry-run previews the plan + boundary, writes NOTHING', async () => {
    const calls = { writes: 0 };
    const deps = { ...enrichDeps(),
      patchLease: async () => { calls.writes++; return { ok: true }; },
      insertTiRows: async () => { calls.writes++; return { ok: true, count: 1 }; },
      insertPropertyFinancials: async () => { calls.writes++; return { ok: true, count: 1 }; },
      ensureGuarantorEntity: async () => { calls.writes++; return { entity_id: 'g' }; },
      ensureLeaseRow: async () => { calls.writes++; return { ok: true, lease_id: 1, created: false }; },
    };
    const out = await attachLeaseDoc(
      { raw: RAW, fileName: 'lease.pdf', subjectHint: { vertical: 'dia' }, dryRun: true, workspaceId: 'w', actorId: 'u' },
      { deps, matchByPathAnchor: async () => null, emitMatchDisambiguation: async () => {} });
    assert.equal(out.dry_run, true);
    assert.equal(out.boundary_ok, true);
    assert.equal(out.preview.guarantor, 'Total Renal Care, Inc.');
    assert.ok(out.preview.financial_years >= 1);
    assert.equal(calls.writes, 0, 'dry-run wrote nothing');
  });
});

describe('lease extractor — orchestrator (gated dry-run / real)', () => {
  // raw bypasses the AI; mock matcher resolves the in-file address to one prop.
  const deps = {
    matchAgainstDomain: async (domain, address) =>
      (domain === 'dialysis' && /4601 madison/i.test(address)) ? { property_id: 30441, confidence: 0.95, reason: 'canonical' } : null,
    mergeField: async () => ({ decision: 'write' }),
    patchLease: async () => ({ ok: true }),
    insertTiRows: async (a) => ({ ok: true, count: a.rows.length }),
    ensureGuarantorEntity: async () => ({ entity_id: 'g1' }),
    attachDoc: async () => ({ document_id: 1 }),
  };

  it('dry-run resolves + previews + proves the boundary, writes NOTHING', async () => {
    const calls = { writes: 0 };
    const spyDeps = {
      ...deps,
      mergeField: async () => { calls.writes++; return { decision: 'write' }; },
      patchLease: async () => { calls.writes++; return { ok: true }; },
      insertTiRows: async () => { calls.writes++; return { ok: true, count: 1 }; },
    };
    const out = await extractLeaseDoc({ raw: RAW, fileName: 'lease.pdf', dryRun: true }, spyDeps);
    assert.equal(out.ok, true);
    assert.equal(out.dry_run, true);
    assert.equal(out.resolved.property_id, 30441);
    assert.equal(out.boundary_ok, true);
    assert.deepEqual(out.reported_targets, []);          // nothing reaches a reported field
    assert.equal(out.preview.guarantor, 'Total Renal Care, Inc.');
    assert.equal(calls.writes, 0, 'dry-run wrote nothing');
  });

  it('real run applies via deps', async () => {
    const out = await extractLeaseDoc({ raw: RAW, fileName: 'lease.pdf', dryRun: false }, deps);
    assert.equal(out.ok, true);
    assert.equal(out.dry_run, false);
    assert.equal(out.applied.guarantor_entity_id, 'g1');
    assert.equal(out.applied.ti_rows, 1);
  });

  it('caller-pinned property skips the resolver', async () => {
    const out = await extractLeaseDoc({ raw: RAW, domain: 'government', propertyId: 555, dryRun: true }, deps);
    assert.equal(out.resolved.reason, 'caller_pinned');
    assert.equal(out.resolved.property_id, 555);
  });
});
