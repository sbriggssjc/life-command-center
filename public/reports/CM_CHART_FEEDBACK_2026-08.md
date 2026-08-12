# Capital Markets chart feedback — resolution log (2026-08)

Scott's 11 observations on the NM-CapMarkets-Dialysis exports. Grouped A (chart
injector / exporter), B (views / data), C (verified-correct, document only).

## Group A — chart injector / exporter (`api/_shared/cm-*.js`, `api/capital-markets.js`)

| Item | Status | What shipped |
|---|---|---|
| **1 — Branding** | ✅ | `CM_BRAND` externalized to checked-in `public/reports/cm-brand.json` (Briggs Standards v3 / NM 2024, per-vertical overridable). Explicit `a:latin` typeface on every chart text run (default **Open Sans**, `typefacePreferred` Futura PT — flip one config value once installed everywhere). Off-brand accents retired to NM-palette-only (sage→peridot, amethyst→on-brand amethyst, orange→steel benchmark, off-brand grays→charcoal / NM-Blue-12 gridline). Off-palette linter logs any regression to the export driftWarnings. |
| **2 — Callouts** | ✅ | Standard max/min/latest module with role-based manual-layout offsets + `showLeaderLines`. Single-line charts auto-annotate (format inferred from the y-axis numFmt). |
| **3 — Y-axis ranges** | ✅ | Bid-ask cap axis data-fit over the plotted Last-Ask/Achieved window (killed the fixed 5.5–10% band that left bars floating). Cap-family axes already fit-first via `capFit`. |
| **8 — Undisclosed Term** | ✅ | Exporter filters the `Undisclosed Term` bucket out of the Data_Avail_by_Term breakdown + bar; the listings stay in every total-market metric. |
| **11 — Volume boxy** | ✅ | `quarterly_volume_bars` rebuilt as a trailing-3-month rolling SUM of true monthly volume/count (`master_m.monthly_volume`), at monthly grain — moves monthly instead of repeating the quarter total 3×. Headers → "Rolling 3-Mo …". |
| **(gap-skip)** | ✅ | All native builders emit `dispBlanksAs="gap"`; PNG renderer uses `spanGaps:false`. Interior nulls gap-skip (sentiment core, DOM core, NM-vs-market early, rent thin quarters). |

## Group B — views / data (migrations under `supabase/migrations/`)

| Item | Status | What shipped |
|---|---|---|
| **4 — NM vs Market** | ✅ | dia NM leg converted dollar-weighted → **simple TTM average** (matches every other cap chart); gov MARKET leg converted weighted-whole-market → simple average, **NM-excluded**. Dollar-weighted kept as `*_cap_wtd` (reference, not charted). `display_from` curated to **2012** (a real but isolated pre-GFC 2008 NM cluster + genuine 2009–2011 collapse would otherwise start the plot at ~2008); injector MIN_YEAR floored at 2012. |
| **5 — Sentiment core dying** | ✅ | Added trailing-8-quarter (= 24-month) core columns to `cm_dialysis_seller_sentiment_m` (+ `_q`): `pct_price_change_long_term_8q`, `last_ask_cap_long_term_8q`, gated ≥5 over the 8q window. Chart core bar + cap line bind to these (label "(trailing 8-qtr)"), fall back to single-quarter for gov. Core now prints through the latest quarter. |
| **10 — DOM core null 2025** | ✅ | `cm_dialysis_dom_price_change_active_m`: lowered the core size floor 16→5 and dropped the `history≥1` clause, so a valid cohort emits its true rate (0 included); NULL only below 5. Fixes the Aug–Nov 2025 gap (those months had 12–15 core listings at ~7–8%). |
| **6 — Rent box empty 2023+** | ⚠️ see below | (a) status reported; (b) no safe Supabase backfill; (c) already handled at the view level. |

### Item 6 (rent box) — grounded finding

- **(a) Status.** `leases` **does** carry 2023+ rows — the gap is **missing rent**, not missing leases: only ~19–27 leases/yr have `rent_per_sf` (2023: 19/91, 2024: 24/68, 2025: 27/63), so most quarters fall under the n≥6 quartile gate. Sources present on `leases`: `costar_import`, `costar_sidebar`, `email_intake`, `master_import`, `folder_feed_lease`, `davita_subledger`.
- **(b) No safe cross-source backfill.** There is **no unambiguous Supabase rent source** to fill `leases.rent_per_sf`: the master comp workbook carries an annual sales-comp `rent` + `property_id` + `lease_expiration` but **no** `rent_per_sf` / `leased_area` / `lease_start`, and `available_listings` has no `rent_per_sf`. Filling from those would require fuzzy matching + a rent that isn't the lease-start rent — a violation of the conservative / never-guess / fill-blanks doctrine. The durable fix remains the **ingestion path**: route the processed CoStar lease exports into `leases` (idempotent upsert keyed on `property_id` + `lease_start` + `leased_area`, fill-blanks) so real rent lands going forward. Not auto-backfilled this round.
- **(c) Chart already trims/marks.** `cm_dialysis_rent_box_q` emits **every** quarter and NULLs the 5-number summary when `n_leases < 6`; the exporter's Data_Rent_PSF_Box sheet surfaces the `N Leases` column and the native chart gap-skips the NULL (thin) quarters. Thin quarters are therefore visibly marked (count shown, box blank) rather than plotted as empty space, and the n≥6 quartile gate is **not** lowered.

## Group C — verified correct, documented (no formula change)

| Item | Status | Note |
|---|---|---|
| **7 — Active cap quartiles "too consistent"** | ✅ documented | True per-period quartiles of the disclosed-cap active cohort; flat 4–10-month runs reflect slow inventory turnover (~470-day avg DOM), not the formula. Registry note added. |
| **9 — Available market size avg caps** | ✅ documented | Point-in-time active-cohort avg (changes 37 of 38 periods); smoothness = slow turnover. Registry note added. |

## Marketing chart-object formatting pass (`ChartEdits.docx`, 2026-08-11)

Corporate marketing sent a chart-formatting checklist to align our Capital
Markets Excel exports with their website/PDF editing process. Applied to **all**
charts in **both** the dialysis and government exports, driven by `cm-brand.json`
(data, not code) so any value is a one-line change:

| Edit | Where | Value |
|---|---|---|
| Chart Area: No Fill + No Line | native injector `applyChartAreaBranding()` (chartSpace `<c:spPr>`) | transparent / no outline |
| Chart Area default font | `cm-brand.json.typeface` + `sizes.chartArea`; chartSpace `<c:txPr>` | Futura PT Book, 8 pt |
| Chart Title | `chartTitleXml()` reads `sizes.title` + `text.title` + `typeface` | Futura PT **Bold**, **14 pt**, NM Blue `#003DA5` |
| X-axis label Interval Unit = 1 | `applyChartAreaBranding()` catAx `tickLblSkip`/`tickMarkSkip` | every label/tick |
| Fixed chart size (non-donut) | `cm-brand.json.chartSize` → oneCellAnchor explicit EMU ext | 4.25″H × 10.00″W |
| Fixed chart size (donut) | same | 4.25″ × 4.25″ square |
| Typeface | `cm-brand.json.typeface` (was Open Sans) | **Futura PT** |
| PNG/QuickChart fallback | `cm-chart-image-renderer.js` (`CM_PNG_FONT`/`CM_PNG_TITLE_*`) | Futura PT, 14 pt bold NM-Blue title |

**Interpretation calls (documented so they're not re-litigated):**
- Title "Size: 140" in the doc → read as **14.0 pt** (a literal 140 pt title
  overflows a ~4″ chart). Change `sizes.title` in `cm-brand.json` to override.
- Two conflicting size lines ("entire chart 3.55″×10.12″" vs "Chart area size
  4.25″×10.00″") → the explicit **Chart area size** was taken as authoritative.
  Change `chartSize` in `cm-brand.json` to use 3.55×10.12 instead.
- **Futura PT** is now the default typeface. ⚠️ If a machine that opens/edits an
  exported workbook lacks Futura PT installed, Excel silently falls back to the
  theme font — keep it installed on editors' machines, or flip `typeface` back to
  `Open Sans`.

Brand-standard docs updated so this is durable for future projects:
`docs/brand/NORTHMARQ_BRAND.md` §2A (byte-identical in the Dialysis + government
repos), and the Brand Standards section of each repo's `CLAUDE.md`.

## Charts tab now shows EVERY chart (2026-08-12)

Scott flagged that charts on the per-tab Data_* sheets were missing from the
aggregate "Charts" tab — especially on the government export. Root cause: the
Charts tab went **pure-native** and **dropped every chart template without a
native builder** (`orphanedPngs`), because Excel allows only one `<drawing>`
per sheet and mixing ExcelJS `addImage` with the native-chart injector on the
same sheet conflicts.

Inventory (from `cm_chart_catalog.json` vs `NATIVE_CHART_TEMPLATES`):
- **gov: 11 of 23** templates were dropped from the Charts tab (incl. the
  `top_buyers_table` / `top_sellers_table` DataTables).
- **dia: 12 of 24** dropped.

Fix: the native-chart injector (`cm-native-chart-injector.js`) now also embeds
**PNG picture anchors** (`<xdr:pic>`) in the **same drawing** it builds for a
sheet — so the Charts tab hosts native chart objects AND rendered-image charts
together in one `<drawing>`. `cm-excel-export.js` pushes each non-native chart's
PNG as an `{ image: { png, anchor } }` injection instead of dropping it. Result:
the Charts tab is a complete single-page view of every chart. Data-table
templates (no rendered chart image) stay on their own Data_* tabs. Images are
sized to the same 10.00″×4.25″ tile as the native charts so the stack lines up.

**Embed ONLY genuinely-non-native templates.** A template that IS in
`NATIVE_CHART_TEMPLATES` but ends up orphaned is either deliberately suppressed
for the vertical (dia `rent_psf_box_quarterly` — superseded by the modeled
variant `rent_psf_box_quarterly_modeled`) or a native chart that failed to
queue; in both cases the native chart is the source of truth, so we must NOT
embed a stale QuickChart PNG of it (Scott flagged the suppressed dia rent box
reappearing as a duplicate PNG). The embed filter therefore excludes any
`NATIVE_CHART_TEMPLATES` member and anything `isChartSuppressed(vertical, …)`.

## Blocking inputs from Scott / marketing

1. **Chart font** — provide the exact style-guide font name (and confirm installed on every machine that opens these workbooks); flip `cm-brand.json.typeface` from Open Sans.
2. **cm-brand.json vs 2024 PDF** — diff the token hexes against the 2024 guide data-styling page + `colorproportions.png` (both live in OneDrive `_WORKFLOW`, not reachable from the build sandbox); correct any delta in `cm-brand.json._source._deltas_vs_2024_pdf`.
3. **Rent comps** — to actually fill the 2023+ rent box, route the processed CoStar lease exports into `leases` (the ingestion path above).
