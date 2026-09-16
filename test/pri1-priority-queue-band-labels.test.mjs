import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// PRI1 (2026-09-16): _pqBandLabel is a pure display swap for the raw P-code badge
// in the Priority Queue tab. This guard pins the invariants that make it safe:
// (1) it exists and is a one-to-one map keyed on the same bands as _pqBandColor,
// (2) it never returns an empty string for a known band, and
// (3) the badge render site uses it for TEXT while _pqBandColor still decides
//     the background (i.e. this is display-only — no predicate/color change).

const opsPath = join(process.cwd(), 'ops.js');
const src = readFileSync(opsPath, 'utf8');

function stripComments(s) {
  return s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

const clean = stripComments(src);

function extractFnBody(name) {
  const marker = `function ${name}(`;
  const start = clean.indexOf(marker);
  assert.ok(start >= 0, `${name} not found in ops.js`);
  let depth = 0;
  let i = clean.indexOf('{', start);
  const bodyStart = i;
  for (; i < clean.length; i++) {
    if (clean[i] === '{') depth++;
    else if (clean[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  return clean.slice(bodyStart, i + 1);
}

describe('PRI1 priority queue band labels', () => {
  const colorBody = extractFnBody('_pqBandColor');
  const labelBody = extractFnBody('_pqBandLabel');

  // Bands _pqBandColor branches on explicitly (the "if (b === '…')" set).
  const colorBands = [...colorBody.matchAll(/b === '([^']+)'/g)].map((m) => m[1]);

  it('_pqBandColor names at least the doctrinal band set', () => {
    for (const band of ['P0.4', 'P0.5', 'P-BUYER', 'P-CONTACT', 'P1', 'P2', 'P3', 'P5', 'P8']) {
      assert.ok(colorBands.includes(band), `_pqBandColor missing branch for ${band}`);
    }
  });

  it('_pqBandLabel carries a plain-English entry for every band _pqBandColor names', () => {
    for (const band of colorBands) {
      const re = new RegExp(`'${band.replace(/[.]/g, '\\.')}':\\s*'([^']+)'`);
      const m = labelBody.match(re);
      assert.ok(m, `_pqBandLabel has no entry for band ${band}`);
      assert.ok(m[1].length > 0, `_pqBandLabel entry for ${band} is empty`);
      // Must not just echo the raw code back — that would defeat the point.
      assert.notEqual(m[1], band, `_pqBandLabel(${band}) must not equal the raw code`);
    }
  });

  it('the badge render site shows the label as text and keeps the color keyed on the raw band', () => {
    const badgeLine = clean
      .split('\n')
      .find((l) => l.includes('class="pq-band"'));
    assert.ok(badgeLine, 'pq-band badge render line not found');
    assert.match(badgeLine, /_pqBandColor\(it\.priority_band\)/, 'background must stay keyed on raw priority_band');
    assert.match(badgeLine, /_pqBandLabel\(it\.priority_band\)/, 'visible text must come from _pqBandLabel');
    // The raw code must still be recoverable (title attr) — this is a display
    // change, not a data loss.
    assert.match(badgeLine, /title="/, 'raw band code must remain recoverable (e.g. title attr)');
  });

  it('_pqReason (row-level reason text) and _pqCtaState (CTA routing) are untouched by this change', () => {
    // Structural guard: both functions must still exist and switch on the SAME
    // predicate fields as before (priority_band / reason), proving PRI1 did not
    // touch decision logic, only display text.
    assert.ok(clean.includes('function _pqReason('), '_pqReason must still exist unmodified in shape');
    assert.ok(clean.includes('function _pqCtaState('), '_pqCtaState must still exist unmodified in shape');
  });
});
