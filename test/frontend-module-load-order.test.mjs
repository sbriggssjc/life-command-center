// W6.5 Stage 1 (Prompt 87) — front-end decomposition load-order smoke test.
//
// The SPA is served statically by Railway/Express with NO bundler: JS files are
// classic <script> tags concatenated into one global scope, so LOAD ORDER is the
// dependency mechanism. Stage 1 extracted the Decision Center federated lanes from
// ops.js into dc-lanes.js. This guard pins the invariants that keep that split
// behavior-identical, so a later reorder / rename can't silently break the app:
//   1. dc-lanes.js is loaded, as a classic (non-module) script, BEFORE ops.js.
//   2. dc-lanes.js and ops.js are both syntactically valid.
//   3. The federated surface lives in dc-lanes.js; the lane partition + seeded
//      renderers stay in ops.js (the two halves don't both define the same thing).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

function scriptIndex(file) {
  // Match a classic <script src="file?v=..."></script> tag (module tags excluded).
  const re = new RegExp('<script\\s+src="' + file.replace('.', '\\.') + '(\\?[^"]*)?"\\s*>', 'i');
  const m = html.match(re);
  return m ? m.index : -1;
}

describe('W6.5 front-end module load order (no-bundler classic scripts)', () => {
  it('dc-lanes.js is present in index.html', () => {
    assert.ok(scriptIndex('dc-lanes.js') >= 0, 'index.html must load dc-lanes.js');
  });

  it('ops.js is present in index.html', () => {
    assert.ok(scriptIndex('ops.js') >= 0, 'index.html must load ops.js');
  });

  it('dc-lanes.js loads BEFORE ops.js (federated globals defined first)', () => {
    const dc = scriptIndex('dc-lanes.js');
    const ops = scriptIndex('ops.js');
    assert.ok(dc >= 0 && ops >= 0, 'both scripts must be present');
    assert.ok(dc < ops, 'dc-lanes.js must appear before ops.js in index.html');
  });

  it('dc-lanes.js is a CLASSIC script (not type="module"), matching ops.js', () => {
    // A module would get its own scope and break the shared-global contract.
    assert.doesNotMatch(html, /<script\s+type="module"\s+src="dc-lanes\.js/i,
      'dc-lanes.js must be a classic script, not a module');
  });

  it('dc-lanes.js and ops.js both parse (node --check)', () => {
    for (const f of ['dc-lanes.js', 'ops.js']) {
      assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', join(root, f)]),
        `${f} must be syntactically valid`);
    }
  });

  // ── Stage 2, Unit 1: detail-rent.js ──────────────────────────────────────
  it('detail-rent.js is a CLASSIC script loaded BEFORE detail.js', () => {
    const rent = scriptIndex('detail-rent.js');
    const detail = scriptIndex('detail.js');
    assert.ok(rent >= 0, 'index.html must load detail-rent.js');
    assert.ok(detail >= 0, 'index.html must load detail.js');
    assert.ok(rent < detail, 'detail-rent.js must appear before detail.js in index.html');
    assert.doesNotMatch(html, /<script\s+type="module"\s+src="detail-rent\.js/i,
      'detail-rent.js must be a classic script, not a module');
  });

  it('detail-rent.js and detail.js both parse (node --check)', () => {
    for (const f of ['detail-rent.js', 'detail.js']) {
      assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', join(root, f)]),
        `${f} must be syntactically valid`);
    }
  });

  it('the rent POLICY moved to detail-rent.js; the rent RENDERERS stayed in detail.js', () => {
    const rentSrc = readFileSync(join(root, 'detail-rent.js'), 'utf8');
    const detailSrc = readFileSync(join(root, 'detail.js'), 'utf8');
    // Moved: the four pure helpers now live in detail-rent.js ONLY.
    for (const fn of ['_udProjectRent', '_udPickCurrentRent', '_udParseRentEscalation', '_udBuildRentSchedule']) {
      assert.match(rentSrc, new RegExp(`function\\s+${fn}\\b`), `detail-rent.js defines ${fn}`);
      assert.doesNotMatch(detailSrc, new RegExp(`function\\s+${fn}\\b`), `detail.js must NOT redefine ${fn}`);
    }
    // Stayed: the UI renderers + the shared date coercer remain in detail.js ONLY.
    for (const fn of ['_udRenderRentChart', '_udRenderRentRoll', '_udRentPsfTagHtml', '_udCoerceDate']) {
      assert.match(detailSrc, new RegExp(`function\\s+${fn}\\b`), `detail.js keeps ${fn}`);
      assert.doesNotMatch(rentSrc, new RegExp(`function\\s+${fn}\\b`), `detail-rent.js must NOT copy ${fn}`);
    }
    // A pointer comment is left where the region was, so the seam is findable.
    assert.match(detailSrc, /MOVED to detail-rent\.js/, 'detail.js keeps a pointer comment at the extraction site');
  });

  it('the federated surface lives in dc-lanes.js, the partition stays in ops.js', () => {
    const dcSrc = readFileSync(join(root, 'dc-lanes.js'), 'utf8');
    const opsSrc = readFileSync(join(root, 'ops.js'), 'utf8');
    // Moved: definitions now in dc-lanes.js only.
    assert.match(dcSrc, /const\s+_DC_FED_META\s*=/, 'dc-lanes.js defines _DC_FED_META');
    assert.match(dcSrc, /function\s+_fedCardHTML\b/, 'dc-lanes.js defines _fedCardHTML');
    assert.match(dcSrc, /function\s+renderFederatedLane\b/, 'dc-lanes.js defines renderFederatedLane');
    assert.doesNotMatch(opsSrc, /const\s+_DC_FED_META\s*=/, 'ops.js must NOT redefine _DC_FED_META');
    assert.doesNotMatch(opsSrc, /function\s+_fedCardHTML\b/, 'ops.js must NOT redefine _fedCardHTML');
    // Stayed: the lane partition primitive remains in ops.js only.
    assert.match(opsSrc, /_DC_FEDERATED\s*=\s*new Set\(/, 'ops.js keeps _DC_FEDERATED (the lane partition)');
    assert.doesNotMatch(dcSrc, /_DC_FEDERATED\s*=\s*new Set\(/, 'dc-lanes.js must NOT redefine _DC_FEDERATED');
  });
});
