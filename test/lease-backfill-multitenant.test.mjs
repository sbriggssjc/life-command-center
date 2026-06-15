// Multi-tenant deal-folder gate at the shared choke point (attachLeaseDoc),
// 2026-06-15. PR #1195 wired the folder-class gate into the CRAWL path only;
// the BACKFILL path called attachLeaseDoc directly and bypassed it. This proves
// the gate now lives IN attachLeaseDoc, so every caller (crawl, backfill, future)
// inherits it: a lease under /Multi/ or /Portfolio/ is refused BEFORE any byte
// fetch / resolve / create — the id-1803 Hertz-in-"DaVita Anchored" case.
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

import { attachLeaseDoc } from '../api/_handlers/lease-extractor.js';
import { backfillOneLeaseDoc } from '../api/_handlers/lease-backfill.js';

// The exact FULLY-EXECUTED sibling of the cleaned /Multi/ Hertz doc (id 1803).
const ID_1803_PATH =
  "/sites/TeamBriggs20/Shared Documents/PROPERTIES/Multi/DaVita Anchored - Springfield, IL/Rec'd/Hertz (6994.505)- First Amendment to Lease - 2936 S 6th St Springfield IL FULLY EXECUTED.pdf";

const RAW_SINGLE = {
  property_identity: { address: '4601 Madison Ave', city: 'Kansas City', state: 'mo', tenant: 'DaVita' },
  factual: { tenant: 'DaVita Inc', annual_rent: 1250000, lease_structure: 'NNN' },
  ti_schedule: [], expense_schedule: [],
};

// Spy sub-deps for attachLeaseDoc: if the gate fails, ONE of these fires.
function spyDeps(record) {
  return {
    fetchImpl: async () => { record.fetch = true; return { ok: true, status: 200, text: async () => '{}' }; },
    matchAgainstDomain: async () => { record.resolve = true; return null; },
    domainsFor: () => ['dialysis', 'government'],
    ensureLeaseRow: async () => { record.create = true; return { ok: true, lease_id: 1, created: true }; },
    mergeField: async () => ({ decision: 'write' }),
    patchLease: async () => ({ ok: true }),
    insertTiRows: async (x) => ({ ok: true, count: x.rows.length }),
    ensureGuarantorEntity: async () => { record.guarantor = true; return { entity_id: 'g' }; },
    attachDoc: async () => ({ document_id: 1 }),
  };
}

describe('attachLeaseDoc — multi-tenant deal-folder gate (the shared choke point)', () => {
  it('a /Portfolio/ pathRef returns multitenant_deferred:true, no byte fetch / resolve / create', async () => {
    const record = {};
    const out = await attachLeaseDoc(
      { storageRef: '/sites/x/Shared Documents/PROPERTIES/Portfolio/ARA of 5/lease.pdf',
        fileName: 'lease.pdf', subjectHint: { vertical: 'dia' }, workspaceId: 'w', actorId: 'u' },
      { deps: spyDeps(record), matchByPathAnchor: async () => { record.pathAnchor = true; return null; },
        emitMatchDisambiguation: async () => { record.emit = true; } });
    assert.equal(out.ok, true);
    assert.equal(out.multitenant_deferred, true);
    assert.equal(out.attached, false);
    assert.equal(out.skip_reason, 'multitenant_deal_folder');
    assert.deepEqual(record, {}, 'no fetch / resolve / create / pathAnchor / emit was reached');
  });

  it('the id-1803 /Multi/ Hertz lease is refused before any extraction', async () => {
    const record = {};
    const out = await attachLeaseDoc(
      { storageRef: ID_1803_PATH, pathRef: ID_1803_PATH, fileName: 'Hertz ... FULLY EXECUTED.pdf',
        subjectHint: { vertical: 'dia', tenant_brand: 'DaVita' }, workspaceId: 'w', actorId: 'u' },
      { deps: spyDeps(record), matchByPathAnchor: async () => { record.pathAnchor = true; return null; },
        emitMatchDisambiguation: async () => { record.emit = true; } });
    assert.equal(out.multitenant_deferred, true);
    assert.deepEqual(record, {}, 'gate refused before any extraction');
  });

  it('a single-tenant path still extracts normally (no regression to the clean path)', async () => {
    const record = {};
    const out = await attachLeaseDoc(
      { raw: RAW_SINGLE, storageRef: "/sites/x/Shared Documents/PROPERTIES/D/DaVita/Conyers, GA/Rec'd/lease.pdf",
        fileName: 'lease.pdf', subjectHint: { vertical: 'dia' }, workspaceId: 'w', actorId: 'u' },
      { deps: { ...spyDeps(record),
          matchAgainstDomain: async (domain, address) =>
            (domain === 'dialysis' && /4601 madison/i.test(address)) ? { property_id: 30441, confidence: 0.95, reason: 'canonical' } : null },
        matchByPathAnchor: async () => null, emitMatchDisambiguation: async () => {} });
    assert.equal(out.multitenant_deferred, undefined, 'clean path is not gated');
    assert.equal(out.attached, true);
    assert.equal(out.domain, 'dialysis');
    assert.equal(out.property_id, 30441);
  });
});

describe('lease backfill — id-1803 row routes to multitenant_deferred via the shared gate', () => {
  const ctx = { workspaceId: 'w', actorId: 'u' };
  const row = { id: 1803, path: ID_1803_PATH, vertical: 'dia', status: 'attached',
    subject_hint: { vertical: 'dia', tenant_brand: 'DaVita' } };

  it('through backfillOneLeaseDoc + the REAL attachLeaseDoc: deferred, marked, no extraction', async () => {
    const record = {};
    let marked = null;
    const deps = {
      // Wire the REAL attachLeaseDoc (with spy sub-deps) so the gate is exercised
      // end-to-end, exactly as the production backfill calls it.
      attachLeaseDoc: (a) => attachLeaseDoc(a, {
        deps: spyDeps(record),
        matchByPathAnchor: async () => { record.pathAnchor = true; return null; },
        emitMatchDisambiguation: async () => { record.emit = true; },
      }),
      markBackfilled: async (r, info) => { marked = info; return { ok: true }; },
    };
    const out = await backfillOneLeaseDoc(row, ctx, deps);
    assert.equal(out.outcome, 'multitenant_deferred');
    assert.equal(out.skip_reason, 'multitenant_deal_folder');
    assert.ok(marked, 'terminal outcome was marked (drops out of the eligible queue)');
    assert.equal(marked.outcome, 'multitenant_deferred');
    assert.deepEqual(record, {}, 'the extractor never fetched bytes / resolved / created a lease');
  });
});
