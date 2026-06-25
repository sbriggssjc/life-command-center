# Capital Markets Export — Open Topics Catalog (working tracker)

From Scott's June-23 notes (dia notes 2-15, gov 17-32) on the regenerated June-23 exports. The 30
comments collapse into **11 themes**; most are recurring from June-22 ("addressed, but extend further"
or "still not right"), a few are new. Status is grounded against the regenerated exports + live DBs.
Work each to closure before the next export turn. Priority: P1 = drives the most comments / credibility;
P3 = quick/cosmetic.

| # | Theme | Notes | Status (grounded) | Action |
|---|---|---|---|---|

### T1a — Dense cap-charts truncated (DROPPED data)  ·  P1  ·  ✅ FIXED (code), ⏳ rendered-gate pending
**Notes:** dia 2, 4, 7(line), 13(line) · gov 17, 20, 32. **VERDICT: dropped, not absent** — data dense
from 2001; the cap family clipped to rows 101/233/125 (~2009/2020/2015). **Fix (CC, verified at code
level in `cm-native-chart-injector.js`):** the R47 `MIN_YEAR_BY_TEMPLATE` trim used
`findFirstDenseYear(...,'transaction_count_ttm')` on views with **no such column** → silently fell back
to a hardcoded 2009; now replaced with `firstNonNullYear()`. Extended: `cap_rate_ttm_by_quarter`,
`cash_leveraged_returns` (returns index), `cap_rate_by_lease_term` (LINE), `nm_vs_market_cap` (market
line full-range, NM overlay gaps to ~2014). gap-honest via `dispBlanksAs='gap'`. Volume/Txn untouched.
**JS change → live on Railway redeploy of merged main.** GATE REMAINING: confirm against a freshly
regenerated export that series start = ~2001/2005. (Note: dia cap-TTM shows a lone 2001 point then gaps
2002-04 — a one-line floor to 2005 is available if it reads oddly.)

### T1b — Floored "sparse/degenerate" charts (DECISION for Scott)  ·  P1  ·  ❓ OPEN — your call
**Notes Scott's June-23 also touches:** dia 7/13/14 (the cap-by-term DOT plots), gov 26 (quartiles),
+ DOM/%ask, sentiment. **These were deliberately NOT extended** — they keep prior, *Scott-confirmed*
floors because the early data is genuinely degenerate, not dropped:
- `sold_cap_by_term_dot_plot` dia **2019** / gov 2015, `asking_cap_by_term_dot_plot` dia **2017** / gov
  2015 — cohort lines cross on n<5 small samples (R76-A3, Scott 2026-06-10: "genuine sparsity").
- `cap_rate_top_bottom_quartile` **2007** — 2005-06 has 0-3 samples → degenerate Q1=Med=Q3 (R54).
- `dom_and_pct_of_ask` 2018/2016, `seller_sentiment` 2016, `bid_ask_spread` density floor.
**RESOLVED (Scott, 2026-06-23): KEEP the existing floors.** Only T1a (the dense-data truncation) was
the real bug; these charts stay floored where the data is genuinely sparse/degenerate. CC's T1 fix is
complete and correct as shipped — no further change. (So when these charts still "start late" in the
next export, that is intended, not a miss.)

### T2 — Y-axis fitting on the non-cap charts  ·  P1  ·  ⏳ PROMPT ISSUED (axis split from data)
**Grounded against the June-25 export (Scott's per-chart notes 2026-06-24).** The "% of ask crushed under
the 0-450 DOM scale" headline was ALREADY fixed (the native injector + PNG renderer put % on a fitted
secondary right axis, injector ~3431) — the June-23 note was stale. The REAL residuals are
mis-RANGED axes (clip or whitespace), split from genuine DATA issues:
**Pure axis fixes — `CLAUDE_CODE_PROMPT_T2_axis_fit.md` (do now, config-only, both injector + PNG):**
1. dia `dom_and_pct_of_ask` % axis `{0.84,0.96}` CLIPS (data 0.78-0.99; line exits top 2016-17 / bottom
   2015) → widen to ~{0.78,1.00}/data-fit.
2. gov `dom_and_pct_of_ask` % axis `{0.85,1.05}` TOO WIDE (line only 0.92-0.97) → tighten ~{0.90,1.00}.
3. gov `lease_termination_rate` rate-line ceiling 25% TOO HIGH (line <10%) → ~{0,0.10}.
4. dia `sold_cap_by_term_dot_plot` cap axis `{0.05,0.10}` SQUEEZED (data 5.5-7.5%) → ~{0.055,0.075}.
**DATA issues — queued (Scott: resolve data before y-axis):**
- dia Asking Cap Quartiles (active) flat (core+overall) → **T9** (active-cap data static).
- dia Asking Cap by Lease Term moves too smoothly → **T3b-asking** (apply the T3 sold-side de-smoothing /
  bucket fix to the ASKING side; the sold side now "moves like it's more accurate").
- gov Cap by Remaining Lease Term "all over the place" → **T9** (data review).
- gov core cap dot plot 5-6 outliers to investigate/exclude, then ~9% ceiling → **T9** then axis.
- gov Lease Termination COUNTS bar — wants ACTIVE leases per interval over time (>1,750 in 2013; looks
  like only currently-active projected back) → **T8** (point-in-time historical active-lease count).

### T3 — Cap-by-term: VIEW FORMULA correct (verified) ✅  ·  but T3b export-mapping inconsistency found ⚠
**Notes:** dia 7, 13, 14 · gov 19, 31.
**T3 VERDICT (CC full-series recompute, both DBs): the view math is correct** — 303×4 (dia) / 255×5
(gov) cells diffed cell-by-cell vs a from-scratch recompute = **max abs diff 0.0, 0 NULL mismatches**.
Term basis (`firm_term_years_at_sale`) + bucketing + TTM avg all reconcile. (My own spot-check matched
too — but on `cm_dialysis_cap_by_term_m`; the EXPORT reads `cm_dialysis_sold_cap_by_term_dot`, the
smoothed one — see T3b.) Benign: dia 14% / gov 22% of cap-eligible sales have NULL term → unbucketed
(missing lease data, not mis-bucketing). Methodologies differ by design: dia = mean/1yr-TTM/n≥3/9-mo MA;
gov = median/2yr-TTM/n≥5/7-mo MA.

### T3b — Export MAPPING ≠ the manual MASTER workbook (the real "doesn't move" cause)  ·  P1  ·  ❓ DECISION
Triggered by Scott's manual `Dialysis Comp Work MASTER.xlsx` (his trusted historical source). Its
lease-term chart = **4 buckets (12+/8-12/6-8/≤5), raw SOLD CAP, TTM, NO smoothing**, term=(EXP−DATE)/365
(= same basis as the DB). **The export is inconsistent with it in TWO ways (verified in code):**
1. **Rendered line chart** (`capital-markets.js:455`) draws the **gov 3-bucket scheme (10+/6-10/<5)** for
   dialysis — no vertical branch — instead of the 4-bucket dia scheme. Plain bug.
2. The path that DOES use 4 buckets (the Excel tab, via `cm_dialysis_sold_cap_by_term_dot`) layers a
   **9-month centered MA + n≥3 density floor** the manual never had → halves month-over-month movement
   (12+ bucket: raw 5.1 bps/mo → export 2.1; ≤5: 7.1 → 3.0). That's the visible "flatness."
**Decision (Scott):** Option 1 (recommended) — lock dia to 4 buckets on BOTH surfaces (fix line 455
vertical-aware) + drop the 9-mo MA & density floor for dia so it tracks raw TTM like the manual. Option 2
— keep some smoothing but make rendered+Excel consistent and document it as intentionally smoothed.
**Note:** this is the WITHIN-RANGE movement/bucket fix; the T1b display-start floors (2019/2017) are
separate and stay. Level-only diffs (cap_rate_final clamped [4-12%] vs manual raw SOLD CAP; ~13mo vs
12mo window) don't affect movement — keep cap_rate_final (cleaner) but match window/buckets/no-MA.

### T4 — Available / "added-to-market" deal counts  ·  P1  ·  ✅ CLOSED at baseline (confirm-and-stop)
**Notes:** dia 5, 8, 11, 12 · gov 27, 29, 30. **VERDICT: TWO metrics conflated** — (1) point-in-time
ACTIVE count (collection floor 2022-07), (2) "added/mo" (recoverable from `listing_date`, ~25-29/mo,
**CC verified already correct**). **Final resolution (2026-06-24): T4 = confirm-and-stop at BASELINE,
zero view edits** (dia `43fff57`, gov `3e2ce0f`; the interim DOM/freshness/suppress edits were reverted).
Grounded findings, all KEEP-as-is: the latent intake-fake-date leak touches **no published quarter**;
gov `synthetic_from_sale` is a **load-bearing historical inventory proxy** (50 of 100 props at 2020 are
real sales-derived inventory — a blanket exclusion would cut older-year inventory ~50%) → kept; the **≥20
sentinel** already correctly excludes the 2014-10-22 import artifact (42 rows, all synthetic, all sold)
and suppresses no real inventory → kept (the "record-class test" idea retired); "added" history clean;
freshness gate holds (733/735 fresh). The June "surge" is an **ingestion-provenance** problem, owned
entirely by T4c (below) so the two chats don't collide on the timing views.

**T4b — SUPERSEDED by T4c.** (The OM-intake date-recovery idea; the mechanism was corrected — see T4c.)

### T4c — On-market-date PROVENANCE model + SF recovery  ·  P1  ·  ⏳ Item 1 LIVE, Item 3 (de-surge) pending gate
`CLAUDE_CODE_PROMPT_T4c_onmarket_date_provenance.md`. **Reframe (Scott 2026-06-24): the surge is a
process/ingestion problem, not data.** Root cause grounded: the fake-dated rows are a **Salesforce
`Comp__c` backfill pushed through the OM pipeline** (caller `sabriggs@northmarq.com`) — NOT a Gmail
mailbox forward (`internet_message_id` is NULL on all 7,666 intakes, so the message-id traceback is
dead). The **authoritative on-market date is `Comp__c.On_Market_Date__c`**, keyed by `seed_data.sf_entity_id`
on each intake.
- **Model:** separate `ingested_at` / `on_market_date` (+`_source`/`_confidence`); never default
  `listing_date = created_at`. **Held predicate** = artifact/clock-dated intake rows →
  `on_market_date NULL, source='unestablished'`; **explicitly NOT** `synthetic_from_sale` /
  `master_curated` (keep their dates).
- **Item 1 — provenance columns + backfill alignment: LIVE on all 3 DBs + committed** (`bc54157` on
  `claude/busy-tesla-bmmh90`, PR #1327). Live counts reproduced (dia 1686/1497; gov 915/55/1391/692);
  the step-3 bug that would have wrongly dropped synthetic/master to HELD is fixed; idempotent
  (`WHERE on_market_date_source IS NULL`); reversible (drop 3 cols). Suite 1403/0. ✅ **GATED PASS.**
- **Recovery source — needs a FULL `Comp__c` pull, NOT just `sf_sync_log` (corrected 2026-06-24).**
  `Comp__c.On_Market_Date__c` IS mirrored locally in `sf_sync_log.payload` (top-level `->>'Id'` = comp id,
  `->>'On_Market_Date__c'` = real date, verified spread 2014→2026, 96.9% pre-June) — **but `sf_sync_log`
  prunes terminal rows to a rolling ~30-day window, so it holds only 535 distinct comps (453 with OMD) vs
  the 941 needed = ~48% coverage.** (CC's "97%" was 97% *of what's in the log*, not of the 941.) So
  backfilling from `sf_sync_log` ALONE leaves ~half still held. **Fix = trigger a full dia+gov `Comp__c`
  sync pull** (extend `intake-salesforce` to retain the complete comp set incl. `On_Market_Date__c`),
  then backfill locally keyed by `sf_entity_id`, `source='sf_on_market_date'`, reversible, hold residual.
  This is the durable Step-3 work brought forward (also fixes recurrence). One-shot SF report (Id,
  On_Market_Date__c, CreatedDate) is the fast manual fallback. **Linkage caveat:** dia links ~554/657 via
  `promotion_listing_id`; **gov ~232/901** (gov intakes carry only an artifact path, no
  `promotion_listing_id`) → gov under-covers until the intake→listing linkage is widened (separate task;
  the dates are in hand once the full pull lands, linkage is the gap). Prompt:
  `CLAUDE_CODE_PROMPT_T4c_sf_comp_pull_backfill.md`.
- **Item 3 — timing-view repoint (THE actual visible de-surge): NOT shipped, pending gate.** CC found a
  naive `COALESCE(on_market_date, …)` repoint is **proven NOT byte-identical** — it drops 639→109
  pre-2026-03 sold-anchored rows (the views use `eff_start = COALESCE(listing_date, sold−196d)`, so
  nulling held rows breaks the synthetic sold anchor). Correctly **held per doctrine** (don't move
  published history). **GATE before shipping: `dropped_pub = 0`** — the corrected repoint must preserve
  the sold−196d anchor for sold rows and hold ONLY the artifact-dated ACTIVE rows. ⚠ **Until Item 3
  ships, the live chart still steps at Q2-2026 close** (columns are live but the views still read
  `listing_date`). Needs Scott's go to build the byte-identical repoint.
- **Item 4 — recovery worker / `source_email_date` capture / mass-forward guard: built, feature-flagged
  OFF** (`3a36fb2`, inert until `{massForward:true}` / PA sends `received_date_time`).

### Operator normalization (tenant → operator)  ·  ✅ COMPLETE (2026-06-24)
`CLAUDE_CODE_PROMPT_operator_normalization.md`. Deterministic anchored alias map
(`api/_shared/operator-normalize.js`, single source) applied at-ingest + one-time fill-blanks backfill,
**live on dia**. **579** blank-operator dialysis rows mapped (DaVita 268 / Fresenius 245 / USRC 44 /
DCI 7 / ARA 2 / Satellite 1); **55** non-dialysis tenants flagged `non_dialysis` (Staples, Planet Fitness,
Henry Ford, …) — never assigned an operator (hard guard verified, 0 leaks); **0** curated overwritten;
**109** plausibly-dialysis residual surfaced in `v_property_operator_review` (not guessed). Reversible via
`operator_status`. Suite 1449/0, ≤12 api/*.js. gov has no operator column (tenant=agency) → N/A. ✅ GATED.

- **Recovery progress (2026-06-24):** root cause of the thin sync FOUND + FIXED — the PA "SF → LCC:
  Object Sync" flow's `Get_Deals` step used invalid OData `StageName IN 'Closed IS'` (this connector's
  filter is OData: `eq`/`gt`/`contains`/`or` — no `IN`); fixed to `StageName eq 'Closed IS'`, which
  un-broke the whole sync (comps/properties/deals now sync incrementally again — recurrence fixed). A
  full Comp crawl (watermark `addDays(utcNow(),-9999)`, reverted to `-7` after) lifted the retained
  `lcc_sf_comp_on_market` map to **674 comps / 555 with OMD**; backfilled **+23 net-new** held listings
  (20 dia / 3 gov, tag `t4c_recovery_crawl`, reversible) → **~91 held listings now carry real SF dates**.
- **Broad crawl is EXHAUSTED at 674** — two full-crawl runs did NOT grow the distinct comp count
  (the `Get Comps` tenant-keyword filter `Tenant_Name2__c contains(Dialysis/DaVita/Fresenius/…)` tops out
  at 674; the **~560 still-needed held-linked comps don't match it**). Re-running the broad crawl can't
  reach them.
- **Path for the remaining ~560: an ID-based lookup flow** (Scott's idea). New PA "SF → LCC: Record
  Lookup by ID" flow + an LCC missing-ID worker — LCC sends the exact comp IDs it's missing, SF returns
  `On_Market_Date__c`, LCC backfills. Bypasses the tenant filter + pagination entirely; reusable for
  property/comp/listing/company lookups. Prompts: `CLAUDE_CODE_PROMPT_T4c_sf_record_lookup.md` (LCC) +
  `PA_FLOW_SF_RECORD_LOOKUP_BUILD.md` (the PA flow build for Scott).
- ✅ **ID-lookup recovery COMPLETE (2026-06-24, verified live).** Auth path resolved (PA HTTP trigger →
  "Anyone"/SAS sig; worker sends SAS-only, no extra auth header; `batch_size=20` to fit the sync flow's
  response window — 100 overran it with 502 NoResponse). 3 ticks drained the full still-held SF-linked
  backlog: **628 listings dated** (dia +304 → 337 `sf_on_market_date`; gov +324 → 382), retained map
  674 → 1,303, `still_missing_after_tick=0`. Independently gated: counts reconcile, dates 2014→2026,
  **0 `synthetic_from_sale`/curated touched**, reversible under `t4c_recovery_lookup`. Post-deploy:
  regenerate the flow's SAS key (the `sig` leaked into chat) + refresh `SF_RECORD_LOOKUP_URL`.
- **~1,882 held listings have NO comp link at all** (dia 1349 / gov 533) — the ID lookup can't reach
  these; they stay honestly held (future CoStar/platform date or genuinely dateless). Item 3 holds them
  out of the timing axis.

- ✅ **T4c Item 3 + closeout COMPLETE (2026-06-24, data side, PR #1333).** Canonical `on_market_date`
  repoint of all CM timing/DOM/ramp/span series (both DBs); `listing_date` demoted to raw/audit
  (column COMMENTs + audit of readers). **Restate, accuracy-first** — recovered + sale-anchored dates plot
  at true historical months; isolation-proven (recovered-excluded = byte-identical to old for
  new-to-market + gov added; remaining published delta = intended held-NULL de-surge + recovered
  restatement). **Sale-anchored 571 genuinely-sold dia held listings** (`sold−175`, source
  `synth_sale_minus_median_dom_held`) → dia `added` −6,411 → −1,360 (residual = 194 off-not-sold held, no
  verifiable date, correctly held). **DOM-of-sold observed-only** (dia: excludes `synth%`/`sale_anchor%`
  imputed sources that were 54% pinned at 175; gov verified no exposure — reads `sales_transactions`).
  **Current active/available STOCK count stays freshness-gated** (dia 118, gov 44 — NOT switched to
  on_market_date). 41 stale gov recovered spans closed at `on_market_date`. Restatement footnote on
  supply-side captions. All reversible; ≤12 api/*.js.
- ✅ **T4c EXPORT GATE: PASS (June 25 exports, verified 2026-06-24).** dia available **118** / gov **44**
  (freshness-gated, NOT tripled); no artifact surge (dia ramps 11→118; gov 101→116→95); restate visible —
  **gov +5,200 historical active-months** (Jun18 126→171, Jun20 121→170, Jun22 100→133 = recovered real
  listings at true months), dia net ~flat (de-surge ↔ sale-anchor offset, composition corrected); DOM off
  the 175 plateau (dia sold 224→303 / active 167→346; gov natural 118–184, untouched); canonical
  `on_market_date` drives timing on both DBs. **T4c CLOSED end-to-end.**
- ⏳ **Closeouts:** (a) merge PR #1333 + #1329 (ships the restatement caption footnote — confirm it renders
  on the post-merge export); (b) regenerate the PA flow SAS key (leaked `sig`) + refresh
  `SF_RECORD_LOOKUP_URL`.

**Working order (sequential, Scott): ✅ T4 / T4b / T4c (DONE) → ▶ T2 (active) → T7 → T8 → T10.**

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
