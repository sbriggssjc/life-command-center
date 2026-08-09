# Capital Markets close-out punch list — 2026-08-09

Grounded on packet builds `d0a3393` (both quarters). This round lands the code
fixes; two items (2, 6) are deploy/QA operations to run **after** a Railway
redeploy of this branch. Nothing here touched a production DB — the
`cm_view_registry` `display_from` values were already correct (NM `_m` = 2012,
`rent_box_q` = 2003); the packet simply wasn't applying the crop.

## What shipped (code)

### Item 1 — standard export restored as the canonical download
`capital-markets.js` (client) `bindWorkbookExport` had **both** export buttons
hardcoded to `source='packet'` (line ~2229), so Scott kept receiving the
watermarked PREVIEW packet (which is not at parity — no MasterPasteReady, missing
registered feeds). Both buttons now download the **standard** export
(`source='live'`), the full-parity marketing deliverable. The `+ Commentary`
button uses the same canonical builder: the standard export path
(`api/capital-markets.js::exportWorkbook`) now also fetches approved commentary
(`&commentary=approved|all`) and passes it to `buildCapitalMarketsWorkbook`. The
in-tab packet PREVIEW cards (`action=packet`) are unchanged — only the DOWNLOAD
is restored to the standard exporter.

### Item 3 — bid-ask axis min, shared path + loud assertion
`padSnapRange` is now the single axis-fit used by **both** artifacts for the
bid-ask cap axis:
- native XLSX (`cm-native-chart-injector.js`) — already used it; unchanged math.
- PNG image (`cm-chart-image-renderer.js`) — replaced the hardcoded
  `{min:0.055,max:0.10}` with `padSnapRange` over the plotted Last-Ask + Achieved
  band (falls back to the literal only when < 2 finite points).

New shared assertion `assertPercentAxisMin({label,dataMin,axisMin})` (exported
from `cm-native-chart-injector.js`) logs a greppable
`[cm-axis-assert] ZERO-FLOOR VIOLATION` to the export log when a percent axis
whose data-min > 1% ends up pinned to a min ≤ 0. Both artifacts call it on the
bid-ask cap axis, so a zero-floor regression fails loudly instead of shipping.
On live data the computed min is ≈ 0.055 (dia) / ≈ 0.06 (gov) — never 0.

**Final (the four-strikes root cause).** The axis MATH was always correct; the
recurring 0 floor came from the bid-ask SPREAD series (~0.6% at min) sharing the
cap axis, which dragged data-min below 1% and made `padSnapRange`'s near-zero
exemption floor to 0 *legitimately*. The definitive design (the original draft):
the spread is NEVER a cap-axis series — it is only the floating high-low bar
geometry between the Last-Ask (bottom) and Achieved (top) cap lines. The cap axis
is fit to ONLY its assigned series (Last-Ask + Achieved) via the single per-axis
helper `fitPercentAxis(label, seriesValues, opts)` (exported), which fits +
asserts in one call so the pinned range and the zero-floor check can never
diverge. Both artifacts use it. Empirically verified on live dia data:
`data-min=0.062 → axis 0.06–0.081`, no zero-floor. One chart, both artifacts.

**Excel axis-floor (the actual shipped-book symptom).** The PNG artifact fit
correctly, but the native XLSX book still showed a 0–8% axis: the spread was
rendered as a floating bar via a STACKED BAR (invisible last_ask base + visible
spread). In Excel a stacked bar/column forces the value axis to include 0 (the
base spans 0 to last_ask), so c:min is silently ignored — the bars float right
but the axis stays anchored at 0. Fix: the native bid-ask is now the master's
R50 design — two cap LINES (Last-Ask + Achieved) on ONE line-only value axis
(line charts do NOT force a 0 baseline, so c:min is honored, fitting ~6-8%),
with chart-level upDownBars drawing the gray floating high-low bar for the
spread between them. Verified: the built XML is a lineChart (no barChart)
carrying c:min val="0.06" plus upDownBars.

### Items 4 & 7 — packet now applies the display_from crop
`buildLivePacket` (the packet path `fetchQuarterly` feeds) never applied the
per-series `display_from` crop that the standard export applies, so the frozen
packet carried the full ungated history (Data_NM_vs_Market from 2001-01-31,
Data_Rent_PSF_Box from 1983). It now reads `cm_view_registry` and crops each
chart's rows exactly like `exportWorkbook`. The registry values were already
correct, so no DB change was needed.

### Item 5 / 7 — modeled rent box (shipping artifact = standard export)
The standard export (now the canonical download) already: pushes the single
`rent_psf_box_quarterly_modeled` chart titled **"Rent/SF — Quarterly Box (incl.
modeled rents)"**, gates to `n_points >= 6`, windows to 2003-forward, keeps
`basis_scope` visible, and suppresses the legacy actuals chart
(`CHART_SUPPRESSED_BY_VERTICAL`). dia-only. Verified in code
(`api/capital-markets.js` ~1860). The packet's actuals box is now cropped to
2003; full modeled-box parity **in the packet** is part of the deferred
shared-build refactor (item 6) and is unnecessary for the shipping deliverable.

## Operational steps to run AFTER redeploy

### Item 2 — Q2-2026 re-freeze (full registered set)
The Q2 frozen snapshot predates the phase-cap lift + these crops. Re-freeze both
verticals with `live=true` (forces a live rebuild and re-inserts the snapshot):

```
GET /api/capital-markets?action=packet&vertical=dialysis&quarter=Q2-2026&live=true
GET /api/capital-markets?action=packet&vertical=gov&quarter=Q2-2026&live=true
```

(Send with the `X-LCC-Key` / session the app uses.) Then confirm both quarters
carry identical sheet coverage:

```
GET /api/capital-markets?action=packet_status&vertical=dialysis
GET /api/capital-markets?action=packet_status&vertical=gov
```

Both Q1-2026 and Q2-2026 snapshots should show the same chart count (the full
phase-999 registered set, ~50 sheets — not the old 41).

### Item 6 — regenerate BOTH quarters from the STANDARD export for visual check
Download from the restored **Charts + Data** button (or directly):

```
GET /api/capital-markets?action=export&source=live&vertical=dialysis&as_of=2026-03-31&format=xlsx
GET /api/capital-markets?action=export&source=live&vertical=dialysis&as_of=2026-06-30&format=xlsx
GET /api/capital-markets?action=export&source=live&vertical=gov&as_of=2026-03-31&format=xlsx
GET /api/capital-markets?action=export&source=live&vertical=gov&as_of=2026-06-30&format=xlsx
```

Visual acceptance for each:
- opens clean, no PREVIEW watermark on Cover;
- data labels float with leader lines, uniform fonts;
- **Bid-Ask**: cap axis min is a real value (~5.5%), not 0; grep the deploy log
  for `[cm-axis-assert] ZERO-FLOOR VIOLATION` — must be absent;
- **Data_NM_vs_Market**: starts ~2012, not 2001; title carries "(trailing
  24-month averages)";
- **Rent/SF — Quarterly Box (incl. modeled rents)**: single box chart renders,
  2003-forward, n>=6 only, `basis_scope` visible on the sheet.

Once both books pass Scott's visual check, the round-3 closure books; the
shared-build refactor + inversion resume after that.
