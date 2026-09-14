// diaQueryAllThrottled — the concurrency-4 pager R2-W-6 specified and deferred.
//
// This has been shipped and rolled back TWICE as unbounded parallel (QA-27 on
// dia, QA-33 on gov) because N concurrent page requests overwhelm
// Vercel/Supabase/browser when dashboards stack pagers in a Promise.all. The
// single most important property of this implementation is therefore that the
// concurrency is BOUNDED — a future "simplification" to Promise.all(pages.map(…))
// would silently reintroduce the exact regression that was reverted twice.
// These tests exist to make that regression loud.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const diaSrc = readFileSync(join(root, 'dialysis.js'), 'utf8');
const appSrc = readFileSync(join(root, 'app.js'), 'utf8');

function sliceFn(src, name) {
  const start = src.indexOf('async function ' + name + '(');
  assert.notEqual(start, -1, `${name} not found`);
  const brace = src.indexOf('{', src.indexOf(')', start));
  let depth = 0, end = -1;
  for (let i = brace; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  assert.notEqual(end, -1, `could not balance-brace ${name}`);
  return src.slice(start, end);
}

/**
 * Build the pager with an instrumented diaQuery so we can observe concurrency
 * and page order. `total` drives how many pages exist.
 */
function build({ total, withCount = true, pageDelayMs = 5 }) {
  const state = { inFlight: 0, maxInFlight: 0, calls: [] };
  const PAGE = 1000;

  const diaQuery = async (table, select, params) => {
    const { offset = 0, limit = PAGE, includeCount } = params || {};
    state.calls.push(offset);
    state.inFlight++;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    await new Promise(r => setTimeout(r, pageDelayMs));
    state.inFlight--;
    const n = Math.max(0, Math.min(limit, total - offset));
    // Rows carry their absolute index so output ORDER can be verified.
    const rows = Array.from({ length: n }, (_, i) => ({ i: offset + i }));
    if (includeCount) return { data: rows, count: withCount ? total : null };
    return rows;
  };

  const diaQueryAll = async () => { state.serialFallback = true; return []; };

  // eslint-disable-next-line no-new-func
  const fn = new Function('diaQuery', 'diaQueryAll', 'console', 'window',
    sliceFn(diaSrc, 'diaQueryAllThrottled') + '\nreturn diaQueryAllThrottled;'
  )(diaQuery, diaQueryAll, { warn() {}, debug() {} }, {});

  return { fn, state };
}

describe('diaQueryAllThrottled — bounded concurrency (the twice-reverted regression)', () => {
  it('never exceeds the concurrency cap, even with 12 pages', async () => {
    // The live Marketing case: 11,831 rows = 12 pages.
    const { fn, state } = build({ total: 11831 });
    const rows = await fn('v_opportunity_domain_classified', '*', {}, 4);
    assert.equal(rows.length, 11831, 'must return every row');
    assert.ok(state.maxInFlight <= 4,
      `concurrency reached ${state.maxInFlight}; the cap is 4 — unbounded parallel was reverted twice (QA-27/QA-33)`);
  });

  it('honours a lower cap when asked', async () => {
    const { fn, state } = build({ total: 11831 });
    await fn('t', '*', {}, 2);
    assert.ok(state.maxInFlight <= 2, `expected <=2 in flight, saw ${state.maxInFlight}`);
  });

  it('REGRESSION: does not fan out one request per page', async () => {
    const { fn, state } = build({ total: 50000 }); // 50 pages
    await fn('t', '*', {}, 4);
    assert.ok(state.maxInFlight <= 4,
      `50 pages produced ${state.maxInFlight} concurrent requests — this is exactly the QA-27 failure mode`);
  });

  it('returns rows in the SAME order as serial paging, despite parallel completion', async () => {
    const { fn } = build({ total: 4500 });
    const rows = await fn('t', '*', {}, 4);
    assert.equal(rows.length, 4500);
    for (let i = 0; i < rows.length; i++) {
      assert.equal(rows[i].i, i, `row ${i} out of order — positional reassembly is broken`);
    }
  });

  it('single page: one request, no count planning needed', async () => {
    const { fn, state } = build({ total: 300 });
    const rows = await fn('t', '*', {}, 4);
    assert.equal(rows.length, 300);
    assert.equal(state.calls.length, 1, 'a sub-page result must not trigger extra fetches');
  });

  it('falls back to the proven serial loop when no count is available', async () => {
    // Guessing page counts without a total is how you silently truncate.
    const { fn, state } = build({ total: 11831, withCount: false });
    await fn('t', '*', {}, 4);
    assert.ok(state.serialFallback, 'must defer to diaQueryAll rather than guess the page count');
  });
});

describe('the Marketing loader uses the throttled pager', () => {
  const stripComments = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');

  /**
   * The PRIMARY load path only — from the declaration to the marker that
   * begins the deferred-retry block. The retry path is deliberately still
   * serial (see the separate test below), so a window that swallowed it would
   * fail for the wrong reason. This is the same "assert on the right region"
   * lesson as stripping comments.
   */
  function primaryPath() {
    const start = appSrc.indexOf('let opportunitiesRaw = []');
    assert.notEqual(start, -1, 'opportunities loader not found');
    const end = appSrc.indexOf('// If empty (timeout)', start);
    assert.notEqual(end, -1, 'deferred-retry marker not found');
    return appSrc.slice(start, end);
  }

  it('no longer hand-rolls a sequential page loop for opportunities', () => {
    const region = stripComments(primaryPath());
    assert.match(region, /diaQueryAllThrottled/, 'must use the throttled pager');
    assert.ok(!/for \(let pg = 0; pg < 15; pg\+\+\)/.test(region),
      'the sequential 15-page loop is still present on the primary path');
  });

  it('degrades to diaQueryAll if the throttled pager is unavailable', () => {
    assert.match(primaryPath(), /typeof diaQueryAllThrottled === 'function'/,
      'load order between app.js and dialysis.js must not be assumed');
  });

  it('the deferred-retry path stays SERIAL on purpose', () => {
    // It only fires when the first attempt returned zero rows — i.e. something
    // was already struggling. Retrying gently is correct; parallelising a
    // retry after a failure is how you turn a blip into an outage.
    const start = appSrc.indexOf('// If empty (timeout)');
    const region = appSrc.slice(start, start + 1200);
    assert.match(region, /for \(let pg = 0; pg < 15; pg\+\+\)/,
      'the retry path should remain a serial loop');
  });
});
