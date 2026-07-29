// W1.4-L3c defect 3 (2026-07-29/30) — zero-operation proposal UX.
//
// When a Live Intake proposal comes back with 0 operations (everything the
// extractor found already exists), the panel used to (a) show the model's
// past-tense narrative as if a write happened, and (b) let Apply Selected fire
// and toast "Select at least one proposed operation". liveIngestProposalHeader
// (app.js) is the pure header logic; parseLiveIngestProposal now also normalizes
// an `already_on_file` annotation list from the model.
//
// app.js is a browser script (not ESM), so these are FIXTURE tests slicing the
// real functions out of the shipped file.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = join(__dirname, '..', 'app.js');

function sliceFn(src, marker) {
  const start = src.indexOf(marker);
  assert.notEqual(start, -1, `${marker} not found`);
  // Skip the parameter list first (its default values may contain `{}`), then
  // balance-brace the function body starting at the `{` after the closing `)`.
  const parenOpen = src.indexOf('(', start);
  let pdepth = 0, paramEnd = -1;
  for (let i = parenOpen; i < src.length; i++) {
    if (src[i] === '(') pdepth++;
    else if (src[i] === ')') { pdepth--; if (pdepth === 0) { paramEnd = i; break; } }
  }
  assert.notEqual(paramEnd, -1, `could not close param list for ${marker}`);
  const braceStart = src.indexOf('{', paramEnd);
  let depth = 0, end = -1;
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  assert.notEqual(end, -1, `could not balance-brace ${marker}`);
  return src.slice(start, end);
}

let liveIngestProposalHeader;
let parseLiveIngestProposal;
let appSrc;

before(async () => {
  appSrc = await readFile(APP, 'utf8');
  liveIngestProposalHeader = new Function(
    `${sliceFn(appSrc, 'function liveIngestProposalHeader(')}; return liveIngestProposalHeader;`
  )();
  // parseLiveIngestProposal depends on a few pure helpers — provide stubs that
  // preserve behavior for the fields under test (already_on_file normalization).
  const parseSrc = sliceFn(appSrc, 'function parseLiveIngestProposal(');
  parseLiveIngestProposal = new Function(`
    function deriveLiveIngestOperationSourceLineage() { return {}; }
    function deriveLiveIngestDisplayLineage() { return {}; }
    function normalizeLiveIngestSourceRefs() { return []; }
    const LIVE_INGEST_ALLOWED_TABLES = { government: ['sales_transactions'], dialysis: [] };
    ${parseSrc}
    return parseLiveIngestProposal;
  `)();
});

describe('W1.4-L3c defect 3 — liveIngestProposalHeader (zero-ops state)', () => {
  it('0 ops, nothing missing → explicit "already exists" terminal state (past-tense suppressed)', () => {
    const h = liveIngestProposalHeader({ summary: 'I updated the sale record with the new price.', operations: [] });
    assert.equal(h.zeroOps, true);
    assert.match(h.text, /Everything extracted already exists/);
    assert.match(h.text, /nothing to apply/);
    assert.notEqual(h.text, 'I updated the sale record with the new price.');
  });

  it('0 ops but with already_on_file → still the "already exists" state', () => {
    const h = liveIngestProposalHeader({
      summary: 'done',
      operations: [],
      already_on_file: ['sale 2021-09-21 $5.8M from costar_export']
    });
    assert.equal(h.zeroOps, true);
    assert.match(h.text, /Everything extracted already exists/);
  });

  it('0 ops with ONLY missing_information → honest "nothing to apply, see missing" (not falsely "exists")', () => {
    const h = liveIngestProposalHeader({ summary: 'x', operations: [], missing_information: ['Could not resolve the buyer.'] });
    assert.equal(h.zeroOps, true);
    assert.match(h.text, /see missing information/i);
    assert.doesNotMatch(h.text, /already exists/);
  });

  it('has operations → shows the model summary, not the empty state', () => {
    const h = liveIngestProposalHeader({ summary: 'Two field updates proposed.', operations: [{ kind: 'update' }] });
    assert.equal(h.zeroOps, false);
    assert.equal(h.text, 'Two field updates proposed.');
  });

  it('missing summary with operations → falls back to "No summary returned"', () => {
    const h = liveIngestProposalHeader({ operations: [{ kind: 'update' }] });
    assert.equal(h.text, 'No summary returned');
  });
});

describe('W1.4-L3c defect 3 — parseLiveIngestProposal normalizes already_on_file', () => {
  it('captures already_on_file lines and trims/drops junk', () => {
    const raw = JSON.stringify({
      summary: 'nothing new',
      operations: [],
      already_on_file: ['  sale 2021-09-21 $5.8M from costar_export ', '', 42, '  ']
    });
    const parsed = parseLiveIngestProposal(raw, 'government', {});
    assert.deepEqual(parsed.already_on_file, ['sale 2021-09-21 $5.8M from costar_export']);
    assert.equal(parsed.operations.length, 0);
  });

  it('missing already_on_file → empty array (never undefined)', () => {
    const parsed = parseLiveIngestProposal(JSON.stringify({ summary: 's', operations: [] }), 'government', {});
    assert.deepEqual(parsed.already_on_file, []);
  });
});

describe('W1.4-L3c defect 3 — Apply Selected is disabled (not error-toasted) at 0 ops', () => {
  it('the render gates Apply on hasApplicableOps', () => {
    // Regression guard: the Apply button disabled-condition must include the
    // no-applicable-ops flag so a 0-op proposal can never fire the handler.
    assert.match(appSrc, /const hasApplicableOps = ops\.some\(/);
    assert.match(appSrc, /data-live-ingest-apply="\$\{domainKey\}"[^>]*!hasApplicableOps/);
  });

  it('applyLiveIngestProposal only toasts "Select at least one" when operations exist', () => {
    const src = sliceFn(appSrc, 'async function applyLiveIngestProposal(');
    assert.match(src, /if \(totalOps > 0\) showToast\('Select at least one proposed operation'/);
  });
});
