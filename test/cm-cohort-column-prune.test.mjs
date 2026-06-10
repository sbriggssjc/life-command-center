// Round 76 Layer A1 — regression coverage for the cap-by-term Data_* tab
// cohort-column pruner. Before the fix, CHART_COLUMNS (keyed by
// chart_template_id, not vertical) emitted BOTH the dia cohort scheme
// (12+/8-12/6-8/≤5) AND the gov scheme (10+/6-10/<5/Outside) in every tab, so
// each export shipped 4 permanently-NULL cohort columns — Scott read the empty
// gov `10+` column in a dia tab as a "missing 10+ cohort" and the half-blank
// tab as "the data conflicts with itself". selectCohortColumns() prunes each
// tab to the vertical's canonical scheme so no chart series can bind to a null
// column set.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getExportBundleSchema } from '../api/_shared/cm-excel-export.js';

const { chartColumns, selectCohortColumns } = getExportBundleSchema();
const capKeys = (cols) => cols.map(c => c.key).filter(k => /^cap_/.test(k));

// Rows shaped like the LIVE views actually expose them (verified 2026-06-10):
//   dia views   -> cap_12plus / cap_8to12 / cap_6to8 / cap_5orless only
//   gov DOT view -> cap_10plus / cap_5to10 / cap_less5 / cap_outside_firm
//   gov Q view   -> cap_10plus / cap_6to10 / cap_less5 / cap_outside_firm
const diaRows   = [{ period_end: '2026-05-31', cap_12plus: 0.062, cap_8to12: 0.066, cap_6to8: 0.069, cap_5orless: 0.072 }];
const govDotRows = [{ period_end: '2026-03-31', cap_10plus: 0.0699, cap_5to10: 0.0716, cap_less5: 0.0708, cap_outside_firm: 0.0744 }];
const govQRows   = [{ period_end: '2026-03-31', cap_10plus: 0.0699, cap_6to10: 0.0716, cap_less5: 0.0708, cap_outside_firm: 0.0744 }];

test('A1: dia sold-cap tab keeps only the dia cohort scheme', () => {
  const out = selectCohortColumns(chartColumns.sold_cap_by_term_dot_plot, 'sold_cap_by_term_dot_plot', 'dialysis', diaRows);
  assert.deepEqual(capKeys(out), ['cap_12plus', 'cap_8to12', 'cap_6to8', 'cap_5orless']);
});

test('A1: gov sold-cap (dot) tab keeps cap_5to10, drops the dia scheme AND cap_6to10', () => {
  const out = selectCohortColumns(chartColumns.sold_cap_by_term_dot_plot, 'sold_cap_by_term_dot_plot', 'gov', govDotRows);
  assert.deepEqual(capKeys(out), ['cap_10plus', 'cap_5to10', 'cap_less5', 'cap_outside_firm']);
});

test('A1: gov quarterly cap-by-term tab keeps cap_6to10, drops the dia scheme AND cap_5to10', () => {
  const out = selectCohortColumns(chartColumns.cap_rate_by_lease_term, 'cap_rate_by_lease_term', 'gov', govQRows);
  assert.deepEqual(capKeys(out), ['cap_10plus', 'cap_6to10', 'cap_less5', 'cap_outside_firm']);
});

test('A1: dia quarterly cap-by-term tab keeps only the dia scheme', () => {
  const out = selectCohortColumns(chartColumns.cap_rate_by_lease_term, 'cap_rate_by_lease_term', 'dialysis', diaRows);
  assert.deepEqual(capKeys(out), ['cap_12plus', 'cap_8to12', 'cap_6to8', 'cap_5orless']);
});

test('A1: no pruned tab carries a 100%-NULL cohort column', () => {
  for (const [tmpl, rows, vertical] of [
    ['sold_cap_by_term_dot_plot', diaRows, 'dialysis'],
    ['sold_cap_by_term_dot_plot', govDotRows, 'gov'],
    ['cap_rate_by_lease_term', govQRows, 'gov'],
  ]) {
    const out = selectCohortColumns(chartColumns[tmpl], tmpl, vertical, rows);
    for (const c of out.filter(c => /^cap_/.test(c.key))) {
      assert.ok(rows.some(r => r[c.key] != null), `${tmpl}/${vertical}: column ${c.key} is entirely null`);
    }
  }
});

test('A1: non-cap-by-term templates are untouched', () => {
  const cols = chartColumns.cap_rate_by_credit;
  assert.equal(selectCohortColumns(cols, 'cap_rate_by_credit', 'gov', govQRows), cols);
});

test('A1: with no rows (schema-sniff callers) the vertical scheme is still pruned by side', () => {
  // wrong-scheme drop applies even without rows; the data-driven alias prune
  // is skipped so callers that sniff columns still see the canonical set.
  const out = selectCohortColumns(chartColumns.cap_rate_by_lease_term, 'cap_rate_by_lease_term', 'dialysis', []);
  assert.ok(!capKeys(out).some(k => ['cap_10plus', 'cap_6to10', 'cap_5to10', 'cap_less5', 'cap_outside_firm'].includes(k)));
});
