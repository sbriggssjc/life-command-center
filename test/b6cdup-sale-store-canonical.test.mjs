// ============================================================================
// B6c-dup — THE TWO SALE STORES DISAGREED ABOUT WHICH ONE IS CANONICAL.
//
// detail.js asserted, in its own comments, that `property_sale_events` was
// canonical and that `sales_transactions` had been "retired for write paths."
// The database said the opposite, and had all along: measured 2026-08-29 over
// 234 gov views/matviews, 77 read sales_transactions — including ALL 30 cm_gov*
// Capital Markets views — and ZERO read property_sale_events.
//
// The comment is what let the collision survive, so it is what this file pins.
//
// ⚠️ THIS GUARD CANNOT STRIP COMMENTS, AND THAT IS THE WHOLE DESIGN PROBLEM.
// Everywhere else in this repo a source detector strips comments first (A5c,
// N18, B1) so the migration's own prose explaining a fix cannot satisfy a grep
// for the bug. Here the defect IS a comment — so stripping would blind the
// guard completely, and NOT stripping makes the correction (which quotes the
// old wording verbatim, on purpose, so the next reader knows what changed)
// satisfy the naive grep for it.
//
// Resolved by PROXIMITY, not by presence: the old claim may appear only inside
// an annotated correction — within CORRECTION_WINDOW lines of a `B6c-dup`
// marker. A quotation sits next to its marker; a reinstated claim would not.
//
// The second assertion guards the harm rather than the wording: detail.js must
// never gain a client-side write to sales_transactions. The gov trigger
// trg_gov_pse_propagate_to_sale is the SINGLE owner of that transition, and a
// second writer for one fact is how this started.
//
// Every assertion below was mutation-verified RED.
// ============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const detail = readFileSync(join(ROOT, 'detail.js'), 'utf8');
const lines = detail.split('\n');

const CORRECTION_WINDOW = 8;
const MARKER = /B6c-dup/;

/** Lines matching `re` that are NOT within `window` lines of a B6c-dup marker. */
function unannotated(re, window = CORRECTION_WINDOW) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!re.test(lines[i])) continue;
    const lo = Math.max(0, i - window);
    const hi = Math.min(lines.length, i + window + 1);
    if (!lines.slice(lo, hi).some((l) => MARKER.test(l))) out.push(i + 1);
  }
  return out;
}

test('the "sales_transactions is legacy/retired" claim never returns un-annotated', () => {
  const hits = unannotated(/retired for write path|legacy sales_transactions|sales_transactions\s+sink/i);
  assert.deepEqual(
    hits, [],
    `detail.js calls sales_transactions legacy/retired at line(s) ${hits.join(', ')}. ` +
    'It is the canonical comps spine: 77 of 77 gov views read it, all 30 cm_gov* ' +
    'Capital Markets views read it, zero read property_sale_events.'
  );
});

test('property_sale_events is never called the canonical store un-annotated', () => {
  const hits = unannotated(/canonical\s+property_sale_events|property_sale_events[^\n]{0,40}\bis\s+canonical\b/i);
  assert.deepEqual(
    hits, [],
    `detail.js calls property_sale_events canonical at line(s) ${hits.join(', ')}. ` +
    'It is the capture surface; it propagates into the spine.'
  );
});

test('the correction is actually present at both PSE write sites', () => {
  // Guards the inverse failure: someone deletes the annotation, which would make
  // the proximity rule above vacuously true for a reinstated claim later.
  const markers = lines.filter((l) => MARKER.test(l)).length;
  assert.ok(
    markers >= 4,
    `expected the B6c-dup correction marker at both write sites and both read ` +
    `sites (>=4 lines), found ${markers}`
  );
});

test('detail.js has no client-side write to sales_transactions', () => {
  // The gov trigger trg_gov_pse_propagate_to_sale owns PSE -> spine. A second
  // path from the panel would re-create the two-writers-for-one-fact defect.
  const writeShapes = [
    /table=sales_transactions&method=(POST|PATCH|PUT)/i,
    /table:\s*['"]sales_transactions['"]/i,
    /qFn\(\s*['"]sales_transactions['"][^)]*method\s*:\s*['"](POST|PATCH|PUT)['"]/i,
  ];
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimStart().startsWith('//')) continue; // a comment is not a write
    if (writeShapes.some((re) => re.test(lines[i]))) hits.push(i + 1);
  }
  assert.deepEqual(
    hits, [],
    `detail.js writes sales_transactions directly at line(s) ${hits.join(', ')}. ` +
    'ONE OWNER PER STATE TRANSITION: the gov trigger trg_gov_pse_propagate_to_sale ' +
    'is the only path from property_sale_events into the spine.'
  );
});

test('the panel still writes property_sale_events (the fix did not move the write)', () => {
  // Positive control: if this ever goes red the guard above is passing for the
  // wrong reason — there would be no PSE write left to propagate.
  assert.match(detail, /table=property_sale_events&method=POST/);
  assert.match(detail, /table:\s*'property_sale_events'/);
});
