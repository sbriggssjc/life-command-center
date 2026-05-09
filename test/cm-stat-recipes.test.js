// Tests for cm-stat-recipes.js (composeStat sentence generation)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeStat, periodLabel, listSupportedTemplates } from '../api/_shared/cm-stat-recipes.js';

test('periodLabel converts ISO date to YYYY-Qn', () => {
  assert.equal(periodLabel('2024-03-31'), '2024-Q1');
  assert.equal(periodLabel('2024-06-30'), '2024-Q2');
  assert.equal(periodLabel('2024-09-30'), '2024-Q3');
  assert.equal(periodLabel('2024-12-31'), '2024-Q4');
  assert.equal(periodLabel(null), '');
  assert.equal(periodLabel('garbage'), 'garbage');
});

test('listSupportedTemplates includes the headline 5', () => {
  const tmpls = listSupportedTemplates();
  for (const t of [
    'volume_ttm_by_quarter', 'cap_rate_ttm_by_quarter', 'transaction_count_ttm',
    'avg_deal_size', 'yoy_volume_change',
  ]) {
    assert.ok(tmpls.includes(t), `${t} missing from STAT_RECIPES`);
  }
});

test('composeStat: gov volume_ttm with built-in YoY', () => {
  const rows = [
    // Quarter sequence — only the relevant ones
    { period_end: '2023-06-30', subspecialty: 'all', volume_dollars: 8.0e9, yoy_change_pct: 0.05 },
    { period_end: '2023-09-30', subspecialty: 'all', volume_dollars: 8.5e9, yoy_change_pct: 0.06 },
    { period_end: '2023-12-31', subspecialty: 'all', volume_dollars: 9.0e9, yoy_change_pct: 0.08 },
    { period_end: '2024-03-31', subspecialty: 'all', volume_dollars: 9.5e9, yoy_change_pct: 0.10 },
    { period_end: '2024-06-30', subspecialty: 'all', volume_dollars: 9.8e9, yoy_change_pct: 0.225 },
  ];
  const r = composeStat({
    chart_template_id: 'volume_ttm_by_quarter',
    vertical: 'gov',
    subspecialty: 'all',
    rows,
    as_of: '2024-06-30',
  });
  assert.equal(r.ok, true);
  assert.equal(r.value_formatted, '$9.8B');
  assert.equal(r.yoy_method, 'view_field');
  assert.equal(r.yoy_delta_formatted, '+22.5%');
  assert.equal(r.direction, 'up');
  assert.match(r.stat_text, /Gov-leased TTM transaction volume totals \$9\.8B as of 2024-Q2; up 22\.5% YoY\./);
});

test('composeStat: cap rate uses bps_diff computed YoY', () => {
  const rows = [
    { period_end: '2023-06-30', subspecialty: 'all', ttm_weighted_cap_rate: 0.0715 },
    { period_end: '2023-09-30', subspecialty: 'all', ttm_weighted_cap_rate: 0.0720 },
    { period_end: '2023-12-31', subspecialty: 'all', ttm_weighted_cap_rate: 0.0730 },
    { period_end: '2024-03-31', subspecialty: 'all', ttm_weighted_cap_rate: 0.0740 },
    { period_end: '2024-06-30', subspecialty: 'all', ttm_weighted_cap_rate: 0.0747 },
  ];
  const r = composeStat({
    chart_template_id: 'cap_rate_ttm_by_quarter',
    vertical: 'gov',
    subspecialty: 'all',
    rows,
    as_of: '2024-06-30',
  });
  assert.equal(r.ok, true);
  assert.equal(r.value_formatted, '7.47%');
  assert.equal(r.yoy_method, 'computed_bps');
  // 0.0747 - 0.0715 = 0.0032 → 32 bps
  assert.equal(r.yoy_delta_formatted, '+32 bps');
  assert.match(r.stat_text, /Gov-leased TTM weighted cap is 7\.47% as of 2024-Q2; up 32 bps YoY\./);
});

test('composeStat: cap rate field-name divergence (natl_st uses cap_rate)', () => {
  const rows = [
    { period_end: '2024-09-30', subspecialty: 'all', cap_rate: 0.07 },
    { period_end: '2024-12-31', subspecialty: 'all', cap_rate: 0.071 },
    { period_end: '2025-03-31', subspecialty: 'all', cap_rate: 0.072 },
    { period_end: '2025-06-30', subspecialty: 'all', cap_rate: 0.073 },
    { period_end: '2025-09-30', subspecialty: 'all', cap_rate: 0.0721 },
  ];
  const r = composeStat({
    chart_template_id: 'cap_rate_ttm_by_quarter',
    vertical: 'national_st',
    subspecialty: 'all',
    rows,
    as_of: '2025-09-30',
  });
  assert.equal(r.ok, true);
  assert.equal(r.value_formatted, '7.21%');
  assert.equal(r.yoy_delta_formatted, '+21 bps');
  assert.match(r.stat_text, /National single-tenant TTM weighted cap is 7\.21% as of 2025-Q3/);
});

test('composeStat: subspecialty other than "all" gets parenthetical suffix', () => {
  const rows = [
    { period_end: '2024-06-30', subspecialty: 'office', volume_dollars: 9.5e9, yoy_change_pct: 0.149 },
  ];
  const r = composeStat({
    chart_template_id: 'volume_ttm_by_quarter',
    vertical: 'national_st',
    subspecialty: 'office',
    rows,
    as_of: '2024-06-30',
  });
  assert.equal(r.ok, true);
  assert.match(r.stat_text, /National single-tenant \(OFFICE\) TTM transaction volume/);
});

test('composeStat: no YoY when prior-year row is missing', () => {
  const rows = [
    { period_end: '2024-03-31', subspecialty: 'all', ttm_weighted_cap_rate: 0.0740 },
    { period_end: '2024-06-30', subspecialty: 'all', ttm_weighted_cap_rate: 0.0747 },
  ];
  const r = composeStat({
    chart_template_id: 'cap_rate_ttm_by_quarter',
    vertical: 'gov',
    subspecialty: 'all',
    rows,
    as_of: '2024-06-30',
  });
  assert.equal(r.ok, true);
  assert.equal(r.value_formatted, '7.47%');
  assert.equal(r.yoy_delta, null);
  assert.equal(r.yoy_delta_formatted, null);
  // Sentence omits the YoY clause entirely
  assert.match(r.stat_text, /^Gov-leased TTM weighted cap is 7\.47% as of 2024-Q2\.$/);
});

test('composeStat: yoy_volume_change suppresses redundant YoY suffix', () => {
  const rows = [
    { period_end: '2024-06-30', subspecialty: 'all', yoy_change_pct: 0.225 },
  ];
  const r = composeStat({
    chart_template_id: 'yoy_volume_change',
    vertical: 'gov',
    subspecialty: 'all',
    rows,
    as_of: '2024-06-30',
  });
  assert.equal(r.ok, true);
  assert.equal(r.value_formatted, '+22.5%');
  // Sentence should NOT have "; up 22.5% YoY" tacked on (the metric IS the YoY)
  assert.match(r.stat_text, /Gov-leased YoY volume change ran \+22\.5% as of 2024-Q2\.$/);
});

test('composeStat: as_of falls back to last row when not supplied', () => {
  const rows = [
    { period_end: '2024-03-31', subspecialty: 'all', volume_dollars: 9.5e9, yoy_change_pct: 0.10 },
    { period_end: '2024-06-30', subspecialty: 'all', volume_dollars: 9.8e9, yoy_change_pct: 0.225 },
  ];
  const r = composeStat({
    chart_template_id: 'volume_ttm_by_quarter',
    vertical: 'gov',
    subspecialty: 'all',
    rows,
    // as_of omitted
  });
  assert.equal(r.ok, true);
  assert.equal(r.period_end, '2024-06-30');
});

test('composeStat: unknown chart_template_id returns recipe_not_implemented', () => {
  const r = composeStat({
    chart_template_id: 'made_up_chart',
    vertical: 'gov',
    rows: [{ period_end: '2024-06-30', some_field: 1 }],
  });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'recipe_not_implemented');
});

test('composeStat: no_data when rows empty', () => {
  const r = composeStat({
    chart_template_id: 'volume_ttm_by_quarter',
    vertical: 'gov',
    subspecialty: 'all',
    rows: [],
  });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'no_data');
});

test('composeStat: count uses ttm_count on gov, deal_count on natl_st', () => {
  const govRow = [
    { period_end: '2023-06-30', subspecialty: 'all', ttm_count: 100 },
    { period_end: '2023-09-30', subspecialty: 'all', ttm_count: 110 },
    { period_end: '2023-12-31', subspecialty: 'all', ttm_count: 120 },
    { period_end: '2024-03-31', subspecialty: 'all', ttm_count: 125 },
    { period_end: '2024-06-30', subspecialty: 'all', ttm_count: 132, yoy_change_pct: 0.32 },
  ];
  const r1 = composeStat({
    chart_template_id: 'transaction_count_ttm',
    vertical: 'gov', subspecialty: 'all', rows: govRow, as_of: '2024-06-30',
  });
  assert.equal(r1.ok, true);
  assert.equal(r1.value_formatted, '132');

  const stRow = [
    { period_end: '2024-06-30', subspecialty: 'all', deal_count: 6582, yoy_change_pct: 0.072 },
  ];
  const r2 = composeStat({
    chart_template_id: 'transaction_count_ttm',
    vertical: 'national_st', subspecialty: 'all', rows: stRow, as_of: '2024-06-30',
  });
  assert.equal(r2.ok, true);
  assert.equal(r2.value_formatted, '6,582');
});
