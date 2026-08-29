**To:** Sarah Martin
**Subject:** RE: Dialysis Book Updates — final round of edits

Sarah,

This is really close — great work. Answers to your four notes first, then one batch of number fixes. Almost all of the fixes trace to the same root cause: the year-ago comparison figures were revised in the newest export, and several pages still carry the old ones.

**Your notes**

1. **Trend Watch:** You read my instructions right — the two tables belong exactly where you put them (now page 21). Sorry for the page-number confusion. Two tweaks on that page: the header should read **"(through June 30, 2026)"** (still says March 31), and the inventory bullet should read "Active listings fell to 204 **(from 232 at Q1)**" — the 292 was from the prior export.
2. **KPI_Inv_Snapshot % formatting:** My export bug — the last two rows came over as unformatted decimals. You rendered them correctly (5.26% / 15.05%); it's fixed in the exporter going forward.
3. **Operator Benchmark y-axis labels:** Easiest fix — edit the names directly in the first column of the Data_Operator_Bench tab and the chart will pick them up: **American Renal · DaVita · Independent · Fresenius · US Renal · Other · Satellite**. I'll emit the short names in the next export.
4. **Page 36 as two pages:** Agreed — split it. Asking Cap Rate Quartiles (with its current text, which is correct) on one page; Marketing Duration & Price Adjustments on the next, with the corrected text in item 5 below. That also gets the chart titles back to full size.

**Number/text fixes (new page numbers)**

1. **Page 10 — DaVita:** Revenue should read **$13.643B (FY 2025)** — the current "$13,643B" has a comma where the decimal belongs. Also update the source line to "DaVita Q4 2025 earnings release and FY 2025 10-K (filed February 2026)."
2. **Page 31 — Buyer Pool:** Two text fixes. Left column, the 10-year sentence contradicts itself ("eased… expanded… dampening"). Replace with: *"The cost of capital backed up modestly — the 10-Year averaged ~4.47% in Q2 and closed at 4.44%, up roughly 20 bps from Q1 — tempering re-engagement, particularly among private and exchange-driven investors."* Right column, replace the counts sentence with: *"Private/individual buyers — family offices, individuals, and trusts — account for 155 of the 178 TTM transactions. Institutional/fund buyers closed 8 and public REITs 15 — the REIT count still below its long-term average of 21 but trending in the right direction as public capital returns to the space."*
3. **Buyer Pool — add the second chart back:** Please add the **Annual % of Volume** chart on its own page following 31 (per my earlier note, we want both). For the overlapping labels: apply custom number format `0%;;;` to each series' data labels — zeros render blank, which solves the pileup at the top.
4. **Page 33 — On-Market Snapshot:** The whole 2Q-2025 column was revised in the new export. It should read — Total Market: **197 / $3,882,922 / 6.97% / 7.74% / 6.02% / 6.65% / 440 / 15.3%**. 10+ Year: **16 / $4,279,327 / 6.71% / 6.87% / 6.24% / 6.50% / 405 / 5.9%**. Current-quarter Price Change is **15.0%** (not 15.5%). In the narrative: "204 clinics (from **197** a year ago and **232** at Q1)"; "15.0% of listings recorded a price change (from 15.3%)"; "Core 10+ Year: 19 offerings (**16** a year ago)"; "Core DOM **rose to 421 days (from 405)**" — it didn't improve from 462; that figure was revised. These values all come from the Data_On_Market_Snapshot tab, which carries both current and year-ago — use that tab for this page and the p21 KPI block (I'll reconcile the small DOM differences in the KPI tab on my side).
5. **Page 34 — Supply Side Metrics:** Same year-ago fix in the narrative: "204 total clinics vs. **197** a year ago; 19 core vs. **16**." Also, the "ASKING CAP RATE RANGES" text block on this page describes the quartile chart that now lives on page 36 (and its numbers match nothing current) — delete it and replace with copy for the chart actually on the page: *"AVERAGE PRICE BY TERM BUCKET — Pricing still ladders with duration: average asking caps step from 7.16% in the sub-5-year bucket to 6.27% at 12+ years (medians 6.81% → 5.93%), while average deal size climbs with term. Duration continues to command the premium on the ask side."*
6. **Page 36 — Marketing Duration paragraph:** Replace the stat sentences with: *"Total Market active DOM 345 days (253 a year ago); Core 269 days (from 235). Price-change frequency: 15.0% total, 5.3% core."* Core is no longer flat — both cohorts' DOM rose as the well-priced product cleared, so drop the "(277, flat)" language; the survivorship sentence that follows still works.
7. **Page 39 — DOM & % of Ask:** The text contradicts its own chart (which is correct). Update to: "closed-deal DOM averaged **256 days (from 267 at Q1; 235 a year ago)** while capture held at **89.5%** of original list."
8. **Page 44 — Value Prop:** Non-Northmarq average sales price is **$4,912,611** (page shows $4,925,828). Additional Proceeds Realized = **$269,569**; Additional Value = **5.5%** — update both the infographic tiles and the paragraph ($265,788 → $269,569; "10% more value" → "5.5% more value"). On your sticky note about the chart not matching the table: that's expected — the chart callouts are **trailing-24-month** confirmed-cap averages (7.02% market / 6.96% NM) while the table tiles are **trailing-12-month** TTM (7.03% / 7.15%). Both are right; they're different windows. Safe to remove the note.

**Still to come from me:** text for page 4 (TOC/bio), page 14 (Ozempic updates), and page 15 (AAKH). I'll get those to you this week — everything else above should close out the book.

Thanks,
Scott
