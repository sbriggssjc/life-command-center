// GOV-COMPS-CAP (2026-09-23) — the Gov › Sales › Sales Comps list stopped at
// exactly 2,000 rows while v_sales_comps held ~4,848.
//
// Mechanism (measured in gov edge_logs): the data-query edge function sent
// `Prefer: count=planned` for v_sales_comps; the planner estimated 1,817 rows;
// PostgREST answers 416 for any offset past its OWN estimate, so the offset=2000
// page 416'd, govQuery swallowed it into `[]`, and the loop read the short page
// as the end of the data. The pill then printed the loaded array's length.
//
// Three guards, each positive-controlled by a mutation below:
//   1. the shared loader pages to the EXACT total across >2 pages, and a short
//      page before the total is reached leaves a visible gap (not a silent stop);
//   2. the pill prints the exact total, never the loaded length;
//   3. the edge never sends an implicit count on a page after the first.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { countPreferMode } from '../supabase/functions/data-query/count-mode.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const govSrc = readFileSync(join(root, 'gov.js'), 'utf8');
const edgeSrc = readFileSync(join(root, 'supabase/functions/data-query/index.ts'), 'utf8');

// Balanced-brace slice of a whole function (never a fixed character window).
function sliceFn(src, name) {
  let start = src.indexOf('async function ' + name + '(');
  if (start === -1) start = src.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, `${name} not found`);
  const brace = src.indexOf('{', src.indexOf(')', start));
  let depth = 0;
  for (let i = brace; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`could not balance-brace ${name}`);
}

const fmtN = (n) => (n != null ? n.toLocaleString('en-US') : '—');

/**
 * A fake paged gov API that behaves like the proxy:
 *  - honours limit/offset over `total` rows;
 *  - returns the exact total only when asked with count:'exact';
 *  - `failAt` makes that offset return { data: [], count: 0 } — exactly what
 *    govQuery hands back on any HTTP error (the 416 case).
 */
function buildLoader({ total, failAt = null, src = govSrc }) {
  const calls = [];
  const govQuery = async (table, select, params) => {
    calls.push({ table, ...params });
    const { offset = 0, limit = 1000, count } = params;
    if (failAt !== null && offset === failAt) return { data: [], count: 0 };
    const n = Math.max(0, Math.min(limit, total - offset));
    const data = Array.from({ length: n }, (_, i) => ({ i: offset + i }));
    return { data, count: count === 'exact' ? total : 0 };
  };
  // eslint-disable-next-line no-new-func
  const fn = new Function('govQuery', sliceFn(src, 'govLoadSalesComps') + '\nreturn govLoadSalesComps;')(govQuery);
  return { fn, calls };
}

function buildLabel(src = govSrc) {
  // eslint-disable-next-line no-new-func
  return new Function('fmtN', sliceFn(src, 'govSalesCompsCountLabel') + '\nreturn govSalesCompsCountLabel;')(fmtN);
}

describe('govLoadSalesComps — pages to the exact total', () => {
  it('loads all 4,848 rows across 5 pages (the live population)', async () => {
    const { fn, calls } = buildLoader({ total: 4848 });
    const { rows, total } = await fn();
    assert.equal(total, 4848);
    assert.equal(rows.length, 4848);
    assert.deepEqual(calls.map(c => c.offset), [0, 1000, 2000, 3000, 4000]);
    assert.equal(rows[4847].i, 4847, 'rows must arrive in offset order');
  });

  it('asks for an EXACT count on page 0 and none on later pages', async () => {
    const { fn, calls } = buildLoader({ total: 3500 });
    await fn();
    assert.equal(calls[0].count, 'exact');
    for (const c of calls.slice(1)) assert.equal(c.count, false, `offset ${c.offset} must not request a count`);
    assert.ok(calls.every(c => c.table === 'v_sales_comps'));
  });

  it('stops without an extra request when the total is an exact multiple of the page', async () => {
    const { fn, calls } = buildLoader({ total: 3000 });
    const { rows } = await fn();
    assert.equal(rows.length, 3000);
    assert.equal(calls.length, 3, 'the exact total ends the loop — no probe page past it');
  });

  it('a failed page (the 416) leaves rows < total, so the gap stays visible', async () => {
    const { fn } = buildLoader({ total: 4848, failAt: 2000 });
    const { rows, total } = await fn();
    assert.equal(rows.length, 2000);
    assert.equal(total, 4848, 'the total must survive a failed page so the UI can say "2,000 of 4,848"');
  });

  it('MUTATION: the pre-fix loop (no count) cannot tell a failed page from the end', async () => {
    // Re-create the old loop shape and prove the test above would catch it.
    const oldLoop = `async function govLoadSalesComps() {
      let all = [], offset = 0;
      while (true) {
        const res = await govQuery('v_sales_comps', '*', { order: 'sale_date.desc.nullslast', limit: 1000, offset });
        const rows = res.data || [];
        all = all.concat(rows);
        if (rows.length < 1000) break;
        offset += 1000;
      }
      return { rows: all, total: null };
    }`;
    const { fn } = buildLoader({ total: 4848, failAt: 2000, src: oldLoop });
    const { rows, total } = await fn();
    assert.equal(rows.length, 2000);
    assert.equal(total, null, 'the old loop has no total — the 2,000 cap was silent');
  });

  it('MUTATION: dropping the exact-count request loses the total', async () => {
    const mutated = govSrc.replace("{ offset: 0, count: 'exact' }", '{ offset: 0 }');
    assert.notEqual(mutated, govSrc, 'mutation anchor must exist');
    const { fn } = buildLoader({ total: 4848, failAt: 2000, src: mutated });
    const { total } = await fn();
    assert.equal(total, null, 'without count:exact the fake returns count 0 and the total is unknown');
  });
});

describe('Sales Comps pill — exact count, never the loaded length', () => {
  const label = buildLabel();
  const rows = (n) => Array.from({ length: n });

  it('shows the exact total when fully loaded', () => {
    assert.equal(label(rows(4848), 4848), '4,848');
  });
  it('says "N of M" on a partial load', () => {
    assert.equal(label(rows(2000), 4848), '2,000 of 4,848');
  });
  it('says "loaded" (not a bare count) when the total is unknown', () => {
    assert.equal(label(rows(2000), null), '2,000 loaded');
  });
  it('shows an ellipsis before the load', () => {
    assert.equal(label(null, null), '…');
  });

  it('the pill is rendered through the label with the exact total', () => {
    assert.match(govSrc, /Sales Comps \(' \+ govSalesCompsCountLabel\(govSalesComps, govSalesCompsTotal\) \+ '\)/);
    assert.doesNotMatch(govSrc, /Sales Comps \(' \+ \(govSalesComps \? fmtN\(govSalesComps\.length\)/,
      'the pill must not print the loaded array length');
  });

  it('both v_sales_comps loaders go through the shared loader and store the total', () => {
    const direct = govSrc.match(/govQuery\('v_sales_comps'/g) || [];
    assert.equal(direct.length, 2, 'only govLoadSalesComps (page 0 + later pages) may query v_sales_comps directly');
    const loaderBody = sliceFn(govSrc, 'govLoadSalesComps');
    assert.equal((loaderBody.match(/govQuery\('v_sales_comps'/g) || []).length, 2);
    assert.equal((govSrc.match(/govSalesCompsTotal = loaded\.total;/g) || []).length, 2);
  });

  it('MUTATION: a label that prints the loaded length is caught', () => {
    const mutated = govSrc.replace('return fmtN(rows.length) + \' of \' + fmtN(total);', 'return fmtN(rows.length);');
    assert.notEqual(mutated, govSrc, 'mutation anchor must exist');
    assert.notEqual(buildLabel(mutated)(rows(2000), 4848), '2,000 of 4,848');
  });
});

describe('data-query edge — no implicit count past page 0 (the 416 source)', () => {
  const heavy = new Set(['v_sales_comps', 'properties']);

  it('page 0 of a heavy view keeps the planner estimate (incident 2026-08-12 guard)', () => {
    assert.equal(countPreferMode('v_sales_comps', null, null, heavy), 'planned');
    assert.equal(countPreferMode('v_sales_comps', null, '0', heavy), 'planned');
    assert.equal(countPreferMode('v_gov_on_market', null, null, heavy), 'exact');
  });
  it('a later page gets NO implicit count (this is what 416d at offset 2000)', () => {
    assert.equal(countPreferMode('v_sales_comps', null, '2000', heavy), null);
    assert.equal(countPreferMode('v_gov_on_market', null, '1000', heavy), null);
  });
  it('an explicit mode is always honoured; count=false sends none', () => {
    assert.equal(countPreferMode('v_sales_comps', 'exact', '0', heavy), 'exact');
    assert.equal(countPreferMode('v_sales_comps', 'planned', '2000', heavy), 'planned');
    assert.equal(countPreferMode('v_sales_comps', 'false', '0', heavy), null);
  });
  it('index.ts routes through countPreferMode and retries a 416 without the count', () => {
    assert.match(edgeSrc, /countPreferMode\(table, params\.get\("count"\), offset, HEAVY_COUNT\)/);
    assert.match(edgeSrc, /response\.status === 416 && fetchHeaders\["Prefer"\]/);
    assert.match(edgeSrc, /delete fetchHeaders\["Prefer"\]/);
  });

  it('MUTATION: removing the offset rule re-arms the 416', async () => {
    const src = readFileSync(join(root, 'supabase/functions/data-query/count-mode.ts'), 'utf8');
    const mutated = src.replace('if (Number.isFinite(n) && n > 0) return null;', '');
    assert.notEqual(mutated, src, 'mutation anchor must exist');
    const js = mutated
      .replace(/export function/, 'function')
      .replace(/\(\s*table: string,\s*countParam: string \| null,\s*offset: string \| null,\s*heavy: Set<string>,\s*\): string \| null/, '(table, countParam, offset, heavy)');
    // eslint-disable-next-line no-new-func
    const fn = new Function(js + '\nreturn countPreferMode;')();
    assert.equal(fn('v_sales_comps', null, '2000', heavy), 'planned', 'mutant sends a planner count on page 3');
  });
});
