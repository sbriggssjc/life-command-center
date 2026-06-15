// Location-agreement guard (Unit 1) + draft-document policy (Unit 2), 2026-06-16.
//
// Unit 1 — the corporate-notice-address mis-match the operator gate CANNOT catch:
//   a "The Villages, FL" ground lease whose boilerplate notice block carries
//   DaVita's Denver, CO corporate HQ address — the matcher latched onto THAT and
//   landed the lease on property 30705 (DaVita HQ). Same operator (DaVita==DaVita)
//   so the operator gate passes; the LOCATION gate (FL folder anchor vs CO
//   property) is what blocks it → match_disambiguation, never a wrong-property
//   write.
// Unit 2 — an UNEXECUTED draft (a `/Drafts/` segment OR a blackline/redline/draft/
//   version filename) must NEVER mint an authoritative lease (the Federal Way
//   `…/PSA/Drafts/` redline/blackline files that built a phantom 160k-SF lease).
//   The shared attachLeaseDoc choke point refuses BEFORE any byte fetch / resolve.
//
// Env set BEFORE import (auth.js / db helpers capture *_SUPABASE_URL at load).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.OPS_SUPABASE_URL = 'https://ops.test.local';
process.env.OPS_SUPABASE_KEY = 'k';
process.env.DIA_SUPABASE_URL = 'https://dia.test.local';
process.env.DIA_SUPABASE_KEY = 'k';
process.env.GOV_SUPABASE_URL = 'https://gov.test.local';
process.env.GOV_SUPABASE_KEY = 'k';
process.env.SHAREPOINT_FETCH_URL = 'https://pa.test.local/fetch';

import { attachLeaseDoc, locationContradicts } from '../api/_handlers/lease-extractor.js';
import { backfillOneLeaseDoc } from '../api/_handlers/lease-backfill.js';

// ── Unit 1: the pure comparator ──────────────────────────────────────────────
describe('lease extractor — locationContradicts (conservative city/state guard)', () => {
  it('flags the real bug: a FL doc anchor vs a CO property (different states)', () => {
    assert.equal(locationContradicts({ docState: 'FL', propState: 'CO', docCity: 'The Villages', propCity: 'Denver' }), true);
    assert.equal(locationContradicts({ docState: 'CA', propState: 'CO' }), true);   // Gardena, CA → CO HQ
  });
  it('same state + same city → passes (a correctly-located lease)', () => {
    assert.equal(locationContradicts({ docState: 'GA', propState: 'GA', docCity: 'Conyers', propCity: 'Conyers' }), false);
  });
  it('same state + clearly different city → contradicts (same-state wrong city)', () => {
    assert.equal(locationContradicts({ docState: 'TX', propState: 'TX', docCity: 'Austin', propCity: 'Dallas' }), true);
  });
  it('abbreviation variants normalize equal (St./Saint, Ft/Fort) — never a false block', () => {
    assert.equal(locationContradicts({ docState: 'MO', propState: 'MO', docCity: 'St. Louis', propCity: 'Saint Louis' }), false);
    assert.equal(locationContradicts({ docState: 'TX', propState: 'TX', docCity: 'Ft Worth', propCity: 'Fort Worth' }), false);
  });
  it('unknown on either side → passes (conservative; never blocks on missing data)', () => {
    assert.equal(locationContradicts({ docState: 'FL', propState: null }), false);
    assert.equal(locationContradicts({ docState: null, propState: 'CO' }), false);
    assert.equal(locationContradicts({ docCity: 'Austin', propCity: 'Dallas' }), false);  // no states → no city block
    assert.equal(locationContradicts({}), false);
  });
  it('case-insensitive state; a non-state token is ignored', () => {
    assert.equal(locationContradicts({ docState: 'fl', propState: 'CO' }), true);
    assert.equal(locationContradicts({ docState: 'Florida', propState: 'CO' }), false);   // not a 2-letter code → unknown
  });
});

// ── Unit 1: the gate inside attachLeaseDoc ───────────────────────────────────
// The corporate-notice bleed: the in-file premises address is Denver/CO (the
// notice block) and EVEN AGREES with the wrong property's CO location — but the
// FOLDER anchor (subject_hint) says FL, so the gate blocks. Proves the folder
// anchor is the trusted independent signal.
const VILLAGES_RAW = {
  property_identity: { address: '2000 16th St', city: 'Denver', state: 'CO', tenant: 'DaVita' },
  factual: { tenant: 'DaVita Inc', annual_rent: 1250000, lease_structure: 'NNN' },
  ti_schedule: [], expense_schedule: [],
};

function gateSpyDeps(record, over = {}) {
  return {
    matchAgainstDomain: async (domain, address) =>
      (domain === 'dialysis' && /2000 16th st/i.test(address)) ? { property_id: 30705, confidence: 0.9, reason: 'canonical_address' } : null,
    domainsFor: () => ['dialysis', 'government'],
    getPropertyLocation: async ({ propertyId }) => { assert.equal(propertyId, 30705); return { city: 'Denver', state: 'CO' }; },
    // The HQ is genuinely DaVita-operated, so the operator gate would PASS — only
    // the location gate catches this. Provided to prove that.
    getPropertyOperator: async () => ({ operator: 'DaVita', source: 'cms_chain' }),
    resolveOperatorParent: async () => null,
    ensureLeaseRow: async () => { record.create = true; return { ok: true, lease_id: 1, created: true }; },
    mergeField: async () => ({ decision: 'write' }),
    patchLease: async () => { record.patch = true; return { ok: true }; },
    insertTiRows: async (x) => ({ ok: true, count: x.rows.length }),
    ensureGuarantorEntity: async () => { record.guarantor = true; return { entity_id: 'g' }; },
    attachDoc: async () => ({ document_id: 1 }),
    ...over,
  };
}

describe('attachLeaseDoc — location-agreement gate (the corporate-notice mis-match)', () => {
  it('FL folder doc vs CO/HQ property → location_mismatch → match_disambiguation, NO write', async () => {
    const record = {};
    let emitted = false, emittedCtx = null;
    const out = await attachLeaseDoc(
      { raw: VILLAGES_RAW, fileName: 'Commencement Date Memorandum.pdf',
        subjectHint: { vertical: 'dia', tenant_brand: 'DaVita', city: 'The Villages', state: 'FL' },
        workspaceId: 'w', actorId: 'u' },
      { deps: gateSpyDeps(record), matchByPathAnchor: async () => null,
        emitMatchDisambiguation: async (_id, _addr, _ten, _cands, opts) => { emitted = true; emittedCtx = opts?.context || null; } });
    assert.equal(out.ok, false);
    assert.equal(out.attached, false);
    assert.equal(out.location_mismatch, true);
    assert.equal(out.reason, 'location_mismatch');
    assert.deepEqual(out.doc_location, { city: 'The Villages', state: 'FL' });
    assert.deepEqual(out.property_location, { city: 'Denver', state: 'CO' });
    assert.equal(out.property_id, 30705);
    assert.equal(out.match_status, 'review_required');
    assert.equal(out.emitted_disambiguation, true);
    assert.equal(emitted, true, 'routed to the existing match_disambiguation lane');
    assert.equal(emittedCtx?.location_mismatch, true);
    // Operator gate would PASS (DaVita==DaVita); the LOCATION gate is what blocked.
    assert.equal(record.create, undefined, 'no lease created');
    assert.equal(record.patch, undefined, 'no field patched');
    assert.equal(record.guarantor, undefined, 'no guarantor minted');
  });

  it('dry-run reports the mismatch but emits NOTHING and writes NOTHING', async () => {
    const record = {};
    let emitted = false;
    const out = await attachLeaseDoc(
      { raw: VILLAGES_RAW, fileName: 'memo.pdf',
        subjectHint: { vertical: 'dia', tenant_brand: 'DaVita', city: 'The Villages', state: 'FL' },
        dryRun: true, workspaceId: 'w', actorId: 'u' },
      { deps: gateSpyDeps(record), matchByPathAnchor: async () => null, emitMatchDisambiguation: async () => { emitted = true; } });
    assert.equal(out.dry_run, true);
    assert.equal(out.location_mismatch, true);
    assert.equal(emitted, false, 'dry-run never emits a decision');
    assert.deepEqual(record, {}, 'no write reached');
  });

  it('a correctly-located executed lease still ENRICHES (no false positive)', async () => {
    const CLEAN_RAW = {
      property_identity: { address: '100 Main St', city: 'Conyers', state: 'GA', tenant: 'DaVita' },
      factual: { tenant: 'DaVita Inc', annual_rent: 1250000, lease_structure: 'NNN' },
      ti_schedule: [], expense_schedule: [],
    };
    const deps = {
      matchAgainstDomain: async (domain, address) =>
        (domain === 'dialysis' && /100 main st/i.test(address)) ? { property_id: 41001, confidence: 0.95, reason: 'canonical' } : null,
      domainsFor: () => ['dialysis', 'government'],
      getPropertyLocation: async () => ({ city: 'Conyers', state: 'GA' }),   // agrees with the folder anchor
      getPropertyOperator: async () => ({ operator: 'DaVita Kidney Care', source: 'cms_chain' }),
      ensureLeaseRow: async () => ({ ok: true, lease_id: 7777, created: false }),
      mergeField: async () => ({ decision: 'write' }),
      patchLease: async () => ({ ok: true }),
      insertTiRows: async (x) => ({ ok: true, count: x.rows.length }),
      insertPropertyFinancials: async (x) => ({ ok: true, count: x.rows.length }),
      ensureGuarantorEntity: async () => ({ entity_id: 'g1', edge_ok: true }),
      attachDoc: async () => ({ document_id: 9001 }),
    };
    const out = await attachLeaseDoc(
      { raw: CLEAN_RAW, fileName: 'lease.pdf', subjectHint: { vertical: 'dia', tenant_brand: 'DaVita', city: 'Conyers', state: 'GA' },
        workspaceId: 'w', actorId: 'u' },
      { deps, matchByPathAnchor: async () => null, emitMatchDisambiguation: async () => {} });
    assert.equal(out.attached, true);
    assert.equal(out.lease, true);
    assert.equal(out.location_mismatch, undefined);
    assert.equal(out.property_id, 41001);
  });

  it('legacy deps without getPropertyLocation skip the gate (backward compatible)', async () => {
    // enrichDeps-shaped (no getPropertyLocation) → gate inert, normal enrich.
    const deps = {
      matchAgainstDomain: async (domain, address) =>
        (domain === 'dialysis' && /2000 16th st/i.test(address)) ? { property_id: 30705, confidence: 0.9, reason: 'canonical' } : null,
      domainsFor: () => ['dialysis', 'government'],
      ensureLeaseRow: async () => ({ ok: true, lease_id: 1, created: false }),
      mergeField: async () => ({ decision: 'write' }),
      patchLease: async () => ({ ok: true }),
      insertTiRows: async (x) => ({ ok: true, count: x.rows.length }),
      insertPropertyFinancials: async (x) => ({ ok: true, count: x.rows.length }),
      ensureGuarantorEntity: async () => ({ entity_id: 'g1', edge_ok: true }),
      attachDoc: async () => ({ document_id: 9001 }),
    };
    const out = await attachLeaseDoc(
      { raw: VILLAGES_RAW, fileName: 'memo.pdf', subjectHint: { vertical: 'dia', city: 'The Villages', state: 'FL' }, workspaceId: 'w', actorId: 'u' },
      { deps, matchByPathAnchor: async () => null, emitMatchDisambiguation: async () => {} });
    assert.equal(out.location_mismatch, undefined, 'no location gate without the dep');
    assert.equal(out.attached, true);
  });
});

// ── Unit 2: the draft-document choke point inside attachLeaseDoc ─────────────
const FED_WAY_DRAFT =
  '/sites/TeamBriggs20/Shared Documents/PROPERTIES/D/DaVita/Federal Way, WA/PSA/Drafts/PSA - Federal Way - blackline.pdf';

function draftSpyDeps(record) {
  return {
    fetchImpl: async () => { record.fetch = true; return { ok: true, status: 200, text: async () => '{}' }; },
    matchAgainstDomain: async () => { record.resolve = true; return null; },
    domainsFor: () => ['dialysis', 'government'],
    getPropertyLocation: async () => { record.loc = true; return { city: null, state: null }; },
    ensureLeaseRow: async () => { record.create = true; return { ok: true, lease_id: 1, created: true }; },
    mergeField: async () => ({ decision: 'write' }),
    patchLease: async () => ({ ok: true }),
    insertTiRows: async (x) => ({ ok: true, count: x.rows.length }),
    ensureGuarantorEntity: async () => { record.guarantor = true; return { entity_id: 'g' }; },
    attachDoc: async () => ({ document_id: 1 }),
  };
}

describe('attachLeaseDoc — draft / unexecuted-document gate (the shared choke point)', () => {
  it('a /Drafts/ + blackline path → draft_not_executed, no byte fetch / resolve / create', async () => {
    const record = {};
    const out = await attachLeaseDoc(
      { storageRef: FED_WAY_DRAFT, pathRef: FED_WAY_DRAFT, fileName: 'PSA - Federal Way - blackline.pdf',
        subjectHint: { vertical: 'dia', tenant_brand: 'DaVita' }, workspaceId: 'w', actorId: 'u' },
      { deps: draftSpyDeps(record), matchByPathAnchor: async () => { record.pathAnchor = true; return null; },
        emitMatchDisambiguation: async () => { record.emit = true; } });
    assert.equal(out.ok, true);
    assert.equal(out.draft_not_executed, true);
    assert.equal(out.attached, false);
    assert.equal(out.skip_reason, 'draft_not_executed');
    assert.equal(out.match_status, 'draft_not_executed');
    assert.deepEqual(record, {}, 'no fetch / resolve / create / loc / pathAnchor / emit was reached');
  });

  it('a redline filename in a CLEAN folder is still caught (filename marker)', async () => {
    const record = {};
    const out = await attachLeaseDoc(
      { storageRef: "/sites/x/PROPERTIES/D/DaVita/Tulsa, OK/Rec'd/Lease redline.pdf",
        fileName: 'Lease redline.pdf', subjectHint: { vertical: 'dia' }, workspaceId: 'w', actorId: 'u' },
      { deps: draftSpyDeps(record), matchByPathAnchor: async () => { record.pathAnchor = true; return null; },
        emitMatchDisambiguation: async () => {} });
    assert.equal(out.draft_not_executed, true);
    assert.deepEqual(record, {}, 'gate refused before any extraction');
  });

  it('a FULLY-EXECUTED file (no draft marker) is NOT gated (clean path extracts)', async () => {
    const record = {};
    const out = await attachLeaseDoc(
      { raw: { property_identity: { address: '4601 Madison Ave', city: 'Kansas City', state: 'MO', tenant: 'DaVita' },
               factual: { tenant: 'DaVita Inc', annual_rent: 1250000, lease_structure: 'NNN' }, ti_schedule: [], expense_schedule: [] },
        storageRef: "/sites/x/PROPERTIES/D/DaVita/Kansas City, MO/Rec'd/DVA Lease - Fully Executed.pdf",
        fileName: 'DVA Lease - Fully Executed.pdf', subjectHint: { vertical: 'dia', city: 'Kansas City', state: 'MO' },
        workspaceId: 'w', actorId: 'u' },
      { deps: { ...draftSpyDeps(record),
          matchAgainstDomain: async (domain, address) =>
            (domain === 'dialysis' && /4601 madison/i.test(address)) ? { property_id: 30441, confidence: 0.95, reason: 'canonical' } : null,
          getPropertyLocation: async () => ({ city: 'Kansas City', state: 'MO' }) },
        matchByPathAnchor: async () => null, emitMatchDisambiguation: async () => {} });
    assert.equal(out.draft_not_executed, undefined, 'an executed file is never gated as a draft');
    assert.equal(out.attached, true);
    assert.equal(out.property_id, 30441);
  });
});

describe('lease backfill — a /Drafts/ row routes to draft_not_executed via the shared gate', () => {
  const ctx = { workspaceId: 'w', actorId: 'u' };
  const row = { id: 19517, path: FED_WAY_DRAFT, vertical: 'dia', status: 'attached',
    subject_hint: { vertical: 'dia', tenant_brand: 'DaVita' } };

  it('through backfillOneLeaseDoc + the REAL attachLeaseDoc: terminal, marked, no extraction', async () => {
    const record = {};
    let marked = null;
    const deps = {
      attachLeaseDoc: (a) => attachLeaseDoc(a, {
        deps: draftSpyDeps(record),
        matchByPathAnchor: async () => { record.pathAnchor = true; return null; },
        emitMatchDisambiguation: async () => { record.emit = true; },
      }),
      markBackfilled: async (r, info) => { marked = info; return { ok: true }; },
    };
    const out = await backfillOneLeaseDoc(row, ctx, deps);
    assert.equal(out.outcome, 'draft_not_executed');
    assert.equal(out.skip_reason, 'draft_not_executed');
    assert.ok(marked, 'terminal outcome was marked (drops out of the eligible queue)');
    assert.equal(marked.outcome, 'draft_not_executed');
    assert.deepEqual(record, {}, 'the extractor never fetched bytes / resolved / created a lease');
  });
});
