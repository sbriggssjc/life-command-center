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

## Blocking inputs from Scott / marketing

1. **Chart font** — provide the exact style-guide font name (and confirm installed on every machine that opens these workbooks); flip `cm-brand.json.typeface` from Open Sans.
2. **cm-brand.json vs 2024 PDF** — diff the token hexes against the 2024 guide data-styling page + `colorproportions.png` (both live in OneDrive `_WORKFLOW`, not reachable from the build sandbox); correct any delta in `cm-brand.json._source._deltas_vs_2024_pdf`.
3. **Rent comps** — to actually fill the 2023+ rent box, route the processed CoStar lease exports into `leases` (the ingestion path above).
