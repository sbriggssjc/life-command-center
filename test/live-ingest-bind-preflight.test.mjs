// W1.4-L3c defect 1 (2026-07-29/30) — unbound-context pre-flight.
//
// Live Intake extract/apply used to fire straight at the assistant endpoint even
// with no bound record (no research row selected, no manual target), and the
// endpoint answered with an opaque http_400. liveIngestBindPreflight (app.js) is
// the pure gate that catches that state and returns a friendly message + an
// optional one-click bind suggestion instead.
//
// app.js is a browser script (not ESM), so this is a FIXTURE test: it slices the
// real function out of the shipped file and exercises it in isolation.

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
  const braceStart = src.indexOf('{', start);
  let depth = 0, end = -1;
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  assert.notEqual(end, -1, `could not balance-brace ${marker}`);
  return src.slice(start, end);
}

let liveIngestBindPreflight;

before(async () => {
  const src = await readFile(APP, 'utf8');
  const fnSrc = sliceFn(src, 'function liveIngestBindPreflight(');
  liveIngestBindPreflight = new Function(`${fnSrc}; return liveIngestBindPreflight;`)();
});

describe('W1.4-L3c defect 1 — liveIngestBindPreflight', () => {
  it('a bound record → ok, no message', () => {
    const r = liveIngestBindPreflight({ current_record: { property_id: 3811 } }, null);
    assert.equal(r.ok, true);
    assert.equal(r.message, '');
  });

  it('a bound ownership row without property_id is still ok (any current_record binds)', () => {
    const r = liveIngestBindPreflight({ current_record: { ownership_id: 'abc' } }, null);
    assert.equal(r.ok, true);
  });

  it('the repro: no current_record → not ok, friendly bind message (not http_400)', () => {
    const r = liveIngestBindPreflight({ domain: 'government', current_record: null }, null);
    assert.equal(r.ok, false);
    assert.match(r.message, /Bind a record first/);
    assert.doesNotMatch(r.message, /400|http_400/i);
    assert.equal(r.suggestion, null);
  });

  it('null / undefined context → not ok', () => {
    assert.equal(liveIngestBindPreflight(null, null).ok, false);
    assert.equal(liveIngestBindPreflight(undefined, null).ok, false);
  });

  it('with an open-detail suggestion → message offers it and returns the suggestion', () => {
    const suggestion = { source_table: 'properties', label: '4121 Southpoint Blvd', current_record: { property_id: 3811 } };
    const r = liveIngestBindPreflight({ current_record: null }, suggestion);
    assert.equal(r.ok, false);
    assert.match(r.message, /4121 Southpoint Blvd/);
    assert.equal(r.suggestion, suggestion);
  });

  it('a suggestion without a label is ignored in the message', () => {
    const r = liveIngestBindPreflight({ current_record: null }, { current_record: {} });
    assert.equal(r.ok, false);
    assert.match(r.message, /Bind a record first/);
  });
});
