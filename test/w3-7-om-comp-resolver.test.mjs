// W3.7 — OM-financials → automatic comp-review resolution.
// Fort Wayne (gov comp id=11) is the acceptance fixture: the Salesforce-linked
// Northmarq OM states in-place NOI $689,805; sold $8,512,000 = 8.10% ≈ reliable
// 8.0% → the row would-have-resolved automatically. Deps are injected so no live
// DB is needed — the mock below routes PostgREST-ish paths to canned data.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  OM_CAP_TOLERANCE, posNum, normCap, parseIntakeId, pickOmIncome, normalizeOmSnapshot,
  reconcileOmAgainstReview, findOmFilesForReview, readOmFinancials, resolveReviewRow,
  runOmCompResolution,
} from '../api/_handlers/om-comp-resolver.js';

// ── The Fort Wayne OM figures (from the actual OM Cowork resolved by hand) ──
const FORT_WAYNE_OM_NOI = 689805;
const FORT_WAYNE_SOLD = 8512000;
const fortWayneReview = {
  id: 11, sale_id: '2a32c256-5a0f-4746-b731-5b580a5231bc', property_id: '16261',
  flags: ['cap_mismatch'], reliable_cap: 0.08, sale_price: FORT_WAYNE_SOLD,
  sale_date: '2025-12-29', detail: { implied_cap: 0.069586, reliable_cap: 0.08 },
};

// ── Pure helpers ────────────────────────────────────────────────────────────
describe('pure numeric/cap helpers', () => {
  it('posNum: positive finite else null', () => {
    assert.equal(posNum('689805'), 689805);
    assert.equal(posNum(0), null);
    assert.equal(posNum(''), null);
    assert.equal(posNum('x'), null);
    assert.equal(posNum(-5), null);
  });
  it('normCap: percent (>1) → decimal, decimal passes through', () => {
    assert.equal(normCap('7.28'), 0.0728);   // AI returned a percent
    assert.equal(normCap('0.0637'), 0.0637); // AI returned a decimal
    assert.equal(normCap(8.1), 0.081);
    assert.equal(normCap(null), null);
  });
  it('parseIntakeId: pulls the uuid out of process_notes', () => {
    assert.equal(parseIntakeId('intake:2bcdb95a-7d8a-4419-a1cd-be10b839fd13 extract:review_required match:matched'),
      '2bcdb95a-7d8a-4419-a1cd-be10b839fd13');
    assert.equal(parseIntakeId('no intake here'), null);
  });
  it('pickOmIncome: gov=NOI, dia=rent→NOI fallback', () => {
    assert.deepEqual(pickOmIncome({ noi: 100, annual_rent: 90 }, true), { income: 100, kind: 'NOI' });
    assert.deepEqual(pickOmIncome({ noi: 100, annual_rent: 90 }, false), { income: 90, kind: 'RENT' });
    assert.deepEqual(pickOmIncome({ noi: 100, annual_rent: null }, false), { income: 100, kind: 'NOI' });
  });
  it('normalizeOmSnapshot: normalizes fields + projections default null→[]', () => {
    const n = normalizeOmSnapshot({ document_type: 'om', noi: '689805', cap_rate: '8.1', building_sf: '12345', financial_projections: null });
    assert.equal(n.noi, 689805);
    assert.equal(n.cap_rate, 0.081);
    assert.equal(n.rba, 12345);
    assert.deepEqual(n.projections, []);
  });
});

// ── The reconciliation core (the would-have-resolved decision) ──────────────
describe('reconcileOmAgainstReview', () => {
  it('FORT WAYNE would-have-resolved: OM NOI 689,805 / 8,512,000 = 8.10% ≈ reliable 8.0% → RESOLVE', () => {
    const r = reconcileOmAgainstReview({ review: fortWayneReview, income: FORT_WAYNE_OM_NOI, incomeKind: 'NOI', sfFileId: '999' });
    assert.equal(r.decision, 'resolve');
    assert.equal(r.within_tolerance, true);
    assert.ok(Math.abs(r.implied_cap - 0.081040) < 1e-5, `implied ${r.implied_cap}`);
    assert.ok(Math.abs(r.implied_cap - r.reliable_cap) <= OM_CAP_TOLERANCE);
    assert.equal(r.note, 'om_confirmed:999');
  });
  it('the STALE NOI (592,313) that caused the flag would NOT reconcile (6.96% vs 8.0%)', () => {
    const r = reconcileOmAgainstReview({ review: fortWayneReview, income: 592313, incomeKind: 'NOI', sfFileId: '999' });
    assert.equal(r.decision, 'leave_open');
    assert.equal(r.within_tolerance, false);
  });
  it('genuine conflict (OM NOI implies 8.25% vs reliable 4.43%) → leave_open', () => {
    const review = { id: 6, reliable_cap: 0.0443, sale_price: 19986944 };
    const r = reconcileOmAgainstReview({ review, income: 1648927, incomeKind: 'NOI', sfFileId: '13' });
    assert.equal(r.decision, 'leave_open');
  });
  it('no reliable cap → no_reliable_cap (leave open, attach)', () => {
    const review = { id: 56, reliable_cap: null, sale_price: 5582041 };
    const r = reconcileOmAgainstReview({ review, income: 442623, incomeKind: 'NOI', sfFileId: '583' });
    assert.equal(r.decision, 'no_reliable_cap');
    assert.ok(r.implied_cap > 0);
  });
  it('no income / no price → insufficient_data', () => {
    assert.equal(reconcileOmAgainstReview({ review: fortWayneReview, income: null }).decision, 'insufficient_data');
    assert.equal(reconcileOmAgainstReview({ review: { sale_price: null, reliable_cap: 0.08 }, income: 100 }).decision, 'insufficient_data');
  });
  it('boundary: exactly at tolerance resolves', () => {
    const review = { reliable_cap: 0.08, sale_price: 1_000_000 };
    // implied 0.0875 → |0.0875-0.08| = 0.0075 == tolerance → resolve
    const r = reconcileOmAgainstReview({ review, income: 87500, sfFileId: 'x' });
    assert.equal(r.decision, 'resolve');
    // implied 0.0876 → over tolerance → leave open
    assert.equal(reconcileOmAgainstReview({ review, income: 87600, sfFileId: 'x' }).decision, 'leave_open');
  });
});

// ── Mock deps: route PostgREST-ish paths to canned data ─────────────────────
function makeMockDeps({ compStaging = [], files = [], snapshotByIntake = {}, existingFinancialsYears = [],
  rpcDecision = 'dry_run', capture } = {}) {
  capture = capture || { patches: [], rpc: [], inserts: [] };
  const domainQuery = async (domain, method, path, body) => {
    if (method === 'GET' && path.startsWith('sf_comp_staging')) return { ok: true, status: 200, data: compStaging };
    if (method === 'GET' && path.startsWith('sf_files')) return { ok: true, status: 200, data: files };
    if (method === 'GET' && path.startsWith('property_financials')) {
      const m = path.match(/fiscal_year=eq\.(\d+)/);
      const yr = m ? Number(m[1]) : null;
      return { ok: true, status: 200, data: existingFinancialsYears.includes(yr) ? [{ property_id: 1 }] : [] };
    }
    if (method === 'POST' && path === 'rpc/gov_apply_om_confirmed_noi') {
      capture.rpc.push(body);
      return { ok: true, status: 200, data: { decision: rpcDecision, property_id: body.p_property_id, new_noi: body.p_noi } };
    }
    if (method === 'POST' && path === 'property_financials') { capture.inserts.push(body); return { ok: true, status: 201, data: null }; }
    if (method === 'PATCH' && path.startsWith('gov_comp_review_queue')) { capture.patches.push({ path, body }); return { ok: true, status: 204, data: null }; }
    if (method === 'PATCH' && path.startsWith('dia_comp_review_queue')) { capture.patches.push({ path, body }); return { ok: true, status: 204, data: null }; }
    return { ok: true, status: 200, data: [] };
  };
  const opsQuery = async (method, path) => {
    const m = path.match(/intake_id=eq\.([0-9a-f-]{36})/i);
    const id = m ? m[1] : null;
    const snap = id ? snapshotByIntake[id] : null;
    return { ok: true, status: 200, data: snap ? [{ extraction_snapshot: snap }] : [] };
  };
  return { domainQuery, opsQuery, capture };
}

const FW_INTAKE = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
function fortWayneMock(overrides = {}) {
  return makeMockDeps({
    compStaging: [{ sf_comp_id: 'CMP_FW', sf_deal_id: null, sf_listing_id: null, linked_property_id: 16261, linked_sale_id: fortWayneReview.sale_id }],
    files: [{ file_id: 999, title: 'US Department of Veterans Affairs - Fort Wayne - IN - OM', extension: 'pdf',
      linked_entity_type: 'Comp__c', linked_entity_sf_id: 'CMP_FW', extraction_status: 'extracted',
      process_notes: `intake:${FW_INTAKE} extract:review_required match:matched` }],
    snapshotByIntake: { [FW_INTAKE]: { document_type: 'om', noi: FORT_WAYNE_OM_NOI, cap_rate: 8.1, asking_price: 8512000,
      building_sf: 45000, financial_projections: [
        { year: 2026, gross_rent: 700000, expenses: 10000, noi: 690000 },
        { year: 2027, gross_rent: 714000, expenses: 10200, noi: 703800 },
      ] } },
    ...overrides,
  });
}

// ── LINK + EXTRACT ──────────────────────────────────────────────────────────
describe('findOmFilesForReview + readOmFinancials', () => {
  it('LINK: traverses sale/property → comp staging → sf_files', async () => {
    const deps = fortWayneMock();
    const files = await findOmFilesForReview('gov', fortWayneReview, deps);
    assert.equal(files.length, 1);
    assert.equal(files[0].file_id, 999);
  });
  it('EXTRACT: reads the existing extraction snapshot (no re-extraction)', async () => {
    const deps = fortWayneMock();
    const read = await readOmFinancials(
      { file_id: 999, extraction_status: 'extracted', process_notes: `intake:${FW_INTAKE} extract:x` }, deps);
    assert.equal(read.available, true);
    assert.equal(read.financials.noi, FORT_WAYNE_OM_NOI);
  });
  it('EXTRACT: a not-yet-extracted linked file is reported unavailable', async () => {
    const deps = fortWayneMock();
    const read = await readOmFinancials({ file_id: 5, extraction_status: 'queued', process_notes: `intake:${FW_INTAKE}` }, deps);
    assert.equal(read.available, false);
  });
});

// ── Full orchestration ──────────────────────────────────────────────────────
describe('resolveReviewRow — Fort Wayne end-to-end', () => {
  it('DRY-RUN: resolves, calls the NOI RPC in dry-run, no PATCH written', async () => {
    const deps = fortWayneMock({ rpcDecision: 'dry_run' });
    const r = await resolveReviewRow({ domain: 'gov', review: fortWayneReview, apply: false }, deps);
    assert.equal(r.outcome, 'resolved');
    assert.equal(r.within_tolerance, true);
    assert.equal(r.writethrough, 'dry_run');
    assert.equal(deps.capture.rpc[0].p_dry_run, true);
    assert.equal(deps.capture.rpc[0].p_noi, FORT_WAYNE_OM_NOI);
    assert.equal(deps.capture.patches.length, 0, 'dry-run must not PATCH');
  });
  it('APPLY: writes NOI (confirmed), projections, and PATCHes status=resolved with om_confirmed note', async () => {
    const deps = fortWayneMock({ rpcDecision: 'written' });
    const r = await resolveReviewRow({ domain: 'gov', review: fortWayneReview, apply: true }, deps);
    assert.equal(r.outcome, 'resolved');
    assert.equal(r.writethrough, 'written');
    assert.equal(deps.capture.rpc[0].p_dry_run, false);
    // both projection years written (none pre-existing)
    assert.equal(deps.capture.inserts.length, 2);
    assert.equal(deps.capture.inserts[0].source, 'om_extract');
    // one PATCH: status resolved + note + attached OM detail
    assert.equal(deps.capture.patches.length, 1);
    const patch = deps.capture.patches[0].body;
    assert.equal(patch.status, 'resolved');
    assert.equal(patch.resolution_note, 'om_confirmed:999');
    assert.ok(patch.detail.om && patch.detail.om.noi === FORT_WAYNE_OM_NOI);
    assert.ok(patch.detail.implied_cap != null, 'prior detail preserved (merge)');
  });
  it('projections fill-blanks: a year already present is skipped', async () => {
    const deps = fortWayneMock({ rpcDecision: 'written', existingFinancialsYears: [2026] });
    await resolveReviewRow({ domain: 'gov', review: fortWayneReview, apply: true }, deps);
    assert.equal(deps.capture.inserts.length, 1, 'only 2027 inserted; 2026 skipped');
    assert.equal(deps.capture.inserts[0].fiscal_year, 2027);
  });
  it('flag gate: a reconciling OM on a price_over_ask-only row does NOT auto-resolve', async () => {
    const review = { ...fortWayneReview, id: 60, flags: ['price_over_ask'] };
    const deps = fortWayneMock({ rpcDecision: 'written' });   // OM NOI reconciles (8.10% ≈ 8.0%)
    const r = await resolveReviewRow({ domain: 'gov', review, apply: true }, deps);
    assert.equal(r.outcome, 'left_open_flag_not_reconcilable');
    assert.equal(deps.capture.patches[0].body.status, undefined, 'no status change → stays open');
    assert.ok(deps.capture.patches[0].body.detail.om, 'OM figures still attached');
  });
  it('rent_disagreement row where OM rent reconciles → resolves (dia id=17 shape)', async () => {
    const review = { id: 17, sale_id: '5', property_id: '55', flags: ['rent_disagreement'],
      reliable_cap: 0.07546, sale_price: 4300000, detail: {} };
    const deps = makeMockDeps({
      compStaging: [{ sf_comp_id: 'C17', linked_property_id: 55, linked_sale_id: 5 }],
      files: [{ file_id: 203, title: 'Fresenius - West Springfield - MA - OM', linked_entity_type: 'Comp__c',
        linked_entity_sf_id: 'C17', extraction_status: 'extracted', process_notes: `intake:${FW_INTAKE} extract:x` }],
      snapshotByIntake: { [FW_INTAKE]: { document_type: 'om', annual_rent: 293905 } }, // 6.84% vs 7.55%, |Δ|=0.71%<0.75%
    });
    const r = await resolveReviewRow({ domain: 'dia', review, apply: true }, deps);
    assert.equal(r.outcome, 'resolved');
    assert.equal(deps.capture.patches[0].body.status, 'resolved');
  });
  it('no linked file → no_linked_file (no writes)', async () => {
    const deps = makeMockDeps({ compStaging: [], files: [] });
    const r = await resolveReviewRow({ domain: 'gov', review: fortWayneReview, apply: true }, deps);
    assert.equal(r.outcome, 'no_linked_file');
    assert.equal(deps.capture.patches.length, 0);
  });
  it('dia: no NOI write-through (no field_value_provenance), still reconciles + attaches', async () => {
    const diaReview = { id: 8, sale_id: '123', property_id: '777', flags: ['cap_mismatch'],
      reliable_cap: 0.0589, sale_price: 3900000, detail: {} };
    const deps = makeMockDeps({
      compStaging: [{ sf_comp_id: 'CMP_D', linked_property_id: 777, linked_sale_id: 123 }],
      files: [{ file_id: 42, title: 'DaVita - Worcester - MA - OM', linked_entity_type: 'Comp__c',
        linked_entity_sf_id: 'CMP_D', extraction_status: 'extracted', process_notes: `intake:${FW_INTAKE} extract:x` }],
      // OM net rent 229,710 → implied 5.89% == reliable → would resolve
      snapshotByIntake: { [FW_INTAKE]: { document_type: 'om', annual_rent: 229710, noi: 229710 } },
    });
    const r = await resolveReviewRow({ domain: 'dia', review: diaReview, apply: true }, deps);
    assert.equal(r.income_kind, 'RENT');
    assert.equal(r.outcome, 'resolved');
    assert.equal(r.writethrough, null, 'dia takes no properties NOI write-through');
    assert.equal(deps.capture.rpc.length, 0, 'no gov RPC for dia');
  });
});

// ── W3.7b: the REAL Fort Wayne OM lives on the LISTING, not the Comp ─────────
// gov.sf_comp_staging: comp a1YVs000002BnvVMAS → listing a0jVs000005AqaLIAS,
// deal 006Vs00000MV4aYIAT (all live). Once file discovery sweeps Listing__c, the
// OM is an sf_files row linked_entity_type='Listing__c', linked_entity_sf_id +
// sf_listing_id = the listing. This proves the resolver reaches a LISTING-attached
// OM through the comp→listing traversal and resolves end-to-end (dry-run).
const FW_LISTING = 'a0jVs000005AqaLIAS';
const FW_DEAL = '006Vs00000MV4aYIAT';
const FW_COMP = 'a1YVs000002BnvVMAS';
describe('W3.7b — Fort Wayne OM discovered off the LISTING resolves end-to-end', () => {
  function listingAttachedMock(overrides = {}) {
    return makeMockDeps({
      // real comp staging: comp id + listing id + deal id all populated
      compStaging: [{ sf_comp_id: FW_COMP, sf_deal_id: FW_DEAL, sf_listing_id: FW_LISTING,
        linked_property_id: 16261, linked_sale_id: fortWayneReview.sale_id }],
      // the OM is attached to the LISTING (not the comp) — the W3.7b discovery target
      files: [{ file_id: 777, title: 'US Department of Veterans Affairs - Fort Wayne - IN - OM',
        extension: 'pdf', linked_entity_type: 'Listing__c', linked_entity_sf_id: FW_LISTING,
        sf_listing_id: FW_LISTING, sf_comp_id: null, sf_deal_id: null,
        extraction_status: 'extracted', ingestion_status: 'stored',
        process_notes: `intake:${FW_INTAKE} extract:review_required match:matched` }],
      snapshotByIntake: { [FW_INTAKE]: { document_type: 'om', noi: FORT_WAYNE_OM_NOI,
        cap_rate: 8.1, asking_price: FORT_WAYNE_SOLD, building_sf: 45000 } },
      ...overrides,
    });
  }

  it('LINK reaches the LISTING-attached file via the comp→listing traversal', async () => {
    const deps = listingAttachedMock();
    const files = await findOmFilesForReview('gov', fortWayneReview, deps);
    assert.equal(files.length, 1);
    assert.equal(files[0].linked_entity_type, 'Listing__c');
    assert.equal(files[0].sf_listing_id, FW_LISTING);
  });

  it('DRY-RUN resolves Fort Wayne from the listing OM (8.10% ≈ reliable 8.0%)', async () => {
    const deps = listingAttachedMock({ rpcDecision: 'dry_run' });
    const r = await resolveReviewRow({ domain: 'gov', review: fortWayneReview, apply: false }, deps);
    assert.equal(r.outcome, 'resolved');
    assert.equal(r.within_tolerance, true);
    assert.equal(r.sf_file_id, '777');
    assert.equal(r.writethrough, 'dry_run');
    assert.equal(deps.capture.rpc[0].p_dry_run, true, 'dry-run only');
    assert.equal(deps.capture.patches.length, 0, 'dry-run must not PATCH');
  });
});

// ── Backfill aggregation ────────────────────────────────────────────────────
describe('runOmCompResolution', () => {
  it('aggregates scanned/with_om/resolved and honest counts', async () => {
    const deps = fortWayneMock({ rpcDecision: 'dry_run' });
    // one open row (Fort Wayne) returned by the queue GET; override sf_comp GET already canned
    deps.domainQuery = (function (orig) {
      return async (domain, method, path, body) => {
        if (method === 'GET' && path.startsWith('gov_comp_review_queue?select=')) {
          return { ok: true, status: 200, data: [fortWayneReview] };
        }
        if (method === 'GET' && path.startsWith('dia_comp_review_queue?select=')) {
          return { ok: true, status: 200, data: [] };
        }
        return orig(domain, method, path, body);
      };
    })(deps.domainQuery);
    const report = await runOmCompResolution({ apply: false }, deps);
    assert.equal(report.by_domain.gov.scanned, 1);
    assert.equal(report.by_domain.gov.with_om, 1);
    assert.equal(report.by_domain.gov.resolved, 1);
    assert.equal(report.by_domain.dia.scanned, 0);
  });
});
