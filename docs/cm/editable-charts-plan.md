# Editable Excel Charts — Status

**Status (2026-05-19):** ✓ Complete. 51 native chart templates ship in dia + gov + national_st exports. Only 2 templates remain on the PNG path, both intentional non-charts (one dropped from catalog, one renderer returns null by design).

See **[`native-chart-migration-summary.md`](./native-chart-migration-summary.md)** for the authoritative reference covering:

- The architectural pivot from `master_template` (R33 attempt, reverted) to `data_tabs` + JSZip-injected native chart XML (R34+ approach)
- All 9 chart-XML builders in `cm-native-chart-injector.js` and which templates use each
- Helper-column infrastructure for derived data (IQR width, trendlines, computed series bottoms)
- Per-template dispatch table for all 51 native templates
- Known visual defers (per-data-point coloring, in-bar datalabels, etc.)
- How to add a new chart template

## Historical context (R33 attempt, reverted)

The original PR #819 flipped the dialysis export default from `data_tabs` to `master_template`, expecting the pre-wired chart objects in `assets/cm-templates/dialysis-master-template.xlsx` to render once their referenced cell ranges were populated. It failed: `cm-template-loader.js` only populated columns B-O of the `Charts` sheet, leaving ~25 of the 37 chart objects blank. PR #820 reverted.

R34 took the inverse approach: keep the `data_tabs` layout (one chart per tab), but inject native chart XML directly into the workbook buffer at the data-table location, replacing the embedded PNG with an editable `<c:chartSpace>`. That approach worked and scaled across 20 PRs spanning R34 → R36 P4.

## Where to look

- **Code**: `api/_shared/cm-native-chart-injector.js`, `api/_shared/cm-excel-export.js`
- **Tests**: `test/cm-native-chart-injector.test.mjs` (118 CM tests pass as of R36 P4)
- **Per-PR trackers**: `supabase/migrations/2026064[1-9]*` + `2026065[0-9]*` (historical records of each migration step)
- **Master template inventory** (for reference, not currently used by the export path): `dia-master-template-chart-inventory.txt`
