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

import {
  buildLeaseExtractionPrompt, normalizeLeaseExtraction, planLeaseWrites,
  resolveAttachFromExtraction, applyLeaseEnrichment, LEASE_FIELD_MAP,
  extractLeaseDoc, planExpenseFinancials,
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

  it('a merge_field skip decision drops that one field, keeps the rest', async () => {
    const deps = {
      mergeField: async (a) => ({ decision: a.field === 'annual_rent' ? 'skip' : 'write' }),
      patchLease: async (a) => ({ ok: true, fields: a.fields }),
    };
    const n = normalizeLeaseExtraction(RAW);
    const out = await applyLeaseEnrichment({ domain: 'government', propertyId: 555, normalized: n }, deps);
    assert.equal(out.ok, true);
    assert.ok(out.fields_filled >= 1);  // other fields still written
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
