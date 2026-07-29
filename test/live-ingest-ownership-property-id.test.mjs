// W1.4-L3c defect 2 (2026-07-29/30) — gov Ownership research rows must carry
// property_id into the Live Intake context + Gov Evidence binding.
//
// Repro: ownership research row ownership_id 580d4b94-ceae-439f-9a77-7d0a6e9de60a
// (DB row HAS property_id 3811) reached getLiveIngestCurrentContext with a NULL
// property_id, because the gov Phase-2 `ownership_history` SELECT (gov.js) never
// asked for the column. The mapping at app.js already reads rec.property_id — the
// data just wasn't there.
//
// gov.js/app.js are browser scripts (touch `document`, not ESM), so these are
// FIXTURE tests: one asserts the SELECT string in gov.js, the other slices the
// real getLiveIngestCurrentContext out of app.js and runs its gov branch with
// injected globals so the mapping the app actually uses is covered.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = join(__dirname, '..', 'app.js');
const GOV = join(__dirname, '..', 'gov.js');

function sliceFn(src, marker) {
  const start = src.indexOf(marker);
  assert.notEqual(start, -1, `${marker} not found`);
  const braceStart = src.indexOf('{', start);
  let depth = 0, end = -1;
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  assert.notEqual(end, -1, `could not balance-brace ${marker}`);
  return src.slice(start, end);
}

let getGovContext;
let govSrc;

before(async () => {
  const appSrc = await readFile(APP, 'utf8');
  govSrc = await readFile(GOV, 'utf8');
  const fnSrc = sliceFn(appSrc, 'function getLiveIngestCurrentContext(');
  // Build a harness that injects the globals the gov branch reads, then returns
  // a callable of shape (domainKey, researchQueue, researchIdx, researchMode).
  const factory = new Function(`
    return function (domainKey, researchQueue, researchIdx, researchMode) {
      const LIVE_INGEST_ALLOWED_TABLES = { government: ['ownership_history'], dialysis: [] };
      function getCurrentDiaResearchRecord() { return null; }
      ${fnSrc}
      return getLiveIngestCurrentContext(domainKey);
    };
  `);
  getGovContext = factory();
});

describe('W1.4-L3c defect 2 — ownership research row → property_id', () => {
  it('gov.js Phase-2 ownership_history SELECT includes property_id', () => {
    const m = govSrc.match(/govQueryAll\('ownership_history',\s*'([^']+)'/);
    assert.ok(m, 'ownership_history govQueryAll select not found');
    const cols = m[1].split(',').map((c) => c.trim());
    assert.ok(cols.includes('property_id'), `property_id missing from ownership_history select: ${m[1]}`);
    assert.ok(cols.includes('ownership_id'), 'ownership_id should still be selected');
  });

  it('the repro: ownership row with property_id 3811 → context carries it', () => {
    const rec = {
      ownership_id: '580d4b94-ceae-439f-9a77-7d0a6e9de60a',
      property_id: 3811,
      address: '4121 southpoint blvd',
      city: 'JACKSONVILLE',
      state: 'FL',
      new_owner: 'JACKSONVILLE FL III FGF, LLC'
    };
    const ctx = getGovContext('government', [rec], 0, 'ownership');
    assert.equal(ctx.domain, 'government');
    assert.ok(ctx.current_record, 'current_record should be present for a bound ownership row');
    assert.equal(ctx.current_record.property_id, 3811);
    assert.equal(ctx.current_record.ownership_id, '580d4b94-ceae-439f-9a77-7d0a6e9de60a');
  });

  it('still falls back to matched_property_id when property_id is absent', () => {
    const rec = { ownership_id: 'x', matched_property_id: 999 };
    const ctx = getGovContext('government', [rec], 0, 'ownership');
    assert.equal(ctx.current_record.property_id, 999);
  });

  it('no bound row → current_record is null (the unbound state defect 1 handles)', () => {
    const ctx = getGovContext('government', [], 0, 'ownership');
    assert.equal(ctx.current_record, null);
  });
});
