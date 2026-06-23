# Capital Markets Export — Open Topics Catalog (working tracker)

From Scott's June-23 notes (dia notes 2-15, gov 17-32) on the regenerated June-23 exports. The 30
comments collapse into **11 themes**; most are recurring from June-22 ("addressed, but extend further"
or "still not right"), a few are new. Status is grounded against the regenerated exports + live DBs.
Work each to closure before the next export turn. Priority: P1 = drives the most comments / credibility;
P3 = quick/cosmetic.

| # | Theme | Notes | Status (grounded) | Action |
|---|---|---|---|---|

### T1 — X-axis history depth (extend charts further back in time)  ·  P1  ·  ⏳ PROMPT ISSUED
**Notes:** dia 2, 4, 5, 7, 8, 9, 13 · gov 17, 20, 26, 30, 32.
**VERDICT (grounded 2026-06-23): DROPPED, not absent.** The data exists from **2001** (12/12 months/yr
for Cap-Avg/Volume/Txn; 2005 for Cap-by-Term). Volume & Txn charts plot the full range (row 5), but the
**cap-rate family truncates its series start**: Cap-TTM-Avg → row 101 (~2009), NM-vs-Market → row 233
(~2020), Returns-Index → row 101 (~2009), Cap-by-Term → row 125 (~2015). Those truncation points = the
exact years Scott flagged. It's a chart `dataStart` bug for cap-style charts, not a data/propagation gap.
**Action:** `CLAUDE_CODE_PROMPT_T1_chart_history_truncation.md` — extend the truncated cap-family charts
to their first robust data row (dia + gov); NM-vs-Market plots the market line full-range with the NM
overlay where it exists; gap-honest where genuinely thin; **leave the genuine capture-floor availability
charts (2014/2022 start) alone — that's T4.** Awaiting CC.

### T2 — Y-axis fitting on the non-cap charts  ·  P1
**Notes:** dia 3 (% of ask), 4, 10, 13 · gov (various trendlines). **Grounded:** the cap-rate auto-fit
DID land (Cap Avg 5.0-9.0%, Quartile 5.0-9.5%, NM-vs-Market 5.5-9.0%, term buckets fitted). BUT the
auto-fit only targeted the cap band [0.2%-30%], so it **missed**: the **% of asking price** secondary
axis on "Days on Market & % of Ask" (still 0-450 DOM scale; % line crushed), renewal/termination-rate
%s, and other non-cap percent trendlines. **Action:** extend the fitted-axis logic to non-cap percent
series (% of ask ~85-105%, renewal rates, returns) and secondary axes — same data-driven floor/ceiling.

### T3 — Cap-rate-by-lease-term bucket: formula + storage correctness  ·  P1  ·  recurring deep concern
**Notes:** dia 7, 13, 14 · gov 19, 31. Scott repeatedly asks: "Are the formulas correct for each bucket
(TTM avg cap rate moving monthly per lease-term-remaining bucket)? Are we storing each sale correctly?"
**Grounded:** not yet independently verified. **Action:** audit the bucket pipeline end to end — confirm
each sale is assigned to the right lease-term-remaining-at-close bucket, the monthly-rolling TTM average
is computed correctly per bucket, and the stored series matches a from-scratch recompute. Report whether
the "too smooth / little movement" is real (TTM smoothing) or a binning/averaging bug.

### T4 — Available / active deal-count history & consistency  ·  P1
**Notes:** dia 5, 8, 11, 12 · gov 27, 29, 30. Scott still sees counts "significantly lower prior to 2025"
/ "fall off prior to 2025" / "market should add >20 deals/month, especially recently." **Grounded:** the
canonical count is fixed (119 consistent across dia availability charts); BUT active-listing *capture*
genuinely began **2022-07**, so pre-2022 is sparse by collection, not formula. Scott pushes back that
there should be more history. **Action:** (a) re-confirm whether any pre-2022 availability is recoverable
(CoStar history, sold-listing inference) or is a true collection floor — state it definitively;
(b) check the monthly "added to market" count (note 29 — >20/mo expected) for an under-count bug;
(c) confirm the 2025 spike (note 11) is real vs an artifact.

### T5 — Core price-change % coverage  ·  P2
**Notes:** dia 5, 9 · gov 27. "Core price adjustment data missing 2025+" / "core price change % lacking
throughout" / "missing for 2019 and earlier." **Grounded:** not examined. **Action:** verify the
price-change (price-cut frequency/magnitude on active listings) calc + coverage; it depends on listing
history (T4), so likely thin pre-2022 — confirm and either backfill or scope honestly.

### T6 — Gov State/Municipal cap rates still read as missing  ·  P2
**Note:** gov 18. **Grounded:** the data IS there — State = 76 non-null quarters (2004-2025),
Municipal = 29 (2014-2023) — but **sparse** (gaps between quarters) and Municipal stops 2023-03.
**Action:** make the chart render the sparse points (markers / gap-aware line) so they're visible, and
investigate the Municipal post-2023 stop (real or tagging). Don't drop the series.

### T7 — Gov Returns Index too smooth (suspected formula error)  ·  P1
**Note:** gov 20. "Does not move like dialysis or our PDF/Excel — so much smoother, like a formula error."
+ extend to 1997. **Grounded:** dia returns index is fitted (4-13%); gov's is anomalously smooth vs dia.
**Action:** diff the gov vs dia Returns-Index calc — find why gov is smoother (different window, an
index that compounds out volatility, or a denominator bug). Extend the x-axis to match the volume/cap
history (~1997-2001).

### T8 — Gov lease inventory + event-count magnitude  ·  P1
**Notes:** gov 21, 22. (21) "1,500 expirations/terminations/yr vs 8,000 inventory — formula/storage
issue." (22) "Inventory now grows over time; we want point-in-time active count; believe >8,000 were
active in 2013." **Grounded:** Task-1 set active inventory to ~7,849 holdover-inclusive (point in time
now). Scott now sees the *time series* growing and wants a true point-in-time-active count per period,
and believes 2013 was >8,000. **Action:** make the inventory-over-time chart a **point-in-time active
count** per period (not cumulative); validate the historical level (was it ≥8,000 in 2013?); reconcile
the annual expiration/termination counts against the active denominator (the 1,500 vs 8,000 ratio).

### T9 — Data anomalies to investigate  ·  P2
**Notes:** dia 6 (funky 2022-23) · gov 26 (2018/19 avg = upper quartile — statistically impossible
without a data issue) · gov 28 (funky x-axis). **Grounded:** dia 2023-24 dip already explained (capture
lag); the 2022-23 "funky," the gov avg==upper-quartile, and the gov x-axis glitch are not yet examined.
**Action:** investigate each — the avg==upper-quartile one is the clearest data/calc bug signal.

### T10 — Chart design / type  ·  P3 (mostly quick)
**Notes:** dia 15 (remove the **Undisclosed Term** bar — confirmed present, 38 listings) · gov 24
(color scheme + chart types blocking each other on a combo chart) · gov 25 ("the average should be a
dot, not a bar"). **Action:** drop the Undisclosed bucket from the term-bar chart (keep the count
reconciliation in a footnote, not a bar); fix the overlapping combo chart's colors/types; switch the
flagged "average" bar to a dot/marker series.

### T11 — Gov Northmarq-sales chart  ·  P2
**Note:** gov 23. "Should be resolved now; line should move better; the market cap rate should move
closer to the avg movement in the cap-rate charts; take back further than 2020." **Grounded:** NM
attribution is fixed (gov recovered 2026); the NM line should now populate. The "market cap should move
closer to the avg cap charts" implies the market series on NM-vs-Market differs from the main Cap-TTM-Avg
series. **Action:** confirm the NM line is now populated through 2026; reconcile the "market" comparison
series so it matches the main cap-avg methodology; extend back per T1.

---

## How the 30 notes map
**Dia:** 2→T1 · 3→T2 · 4→T1+T2 · 5→T1+T4+T5 · 6→T9 · 7→T1+T3 · 8→T1+T4 · 9→T1+T5 · 10→T2 · 11→T4 ·
12→T4 · 13→T1+T2+T3 · 14→T3 · 15→T10.
**Gov:** 17→T1 · 18→T6 · 19→T3 · 20→T7+T1 · 21→T8 · 22→T8 · 23→T11+T1 · 24→T10 · 25→T10 · 26→T9+T1 ·
27→T4+T5 · 28→T9 · 29→T4 · 30→T4+T1 · 31→T3 · 32→T1.

## Suggested working order
1. **T1 (history depth)** + **T3 (bucket correctness)** + **T4 (available counts)** — the three that
   drive ~20 of the 30 notes and the "doesn't match our PDF" credibility issue. All need a data-coverage
   /formula audit first (is it absent data or dropped data?), then a fix.
2. **T2 (non-cap y-axis)** + **T7 (returns index)** + **T8 (inventory point-in-time)** — targeted fixes.
3. **T6, T5, T9, T11** — investigations.
4. **T10** — quick cosmetic cleanups (Undisclosed bar, dot-not-bar, combo colors).
