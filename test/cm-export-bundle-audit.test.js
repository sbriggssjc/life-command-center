// ============================================================================
// Capital Markets — Export Bundle Audit (Round 5b CI gate)
//
// Asserts that every chart_template_id in the catalog snapshot has a tab name
// AND a column schema (or a special-renderer registration) in
// cm-excel-export.js.
//
// The Round 5a audit caught 14 catalog rows whose TAB_NAMES / CHART_COLUMNS
// were missing — silently dropped from every export. This test makes the
// next one fail on `npm test` rather than after deploy.
//
// When a new chart_template_id is added to cm_chart_catalog, follow up with:
//   1. Re-run `node scripts/cm-refresh-catalog-snapshot.mjs` to regenerate
//      test/fixtures/cm-catalog-snapshot.json.
//   2. Add a TAB_NAMES entry + CHART_COLUMNS schema in cm-excel-export.js
//      (or, for special render paths, add the chart_template_id to the
//      `specialRenderers` set in getExportBundleSchema()).
//   3. `npm test` should pass.
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getExportBundleSchema } from '../api/_shared/cm-excel-export.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = join(__dirname, 'fixtures', 'cm-catalog-snapshot.json');

const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
const schema   = getExportBundleSchema();

const tabNames        = schema.tabNames;
const chartColumns    = schema.chartColumns;
const specialRenderers = schema.specialRenderers;

// Catalog rows we care about for the export-bundle audit. Filter out
// `national_st` (different render path / lower priority) — we only enforce
// for `dialysis` + `gov` since those are the active deliverables.
const auditableTemplates = snapshot.templates.filter((t) =>
  t.applies_to_verticals.includes('dialysis') ||
  t.applies_to_verticals.includes('gov')
);

// ---------------------------------------------------------------------------
// Known-missing TAB_NAMES allow-list (deltas doc item #21 — Round 5b deferral)
//
// These chart_template_ids have valid catalog rows but no TAB_NAMES /
// CHART_COLUMNS in cm-excel-export.js, so they silently drop from every
// export. Most need bespoke chart-type renderers (ScatterChart, PieChart,
// StockChart, etc.) — fixing them is larger than the Round 5b CI-gate scope.
//
// **Do NOT add new entries to this list.** When you add a new
// chart_template_id to the catalog, the right answer is to also add the
// TAB_NAMES + CHART_COLUMNS in the same PR, not to allow-list it.
//
// To remove an entry: ship the corresponding TAB_NAMES + CHART_COLUMNS
// (or a special-renderer registration) in cm-excel-export.js, then delete
// the line below. The test should then pass.
// ---------------------------------------------------------------------------
const KNOWN_MISSING_TAB_NAMES = new Set([
  // Round 6h (2026-05-09) — 7 of the prior 11 entries removed because the
  // catalog rows themselves were deleted (no backing views, never had TAB_NAMES,
  // never going to ship). Path 1 cleanup per deltas-doc Item #21.
  // Remaining holdouts:
  'market_share_pie_ttm',           // PieChart, dialysis+gov — view exists but
                                    // bucket-label data quality issue (broker
                                    // contact strings as labels). Fix view
                                    // before wiring renderer.
]);

test('cm-export-bundle-audit: every catalog row has a TAB_NAMES entry (excluding the deltas-doc-#21 deferral list)', () => {
  const missing = [];
  for (const t of auditableTemplates) {
    if (KNOWN_MISSING_TAB_NAMES.has(t.chart_template_id)) continue;
    if (!tabNames[t.chart_template_id]) {
      missing.push({
        chart_template_id: t.chart_template_id,
        chart_type:        t.chart_type,
        applies_to:        t.applies_to_verticals.join(','),
      });
    }
  }
  assert.equal(
    missing.length, 0,
    `${missing.length} NEW catalog template(s) missing from TAB_NAMES — these will silently drop from every export:\n` +
    missing.map((m) => `  - ${m.chart_template_id} (${m.chart_type}, ${m.applies_to})`).join('\n') +
    '\n\nFix: add TAB_NAMES entry in api/_shared/cm-excel-export.js, or add the template to ' +
    'getExportBundleSchema().specialRenderers if it uses a dedicated render path.'
  );
});

test('cm-export-bundle-audit: known-missing allow-list is still actually missing (otherwise prune it)', () => {
  // Reverse check: anything in KNOWN_MISSING_TAB_NAMES that NOW has a
  // TAB_NAMES entry should be removed from the allow-list. This stops the
  // allow-list from drifting and silently masking new bugs.
  const stillMissing = [];
  const accidentallyFixed = [];
  for (const id of KNOWN_MISSING_TAB_NAMES) {
    if (tabNames[id]) {
      accidentallyFixed.push(id);
    } else {
      stillMissing.push(id);
    }
  }
  assert.equal(
    accidentallyFixed.length, 0,
    `${accidentallyFixed.length} chart_template_id(s) on the allow-list now have TAB_NAMES — remove them from KNOWN_MISSING_TAB_NAMES:\n` +
    accidentallyFixed.map((id) => `  - ${id}`).join('\n')
  );
});

test('cm-export-bundle-audit: every TAB_NAMES entry has matching CHART_COLUMNS or a special renderer', () => {
  const missing = [];
  for (const t of auditableTemplates) {
    if (!tabNames[t.chart_template_id]) continue;          // covered by previous test
    if (specialRenderers.has(t.chart_template_id)) continue; // dedicated render path
    if (!chartColumns[t.chart_template_id]) {
      missing.push({
        chart_template_id: t.chart_template_id,
        chart_type:        t.chart_type,
      });
    }
  }
  assert.equal(
    missing.length, 0,
    `${missing.length} catalog template(s) have TAB_NAMES but no CHART_COLUMNS — these will silently drop from every export:\n` +
    missing.map((m) => `  - ${m.chart_template_id} (${m.chart_type})`).join('\n') +
    '\n\nFix: add CHART_COLUMNS schema in api/_shared/cm-excel-export.js, or add to specialRenderers.'
  );
});

test('cm-export-bundle-audit: TAB_NAMES values are unique (no Excel-tab collisions)', () => {
  const seen = new Map();
  const collisions = [];
  for (const [id, name] of Object.entries(tabNames)) {
    if (seen.has(name)) {
      collisions.push({ name, ids: [seen.get(name), id] });
    } else {
      seen.set(name, id);
    }
  }
  assert.equal(
    collisions.length, 0,
    `${collisions.length} duplicate TAB_NAMES — Excel will throw on workbook build:\n` +
    collisions.map((c) => `  - "${c.name}" used by ${c.ids.join(' and ')}`).join('\n')
  );
});

test('cm-export-bundle-audit: TAB_NAMES values fit Excel\'s 31-char limit', () => {
  const overlong = [];
  for (const [id, name] of Object.entries(tabNames)) {
    if (name.length > 31) {
      overlong.push({ id, name, length: name.length });
    }
  }
  assert.equal(
    overlong.length, 0,
    `${overlong.length} tab name(s) exceed Excel's 31-character limit:\n` +
    overlong.map((o) => `  - ${o.id} → "${o.name}" (${o.length} chars)`).join('\n')
  );
});
