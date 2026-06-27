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
- dia Asking Cap by Lease Term moves too smoothly → **T3b-asking ⏳ PROMPT ISSUED**
  (`CLAUDE_CODE_PROMPT_T3b_asking_cap_by_term_desmooth.md`). GROUNDED: `cm_dialysis_asking_cap_by_term_m`
  still carries a **7-mo centered MA** (`OVER w ROWS BETWEEN 3 PRECEDING AND 3 FOLLOWING`) on top of the
  2-yr TTM + n≥5 gate; the sold view (`cm_dialysis_sold_cap_by_term_dot`) has NO window fn (T3 removed it).
  Fix = drop the `OVER w` MA, select gated TTM directly (mirror sold); keep TTM/n≥5/4-bucket. View-only.
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

### T7 — Gov Returns Index too smooth + extend to 1997  ·  P1  ·  ✅ GATED PASS — Unit 1 (PR #1348, 2026-06-25)
**Verified live (both DBs):** the redundant 7-mo centered MA removed from `cm_gov_returns_indexes_m` +
`cm_dialysis_returns_indexes_m`; output now == the gated TTM blend exactly (gov 303/303 rows match raw within
5.5e-17 epsilon, 0 real diffs; dia 256 non-null match, 0 real diffs). n≥4 gaps preserved (dia 47 NULL gaps,
gov 0 sub-n4 months). History window unchanged (2001→2026). No window fn remains in `_m` OR `_q`. **Grounding
correction (CC, confirmed):** the `_q` views never carried the MA (quarterly-sourced, no TTM, different column
set: cash_return_upper/lower) — correctly left untouched (rewriting them would break the export column
contract). Movement restored ~61% (matches the ~63/64% estimate; CC's absolute bps differ from my stddev
figures only by metric definition — avg-abs-MoM vs stddev + NULL-gap fragmentation). Data-layer, live on next
export (no redeploy); reversible (prior MA body in the migration header). **Unit 2 (extend to 1997) deferred
by Scott** — separate audited change to the shared `cm_gov_market_quarterly_master_m_mat`.
**(prompt: `CLAUDE_CODE_PROMPT_T7_returns_index_desmooth_extend.md`)**

### T7-orig — prompt-written note (superseded)
**Note:** gov 20. "Does not move like dialysis or our PDF/Excel — so much smoother, like a formula error." +
extend to 1997.
**Grounded live 2026-06-25 — premise corrected: NO gov-specific bug.** `cm_gov_returns_indexes_m` and
`cm_dialysis_returns_indexes_m` use **byte-identical formulas** (TTM cap blend + n≥4 gate + a 7-month centered
MA `ROWS BETWEEN 3 PRECEDING AND 3 FOLLOWING`). Both are **double-smoothed** (TTM inputs + redundant MA) — the
MA strips ~64% of real movement: gov MoM 12.47→4.53 bps, dia 15.27→5.58 bps. Residual gov<dia is **genuine
market** (gov caps ~22% less volatile than dia, not a formula diff). Range 2001-01→2026-03, capped by the
master mat start (NOT data — 60 capped sales in 1997-2000, ~15/yr).
**Prompt:** `CLAUDE_CODE_PROMPT_T7_returns_index_desmooth_extend.md`.
**Scope (Scott decided 2026-06-25): de-smooth BOTH gov + dia (Unit 1, ship now); DEFER the 1997 extension
(Unit 2).** Unit 1 — remove the 7-mo MA from gov + dia returns `_m`/`_q` → real movement restored (gov ≈12 /
dia ≈15 bps/mo), gov stays genuinely smoother. History window unchanged (2001→2026). Unit 2 (1997 extension
via the shared `cm_gov_market_quarterly_master_m_mat`) deferred to a separate audited change.

### T8 — Gov active-lease-over-time: rebuild from inventory snapshots  ·  P1  ·  ✅ GATED PASS (PR #319, 2026-06-25)
**Verified live:** counts bar repointed from the broken cumulative-by-start (1,840→7,849 RISING) to the true
snapshot point-in-time inventory — **2013-01 = 8,845 declining to 2026-03 = 7,495** (the real GSA footprint
SHRINKS). 159 months, min 7,339 / max 8,846, 0 below 7,000. Rate denominator (`leases_outside_firm_term`)
repointed to the snapshot Succeeding/Extension sub-cohort; rate range 0.0004–0.0924 (T2 axis auto-refits
0–11% data-drivenly). **Fix in gate:** a corrupt partial snapshot (`gsa_snapshots` 2019-02 = 11 of 8,051
keys) caused a single-month plunge → added a `HAVING count(*)>=5000` plausibility guard on `snap_agg`
(real inventory never <7,300) so the carry-forward skips it (2019-02 → 8,054). Non-corrupt months
byte-identical; view-only, reversible; ~1.95s REST-safe. Unit 3 (events-based termination numerator) reported
not shipped (termination_date undercounts departures ~5–6×) — Scott's call if/when to switch.
**Surfaced for re-ingest (data debt, not view-only):** corrupt partial source ingests — `gsa_snapshots`
2019-02; `gsa_inventory_snapshot_lines` 2019-02/2022-10/2022-11. Validated header `record_count` is the
truth; re-ingest those months so other consumers are correct. (GitHub issue offered.)
**(prompt + gate addendum: `CLAUDE_CODE_PROMPT_T8_active_lease_inventory_from_snapshots.md`)**

### T8-orig — prompt-written note (superseded)  ·  (2026-06-25)
**Notes:** gov 21, 22 — Scott: "should be >1,750 active GSA leases in 2013; it's as though we only show
currently-active projected back."
**Grounded live 2026-06-25 — confirmed + worse (the chart is INVERTED):** `cm_gov_lease_termination_rate_m`'s
`active` CTE counts `gsa_leases WHERE lease_effective<=period_end` with **no upper bound** = a cumulative
ramp of TODAY's table by start date. True point-in-time (from snapshots): **2013-01 = 8,845** active leases,
declining to **2026-02 = 7,348** — the real GSA footprint SHRINKS; the chart shows a false RISE 1,840→7,849.
**The data is already stored:** `gsa_snapshots` (149 monthly snapshots, 2013-01→2026-06, `snapshot_date` +
`lease_number` + `latest_action`) and `gsa_inventory_snapshots`/`_lines` (record_count == distinct lease_number,
verified). So "active at period t = distinct lease_number in the snapshot ≤ t" — Scott's "compare unique lease
keys over time," exact. **Prompt:** `CLAUDE_CODE_PROMPT_T8_active_lease_inventory_from_snapshots.md`.
Unit 1 (must, display-only, no rate impact) repoint the COUNTS bar to the snapshot inventory; Unit 2 (rec.)
repoint the rate denominator (`leases_outside_firm_term`) to the snapshot Succeeding/Extension sub-cohort +
re-fit the T2 termination-rate axis; Unit 3 (investigate) events-based termination numerator
(`gsa_lease_events` 'disappeared') — report before changing. View-only, reversible, gov.

### T9 — Cap-rate data anomalies  ·  P2  ·  ✅ GATED PASS (PR #1339, 2026-06-25)
**Verified live:** Unit 1 — all 19 high-cap "outliers" were `cap_rate_history` DERIVATION errors (portfolio
price-splits + gross-rent-as-NOI), 0 real; 176 rows tagged `is_anomaly` (reversible); `cm_gov_core_cap_rate_dots`
now falls back to validated `sold_cap_rate` → max 11.97%→**8.76%**, 0 over 9%, count **503→683** (+180 REAL
comps recovered from out-of-band, not a clip), axis data-fit ~9% (ships on redeploy). Unit 2 —
`cm_gov_cap_by_term_m` rebuilt (2-yr TTM, median, n≥5 floor, ±3mo MA, dedup cap_5to10→alias, cap_outside_firm
repopulated) → cohorts move, 0 pins. Unit 3 — dia asking quartiles are genuinely sticky (0/141 ever changed
last_cap_rate, 392d median DOM) → documented, axis untouched. DB live + reversible; JS on redeploy.
**Surfaced for Scott (not changed):** (a) gov cap-by-term **[5,6)yr cohort gap** — legend decision (relabel
`<5`→`<6` or `6-10`→`5-10` to make contiguous); (b) possible **stale-active/zombie dia listings** (392d median
DOM) — listing-freshness DQ, worth a look.
**(superseded the original T9 sub-notes block below.)**

### T9b — dia listing-lifecycle cleanup + fix close-on-sale (zombie-active listings)  ·  P1  ·  ✅ GATED PASS (2026-06-26)
**Verified live (dia):** 0 rows status∈(sold/off_market/superseded) with NULL off_market_date; 0 open active
listings on a clean market sale; backup `t9b_listing_backup_20260626` (1,291 rows) reversible. Unit 1 closed
361 sold-property zombies (off_market_date=sale date, no fabrication); Unit 2 backfilled 473 terminal NULL
dates (374 from a real-event ladder, 99 reclassified `orphan` — provenance-less, no date invented). Unit 3
root-caused the close-on-sale gap (3 bugs: 12-mo sale window; trigger fired only on UPDATE OF listing/status
cols so the verification last_verified_at re-stamp never ran the sold-check → freshness gate re-stamped
sold-property listings active forever; guards keyed on fake `listing_date` not `on_market_date`) + a latent
property_id cast bug — fixed + synthetic-tested. De-surge: raw open active 685→457, DOM median 1,913→1,331d.
EXIT-side only; T4c on_market_date + gov untouched.
**Surfaced residuals (NOT a T9b miss — separate mechanism, flagged for follow-up):**
(a) **167 long-DOM active listings, no sale, median DOM 6.4yr, 160 "fresh-verified"** — close-on-sale can't
touch them (no sale); the availability-checker/URL-probe still isn't a reliable on-market signal for no-sale
listings. Needs a **withdrawal-detection / age-based off-market path** (overlaps the LCC availability-checker
cron) → candidate **T9c**. (b) The **T9 sticky asking-cap quartiles only marginally improved** (0.0700→0.0709)
— the quartile pool is small and ~16 of these stale-cap listings dominate it; fully unsticking needs (a)
resolved. (c) **99 orphan rows** (provenance-less off-market) — CC's noted DQ follow-up.
**(prompt: `CLAUDE_CODE_PROMPT_T9b_dia_listing_lifecycle_cleanup.md`)**

### T9c — phantom-freshness on SF-recovered comps + close stale no-live-signal listings  ·  P2  ·  ✅ GATED PASS (PR #1351, 2026-06-26)
**Verified live.** Unit 1: removed the `last_seen` stamp from `intake-promoter.js buildDiaListingRow` +
cleared phantom `last_seen` on 335 no-genuine-capture SF rows (2 real-URL rows preserved). Unit 2: closed 135
stale no-live-signal comps (status=withdrawn, off_market_date=LEAST(on_market+1356d p90-DOM cap, today),
`withdrawn_inferred_stale`, flagged; 0 future-dated; 0 wrong-status); 28 recent SF comps preserved. Reversible
(`t9c_listing_backup` 335 rows). Suite 1542 pass; 12 api files. **Grounding corrections (CC, verified):** the
SF apply path (`lcc_apply_on_market_backfill`) was ALREADY clean — the phantom writers were the OM-harvest
(`last_seen`) + auto-scrape `inferred_active` cron (`last_verified_at`). **Published 2026-03-31 byte-identical
(122)** — the SF comps were never members there (fake future `listing_date`). **The real impact is the
IMPENDING 2026-06-30 quarter: active would balloon 122→405; T9c defuses it to 272 (SF 161→28, median DOM
1328→545d) — before Q2 publishes (4 days out).**
**TWO RESIDUALS:**
(a) **1 row missed** — `listing_id 8609` (`unestablished_historical`, DOM 1452>cap, still active, phantom
last_seen uncleared): CC scoped to `sf_on_market_date`, missed the `unestablished_historical` siblings.
Trivial sweep (same close+clear).
(b) **→ T9d (the next domino, mildly time-sensitive):** the residual 2026-06-30 count (272 vs published ~122)
is dominated by **110 rows (85 non-SF) carrying the fake `capture_date_fallback` `listing_date`** which
independently passes the currency proxy (`COALESCE(last_seen,url_last_checked,last_verified_at,listing_date)`).
Re-key the currency proxy on authoritative `on_market_date` (or park the fake listing_dates) before the Q2
export. Also: the auto-scrape `inferred_active` cron re-stamps `last_verified_at` with no URL — same phantom
class, worth addressing in T9d.
**(prompt: `CLAUDE_CODE_PROMPT_T9c_phantom_freshness_stale_sf_comps.md`)**

### T9d — dia listing currency: provenance-first date recovery (REFRAMED 2026-06-26 — old prompt DO NOT RELAY)
**⚠️ REFRAMED after Scott's correction (2026-06-26):** a listing URL/live check is NOT the only evidence of an
available deal — an OM, flyer, email summary, fax, comp, or CoStar capture IS the evidence. The first prompt
(`CLAUDE_CODE_PROMPT_T9d_dia_listing_currency_rearchitecture.md`) would EXCLUDE evidenced-but-URL-less listings
— **WRONG, do not relay it.** Grounding confirms: of the 183 NULL-on_market held actives, **91 carry an intake
artifact** (offering_memorandum/om/flyer/marketing_brochure/email_update/comp), 134 carry a listing_date — real
evidenced deals, not junk. The actual corruption is the mass-email import stamping a single 2026-06
`capture_date_fallback` date on historically-received OMs (the Q2 surge), whose TRUE receipt date sits behind
`intake_artifact_path`. **Revised direction (CONSTRUCTIVE, T4c analog — pending Scott's confirm):** (1) KEEP
every provenance-backed listing (no URL requirement); (2) RECOVER the true on-market date from the source
document (intake artifact received/email date, earliest evidence) to replace the fake import date → Q2
de-surges constructively, count stays honest; (3) kill the `inferred_active` phantom `last_verified_at`;
(4) honest exit/age-out as a GENEROUS backstop only (lost-track deals), never pruning evidenced inventory.
Count does NOT collapse to ~73 (that ignored OM/email evidence). Accept it's a best-effort count (commercial
has no MLS). **UPDATE 2026-06-26 — the exclusion version WAS run (do-not-relay marker insufficient) and is being
REVERTED.** CC shipped the rejected exclusion approach: excluded 135 OM/flyer/email-evidenced listings,
CLEARED on_market_date on 43 evidenced deals, collapsed active 121→75 / 272→30 (verified live). **Gate FAIL.**
Two prompts now drive the fix (Scott approved the order):
1. **`CLAUDE_CODE_PROMPT_T9d_REVERT.md`** (urgent) — restore the 110 cleared on_market_dates from
   `cm_dia_t9d_on_market_sweep_backup` (prior_on_market_date/source/conf), restore the pre-T9d view bodies
   from git, KEEP the `inferred_active` phantom-`last_verified_at` fix (good), HOLD PR #1354 footnote, keep
   the backup table. Back to ~122.
2. **`CLAUDE_CODE_PROMPT_T9d2_provenance_first_currency.md`** (the real fix) — provenance-first: recover the
   true on-market date from each listing's intake artifact (OM/email/flyer receipt date behind
   `intake_artifact_path`, earliest evidence) — T4c analog; KEEP every evidenced deal; currency = entry +
   exit + GENEROUS age-out backstop (window each deal honestly, accurate now AND over time); **fix the INGEST
   path** (`buildDiaListingRow`) to stamp on_market_date from the source-doc date not `capture_date_fallback`
   (stays accurate going forward); fold in the `fn_listing_close_if_sold` landmine (NULL-on_market sale-match
   collapse + orphan `sales_transaction_id=5701`). No fabrication, no URL requirement, ≤12 api/*.js, dia.
**The root behind T9b/T9c.** The dia available/active count rests on an unreliable currency proxy
(`COALESCE(last_seen,url_last_checked,last_verified_at,listing_date)>=period-120`) — every term compromised:
**0 of 323 active listings EVER had a real URL check** (no live re-verification exists), `last_verified_at`
phantom-stamped by the auto-scrape `inferred_active` cron, `last_seen` a frozen ingest stamp, `listing_date`
often a fake `capture_date_fallback`. Genuine-signal current ≈ 73-87 vs published 122; impending 2026-06-30
balloons to 272. 140/323 have `on_market_date`, **183 are NULL**. **Scott chose the full re-architecture
(2026-06-26), accepting a published restatement.**
**Prompt:** `CLAUDE_CODE_PROMPT_T9d_dia_listing_currency_rearchitecture.md`. Unit 1 rebuild the core membership
(`cm_dialysis_active_listings_m`/`_q` + `_inventory_snapshot_kpis`) on authoritative entry (`on_market_date`)
+ exit (`off_market_date`/`sold_date`) + MAX_DOM_CAP (p90 closed DOM ~1356d), retiring the proxy + the
`listing_date` entry gate (downstream available/DOM/asking-cap/size/turnover/backlog inherit). Unit 2 resolve
the 183 NULL-on_market held actives from REAL signals only, else exclude (no fabrication). Unit 3 stop the
`inferred_active` phantom `last_verified_at` + sweep the T9c residual (8609 + unestablished_historical
siblings). Unit 4 restatement (footnoted) + before/after (2026-03 122→genuine, 2026-06 272→genuine, **asking-cap
quartiles finally unstick** = the ultimate T9 fix). Reversible, dia, ≤12 api/*.js. **TIMING: Q2 export ~4 days
out; if it can't land fully-verified in time, HOLD Q2 rather than ship a half-applied restatement.**
DQ views (`cm_dialysis_listing_verification_status`/`_listings_review_queue`) legitimately keep the columns.

### T9c-orig — prompt-written note (superseded)
**The other half of the zombie problem (T9b = sold half; T9c = no-sale half).** Grounded live: 337
available_listings have `on_market_date_source='sf_on_market_date'` (T4c recovery); **ALL 337 carry a
harvest-stamped `last_seen` (2026-05/06)** though only 1 has a URL/real check — a phantom "still-current"
signal. The canonical currency gate (`COALESCE(last_seen,url_last_checked,last_verified_at,listing_date) >=
period_end-120d`) is fooled by it. **163** are status=active/off_market_date NULL, on-market 2017-2024 (median
DOM ~6.4yr), no live signal; **164 carry caps → they anchor the T9 sticky asking-cap quartiles** (T9b couldn't
reach them, no sale); 11 leak into the canonical 2026-03 count (122). **Scott chose structural fix only
(2026-06-26)** — no SF round-trip.
**Prompt:** `CLAUDE_CODE_PROMPT_T9c_phantom_freshness_stale_sf_comps.md`. Unit 1 stop the harvest stamping
`last_seen`/`last_verified_at` (reserved for genuine checks) + clear the phantom on existing rows; Unit 2 close
the 163 no-live-signal SF comps (real sale date if any, else inferred on_market+max-DOM-cap, flagged
`withdrawn_inferred_stale`), preserve genuinely-current; Unit 3 verify quartiles unstick + canonical ~122→~111
+ DOM drops. Reversible (`t9c_*` backup), EXIT-side only, dia, ≤12 api/*.js. **Surfaced latent:** the currency
proxy also trusts `listing_date` (can be fake 2026-06 capture_date_fallback) — optional belt-and-suspenders to
key it on authoritative `on_market_date`, flagged for Scott not bundled.

### T9b-orig — prompt-written note (superseded)
**From T9 Unit 3** (sticky asking quartiles; "active" DOM really ~2,019d median). **Grounded live: a status↔
off_market_date integrity break.** `available_listings off_market_date IS NULL` by status: active 685 (295
DOM>730d), off_market **400**, superseded **128**, sold **77**. **363 open listings are on SOLD properties**
(77 sold-status all w/ a sale; 286 of 295 active-zombies; 105 superseded; 50 off_market) yet open + "verified"
THIS MONTH (May–Jun 2026) → the freshness gate is NOT confirming on-market; close-on-sale triggers
(`trg_close_listing_on_sale`, `trg_listing_close_if_sold`, fns `close_listing_on_sale`/
`fn_sale_event_mark_listings_sold`) have a matching gap. **528 off_market/superseded carry NULL
off_market_date** (never closed). **Scott: full cleanup + pipeline fix (2026-06-25).**
**Prompt:** `CLAUDE_CODE_PROMPT_T9b_dia_listing_lifecycle_cleanup.md`. Unit 1 close sold-property listings
(off_market_date=sale date, ~363); Unit 2 close off_market/superseded w/ NULL date (~478, from
last_verified_at/reason, flag estimates); Unit 3 diagnose+fix the close-on-sale trigger gap + stop
verification re-stamping sold-property listings; Unit 4 before/after (active count, canonical
`cm_dialysis_active_listings_m` headline, asking-cap pool + T9 quartile unstick, DOM). Reversible, no
fabricated dates, dia only, ≤12 api/*.js. EXIT-side only (don't touch T4c on_market_date / gov).

### T9-orig (earlier sub-notes, lower priority)
**June-25 cap-data cluster (grounded 2026-06-24), 3 units — investigate-then-fix, data before axis:**
1. **gov core-cap dot outliers** — `cm_gov_core_cap_dot_q` (←`cm_gov_core_cap_rate_dots`, firm≥6, cap
   0.04-0.12): n=503, p50 6.95% / p95 8.0% / max 11.97%; **6 sales in the 9-12% band** (visible outliers)
   + **13 more >12%** already filtered. Re-derive cap=NOI/price → correct/exclude errors, keep real
   high-caps; then ceiling ~9% (T2 fitDataAxisRange).
2. **gov cap-by-term** — `cm_gov_cap_by_term_m` has **`cap_6to10`==`cap_5to10` (duplicate cols)**, round
   pins (0.075), `cap_outside_firm` all NULL → dup-column bug + small-sample. Dedup cohorts, density-floor
   thin buckets, report bucket-n. (Same review on `_q`/`sold_cap_by_term_dot` which carry a window MA.)
3. **dia asking-cap quartiles static** — `cm_dialysis_asking_cap_quartiles_active_m` pinned
   (`lower_q_core`=0.061, `lower_q_total`≈0.0586 for months). Investigate stale/clustered/small-pool
   asking caps; remediate if a data bug, document if real; **axis deferred** until the data answer.
**Earlier T9 sub-notes (not yet examined, lower priority):** dia 6 (funky 2022-23), gov 26 (avg==upper
quartile — clearest calc-bug signal), gov 28 (funky x-axis). Fold into the data review if related.

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
