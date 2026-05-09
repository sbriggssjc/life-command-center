// ============================================================================
// RCA Parser — smoke test against real TrendTracker exports
// ============================================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { parseRcaExport, normalizeProductType, VALID_PRODUCT_TYPES } from '../api/_shared/rca-parser.js';

const RCA_BASE = 'C:/Users/scott/NorthMarq Capital, LLC/Team Briggs - Documents/Single-Tenant Market/Data';

function rcaPath(product) {
  // Folder names are TitleCase
  const folder = product.charAt(0).toUpperCase() + product.slice(1);
  return `${RCA_BASE}/${folder}/RCA_TrendTracker_Chart_546906.xls`;
}

test('normalizeProductType accepts the four product types', () => {
  for (const p of VALID_PRODUCT_TYPES) {
    assert.equal(normalizeProductType(p), p);
    assert.equal(normalizeProductType(p.toUpperCase()), p);
  }
});

test('normalizeProductType rejects bogus values', () => {
  assert.throws(() => normalizeProductType('hotel'), /Invalid product_type/);
  assert.throws(() => normalizeProductType(''),       /Invalid product_type/);
});

const products = ['office', 'medical', 'industrial', 'retail'];

for (const product of products) {
  test(`parseRcaExport — ${product}`, (t) => {
    const path = rcaPath(product);
    if (!existsSync(path)) {
      t.skip(`File not present locally at ${path}`);
      return;
    }
    const buf = readFileSync(path);
    const result = parseRcaExport(buf, { expectedProductType: product });

    assert.equal(result.product_type, product);
    assert.ok(Array.isArray(result.rows));
    assert.ok(result.rows.length >= 90, `expected >=90 quarter rows, got ${result.rows.length}`);
    assert.match(result.report_run_date || '', /^\d{4}-\d{2}-\d{2}$/);

    // Spot-check first and last rows
    const first = result.rows[0];
    assert.equal(first.product_type, product);
    assert.match(first.period_end, /^2002-(03|06|09|12)-\d{2}$/);
    assert.ok(first.ttm_volume_dollars > 0);
    assert.ok(first.ttm_property_count > 0);
    assert.ok(first.ttm_total_sf > 0);
    assert.ok(first.ttm_cap_rate > 0 && first.ttm_cap_rate < 1, 'cap rate as decimal');

    const last = result.rows[result.rows.length - 1];
    assert.equal(last.product_type, product);
    assert.match(last.period_end, /^20\d{2}-(03|06|09|12)-\d{2}$/);

    // Industrial is the only product with no top_quartile_ppsf
    if (product === 'industrial') {
      assert.equal(last.ttm_top_quartile_ppsf, null);
    } else {
      assert.ok(last.ttm_top_quartile_ppsf > 0, `${product} should have top_quartile_ppsf`);
    }

    // All four products report top_quartile_cap
    assert.ok(last.ttm_top_quartile_cap > 0 && last.ttm_top_quartile_cap < 1);
  });
}

test('parseRcaExport rejects mismatched product expectation', (t) => {
  const officePath = rcaPath('office');
  if (!existsSync(officePath)) { t.skip('Office file not present'); return; }
  const buf = readFileSync(officePath);
  assert.throws(
    () => parseRcaExport(buf, { expectedProductType: 'retail' }),
    /rca_parse_mismatch/
  );
});
