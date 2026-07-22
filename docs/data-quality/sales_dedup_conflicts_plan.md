# Same-Sale Price Conflicts in the Live Sales Lane (Dialysis_DB) — dedup plan

**Target DB:** Dialysis_DB (`zqzrriwuavgrquhisnoa`)
**Migration:** `supabase/migrations/dialysis/20260722_dia_sales_price_conflict_dedup_pass3.sql` (applied live 2026-07-22)
**Comps fix:** `mcp/comps-tools.js` + `docs/comps-tools/query_comps.tool.js` (`dedupe` quality tiebreaker)

---

## 1. Objective

Collapse conflicting records of the **same sale** to one quality-chosen survivor.
Among **live** dia sales there were **125 `(property_id, sale_date)` groups (269 rows,
144 extra)** where the SAME property on the SAME date carried **multiple different
`sold_price`s** (e.g. property `25379` / `2017-12-28` → 5 rows $2.48M–$3.75M; property
`23632` / `2017-02-07` → $4.47M–$8.61M), from mixed sources
(`costar_sidebar`, `master_xlsx_backfill_*`, `historical_csv_import`, null-source legacy
CSV). These skewed cap-rate charts and forced the comp de-dup to pick the surviving
price arbitrarily.

## 2. Grounded findings

| metric | value |
|---|---|
| conflict groups (live, same property+date, >1 distinct price) | **125** |
| rows in conflict groups | 269 (144 extra) |
| all 125 differ by **> $1k** (so the existing Pass 2 could not catch any) | 125 |
| rows with non-null `data_source` (mixed sources) | 107 |
| rows with `cap_rate_quality='implausible_unverified'` | 66 |
| **auto-collapsible** groups (pure source-disagreement) | **111** (127 losers demoted) |
| **ambiguous / chain** groups (left live for review) | **14** (31 rows) |

## 3. Root cause — why `sales_dedup_tick` did not collapse them

`sales_dedup_tick` (B1 worker, cron `lcc-dia-sales-dedup-tick`, `*/15`) had two passes:

- **Pass 1** keys on `dedup_natural_key = (property | price rounded $1k | YYYY-MM)`.
  A **different price → a different key**, so a price-conflict reads as *distinct sales*.
- **Pass 2** (cross-month proximity) requires `abs(price) ≤ $1k`. Every one of the 125
  groups differs by **> $1k**, so Pass 2 misses them too.

Neither pass keys on `(property_id, sale_date)` while ignoring price, so same-date
price-conflicts survived as separate live rows.

## 4. Confirmed: one transaction, not many

`property_id` is **constant** within every group, so a genuine *multi-parcel/portfolio*
case (which would use **different** property_ids per parcel) does not exist here. A single
dialysis property sold on one date is **one** transaction; the differing prices are
conflicting **records** of that sale (source disagreement). Sampling confirmed it — e.g.
group `25379` carries 5 different buyers/sellers for one property/date; group `23632`
carries 3 different sellers all "to Massmutual". These are source disagreements.

**The one genuine exception (surfaced, not merged):** a small number of groups are a
**same-day ownership CHAIN / flip** — e.g. property `24596` on 2017-12-12 records
`Atlantic Collision → Sheela Nayak ($2.16M) · Sheela Nayak → Myung Kim ($2.83M) ·
Myung Kim → Reda Massooud ($4.0M)`. Each transfer is a **real, distinct** sale. Since the
property_id is constant, the same-day flip is the actual ambiguous class — not
multi-parcel. Those 14 groups are **never auto-collapsed** (Section 6).

## 5. Survivor rule (quality-ranked)

Per group, the survivor is the row with the lowest tuple on this ladder
(ascending = better). Implemented in `public.v_sales_price_conflict_ranked`:

1. **`quality_rank`** — cap-rate validation.
   `1` = validated/curated (`cap_rate_source='master_curated'` OR quality ∈
   {`validated`,`cmbs_audited`,`om_actual`,`om_confirmed`,`deed_verified`,`confirmed`,`lease_confirmed`}) ·
   `2` = a stated/known value (`stated_only`) · `3` = null quality · **`4` = `implausible_unverified` (LAST)**.
2. **`source_rank`** — trusted `data_source` order:
   `county_deed:%` `1` › `excel_master`/`master_xlsx_backfill%` `2` › `sjc_track_record_v2` `3` ›
   `historical_csv_import` `4` › `costar_export` `5` › `costar_sidebar` `6` › `rca_sidebar%` `7` ›
   `NULL` `8` › other `10`. *(Extends the existing Pass-1/2 source ladder with the curated
   `master_xlsx_backfill*` family.)*
3. **`conf_rank`** — `cap_rate_confidence`: high `1` › medium `2` › low `3` › suspect `4` › null `5`.
4. **`updated_at` DESC** — most recent.
5. **`sale_id` ASC** — deterministic final tiebreaker.

**Quality dominates source (verified live):** an `implausible_unverified` row is demoted
**even when its source is more trusted** — e.g. properties `24954`/`24966`/`25023`/`25119`,
whose `master_xlsx_backfill` rows are flagged implausible, lose to the non-implausible
`broker_stated`/`noi_derived` twin. When *all* rows in a group are implausible, the curated
source breaks the tie (`25292`). Garbage prices (e.g. `28800` loser `$950,000,000`;
`31898` losers `$19.9M`/`$25.1M`; `27782` loser `$13.5M`) are demoted.

*(dia has no `cap_rate_quality='validated'` rows today; the discriminators are
`implausible_unverified`/`stated_only`/null + `cap_rate_source='master_curated'`. The ladder
future-proofs the validated tier.)*

## 6. Conservative ambiguity guard (flag, don't merge)

A group is **excluded from auto-collapse** when it shows a **same-day ownership chain /
circular** pattern: one row's normalized buyer equals another row's normalized seller
(`A→B, B→C`, or a `B↔A` circular disagreement). These 14 groups stay **live** and are
surfaced in **`public.v_sales_price_conflict_review`** (`review_reason =
'possible_same_day_ownership_chain'`) for human judgment — **never auto-collapsed**. The
view auto-retires a group once a human resolves it or the chain clears.

## 7. `exclude_from_market_metrics` semantics — kept intact (with a surfaced consequence)

Pass 3 **never writes** `exclude_from_market_metrics` and **never uses it** in survivor
selection. Consequence (surfaced, not acted on): in **49 groups** the chosen quality
survivor is `exclude_from_market_metrics = true` while a lower-quality loser was *included*,
so those property-dates **drop out of market metrics** after collapse (net: a
lower-quality/implausible comp stops feeding metrics; the quality survivor stays excluded).
These rows are flagged by `v_sales_price_conflict_dedup_plan.survivor_excluded_metric_drop`
(and the ⚠︎ column in the table below) for a **separate curated exclude-flag review** —
re-including a quality survivor is a deliberate data-curation decision, not a side-effect of
dedup.

## 8. Reversibility & idempotency

- **Never hard-deleted.** Losers move to `transaction_state='duplicate_superseded'` with
  `dedup_group_id = survivor_sale_id`; every demotion is appended to the reversible ledger
  **`public.sales_price_conflict_dedup_log`** (`loser_sale_id`, `survivor_sale_id`, prices,
  reason, timestamps). All FK children (`ownership_history`, `property_sale_events`,
  `available_listings`, `sale_brokers`, …) still resolve — the loser rows persist, just out
  of the live lane.
- **Idempotent.** A 2nd tick demotes **0** (the plan view recomputes over the post-collapse
  live set → no >1-distinct-price groups remain among non-chain groups). Verified live.
- **Reverse a demotion:**
  ```sql
  UPDATE public.sales_transactions s
     SET transaction_state='live', dedup_group_id=NULL, updated_at=now()
    FROM public.sales_price_conflict_dedup_log l
   WHERE s.sale_id=l.loser_sale_id AND s.transaction_state='duplicate_superseded';
  ```
  Verified end-to-end: reverting group `23632` restored 3 live rows; re-running the tick
  re-collapsed to the same survivor (`336`), deterministically.

## 9. What shipped

- **`sales_dedup_tick()`** gains **Pass 3** (Pass 1 & 2 unchanged): collapse same
  `(property_id, sale_date)` price-conflicts to the quality survivor, excluding chain groups,
  logging each demotion. Same signature; same cron.
- **Views** (single source of truth + inspection): `v_sales_price_conflict_ranked`,
  `v_sales_price_conflict_dedup_plan` (dry-run + what the tick consumes),
  `v_sales_price_conflict_review` (the 14 chain groups).
- **Ledger:** `sales_price_conflict_dedup_log`.
- **Comp de-dup re-check** — after Pass 3, the 111 collapsed groups have exactly **one live
  row**, so `rpc_query_comps` (which filters `transaction_state='live'`) emits the quality
  survivor by construction. Additionally, the JS `dedupe()` (`mcp/comps-tools.js`, mirrored
  in `docs/comps-tools/query_comps.tool.js`) got an **additive quality tiebreaker**: on a
  confidence tie (dia_db comps are all hardcoded `confidence 0.85`), it now prefers the
  higher price-quality record (`master_curated`/validated over `implausible`, read from
  `raw.cap_rate_*`) instead of arbitrary first-seen. Additive — no change when the signal is
  absent (all 14 existing + new comp tests pass).

## 10. Verification (live, 2026-07-22)

- Tick collapsed **127 losers** across **111 groups**; live `3689 → 3562`, superseded
  `792 → 919`; ledger = 127 rows.
- **0** non-chain price-conflict groups remain live; **14** chain groups still live.
- 2nd tick = **0** (idempotent). Reversibility round-trip = deterministic.
- Example survivors: `25379` → `88` ($3,583,644, `master_curated`); `23632` → `336`
  ($5,866,500, `stated_only`) — the implausible $8.61M / $3.75M rows demoted.

## 11. Follow-ups (surfaced, not built)

- **Exclude-flag review** for the 49 `survivor_excluded_metric_drop` groups (whether to
  re-include the quality survivor in market metrics — a curated decision).
- **Human review of the 14 chain groups** in `v_sales_price_conflict_review` (confirm the
  genuine same-day flips vs. the circular/self-deal source-disagreement cases).
- **Reference re-pointing** (optional): 122/187/146 conflict rows are referenced by
  `ownership_history`/`property_sale_events`/`available_listings`. Demotion keeps them valid
  (rows persist), but a follow-up could re-point loser references to the survivor using the
  ledger. The existing Pass 1/2 do not re-point either.

---

## Appendix A — Dry-run / as-applied table (111 auto-collapsed groups)

Survivor `**sale_id**` ($price) with its `cap_rate_source / cap_rate_quality`; **⚠︎** in
`surv.excl` = the quality survivor is `exclude_from_market_metrics=true` while an included
loser existed (see §7); `demoted` lists the superseded `sale_id ($price)`.
Reason for every row: `same_date_price_conflict`.

| property | sale_date | survivor ($) | survivor prov (src/quality) | surv.excl | #dem | demoted (sale_id $price) |
|---|---|---|---|---|---|---|
| 21869 | 2021-03-01 | **10704** ($3,150,000) | broker_stated / — | ⚠︎ yes | 1 | 10705 ($3,181,860) |
| 21924 | 2024-04-09 | **4** ($1,864,000) | broker_stated / stated_only | no | 2 | 8191 ($1,300,000), 8192 ($1,526,443) |
| 22180 | 2015-06-01 | **562** ($775,000) | master_curated / implausible_unverified | ⚠︎ yes | 1 | 25 ($64,584) |
| 22265 | 2020-05-22 | **2405** ($4,900,000) | master_curated / stated_only | no | 1 | 34 ($4,600,000) |
| 22419 | 2017-05-09 | **5283** ($3,675,000) | broker_stated / stated_only | ⚠︎ yes | 1 | 6348 ($3,676,650) |
| 22516 | 2021-09-01 | **92** ($3,040,000) | — / — | no | 1 | 93 ($2,233,397) |
| 22605 | 2020-07-01 | **11107** ($3,000,000) | — / — | ⚠︎ yes | 1 | 11108 ($2,960,000) |
| 22890 | 2019-08-14 | **194** ($3,792,000) | noi_derived / stated_only | ⚠︎ yes | 1 | 195 ($3,910,287) |
| 22894 | 2017-05-31 | **14597** ($3,500,000) | master_curated / stated_only | ⚠︎ yes | 1 | 259 ($4,050,000) |
| 23005 | 2025-05-14 | **14421** ($5,200,000) | master_curated / stated_only | ⚠︎ yes | 1 | 7044 ($6,232,000) |
| 23013 | 2019-05-30 | **996** ($2,173,000) | source_reported / stated_only | ⚠︎ yes | 2 | 214 ($5,350,000), 213 ($5,442,000) |
| 23075 | 2018-07-01 | **12258** ($3,480,000) | broker_stated / — | no | 1 | 12259 ($3,335,000) |
| 23175 | 2018-11-06 | **228** ($1,600,000) | noi_derived / — | ⚠︎ yes | 1 | 227 ($1,952,000) |
| 23285 | 2016-04-13 | **243** ($9,670,692) | — / — | no | 1 | 244 ($4,632,000) |
| 23289 | 2019-03-03 | **13874** ($5,000,000) | noi_derived / — | no | 1 | 245 ($8,875,000) |
| 23350 | 2017-12-15 | **265** ($4,470,000) | noi_derived / stated_only | ⚠︎ yes | 1 | 266 ($4,683,303) |
| 23401 | 2017-08-30 | **5245** ($8,237,000) | noi_derived / stated_only | no | 1 | 5538 ($8,200,000) |
| 23483 | 2022-04-11 | **14482** ($2,800,000) | master_curated / stated_only | no | 1 | 297 ($2,200,000) |
| 23523 | 2020-11-18 | **8242** ($4,950,000) | noi_derived / — | ⚠︎ yes | 2 | 307 ($4,550,000), 308 ($4,980,000) |
| 23632 | 2017-02-07 | **336** ($5,866,500) | broker_stated / stated_only | ⚠︎ yes | 2 | 337 ($4,469,000), 335 ($8,609,000) |
| 23654 | 2018-06-01 | **12284** ($3,150,000) | broker_stated / — | no | 1 | 12285 ($3,137,221) |
| 23688 | 2014-07-11 | **355** ($3,900,000) | broker_stated / stated_only | ⚠︎ yes | 2 | 356 ($3,461,538), 354 ($5,650,000) |
| 23709 | 2015-09-22 | **8433** ($6,500,000) | — / — | ⚠︎ yes | 1 | 8434 ($4,875,000) |
| 23850 | 2011-02-07 | **412** ($2,779,172) | — / — | ⚠︎ yes | 1 | 413 ($2,895,922) |
| 23854 | 2012-02-29 | **14672** ($2,061,333) | master_curated / stated_only | ⚠︎ yes | 1 | 414 ($2,223,000) |
| 23859 | 2014-10-28 | **14651** ($2,620,000) | master_curated / stated_only | ⚠︎ yes | 1 | 436 ($3,275,000) |
| 23862 | 2023-02-13 | **418** ($700,000) | source_reported / stated_only | no | 1 | 419 ($695,000) |
| 23947 | 2021-01-05 | **447** ($5,440,000) | — / — | no | 1 | 448 ($4,900,000) |
| 24091 | 2018-09-05 | **478** ($921,000) | source_reported / stated_only | no | 1 | 479 ($855,850) |
| 24287 | 2019-09-25 | **521** ($3,850,000) | master_curated / stated_only | ⚠︎ yes | 1 | 520 ($5,200,000) |
| 24436 | 2021-06-17 | **136** ($6,987,500) | source_reported / stated_only | no | 1 | 137 ($6,200,000) |
| 24526 | 2011-11-01 | **8341** ($1,800,000) | broker_stated / — | ⚠︎ yes | 1 | 545 ($2,597,650) |
| 24653 | 2020-03-31 | **14538** ($2,130,000) | master_curated / stated_only | no | 1 | 560 ($1,966,200) |
| 24662 | 2021-06-30 | **563** ($2,310,849) | noi_derived / stated_only | no | 1 | 564 ($2,200,000) |
| 24698 | 2021-05-07 | **575** ($3,000,000) | master_curated / stated_only | no | 1 | 576 ($2,178,000) |
| 24767 | 2022-03-25 | **14485** ($1,450,000) | master_curated / stated_only | no | 1 | 591 ($1,345,000) |
| 24813 | 2022-01-14 | **608** ($2,599,717) | broker_stated / stated_only | no | 1 | 609 ($1,986,700) |
| 24897 | 2017-12-18 | **631** ($1,690,000) | broker_stated / stated_only | no | 1 | 632 ($1,300,000) |
| 24954 | 2018-08-30 | **644** ($1,030,000) | source_reported / stated_only | no | 1 | 14571 ($715,000) |
| 24966 | 2014-08-21 | **652** ($1,515,000) | noi_derived / — | no | 1 | 14654 ($1,200,000) |
| 25023 | 2018-08-21 | **674** ($2,075,000) | broker_stated / stated_only | no | 1 | 14572 ($1,300,000) |
| 25076 | 2019-06-07 | **691** ($1,670,000) | — / — | no | 1 | 692 ($1,145,756) |
| 25119 | 2007-01-26 | **701** ($2,214,500) | broker_stated / stated_only | no | 1 | 14683 ($1,280,000) |
| 25126 | 2017-12-01 | **13113** ($2,223,100) | broker_stated / — | ⚠︎ yes | 1 | 13114 ($2,250,000) |
| 25128 | 2020-12-30 | **8876** ($2,374,000) | broker_stated / stated_only | ⚠︎ yes | 1 | 708 ($3,428,000) |
| 25129 | 2022-10-31 | **710** ($2,990,000) | broker_stated / stated_only | no | 1 | 711 ($2,400,000) |
| 25145 | 2007-02-27 | **714** ($2,162,480) | noi_derived / stated_only | ⚠︎ yes | 2 | 716 ($1,640,000), 715 ($2,214,000) |
| 25203 | 2020-02-28 | **14544** ($3,850,000) | master_curated / stated_only | ⚠︎ yes | 1 | 738 ($4,857,600) |
| 25216 | 2021-01-14 | **14517** ($1,675,000) | master_curated / stated_only | ⚠︎ yes | 1 | 745 ($2,152,352) |
| 25292 | 2008-01-25 | **14681** ($1,795,500) | master_curated / implausible_unverified | no | 1 | 753 ($843,800) |
| 25354 | 2020-08-24 | **14529** ($3,980,000) | master_curated / stated_only | ⚠︎ yes | 1 | 778 ($5,023,203) |
| 25355 | 2018-08-28 | **785** ($3,605,000) | source_reported / stated_only | ⚠︎ yes | 1 | 784 ($4,425,000) |
| 25356 | 2013-12-20 | **786** ($3,350,000) | — / — | no | 1 | 787 ($2,706,216) |
| 25379 | 2017-12-28 | **88** ($3,583,644) | master_curated / stated_only | ⚠︎ yes | 4 | 793 ($2,479,512), 792 ($2,768,000), 791 ($3,245,000), 794 ($3,750,000) |
| 25431 | 2015-01-16 | **803** ($2,100,000) | source_reported / stated_only | ⚠︎ yes | 1 | 14644 ($4,006,619) |
| 25476 | 2022-10-27 | **4989** ($4,641,382) | source_reported / stated_only | no | 1 | 814 ($3,300,000) |
| 25511 | 2022-05-13 | **14479** ($2,496,773) | master_curated / implausible_unverified | no | 1 | 820 ($2,120,000) |
| 25541 | 2016-05-25 | **13763** ($4,765,000) | broker_stated / stated_only | no | 1 | 825 ($3,071,990) |
| 25562 | 2019-06-17 | **14559** ($1,400,000) | — / — | ⚠︎ yes | 1 | 831 ($1,710,000) |
| 25637 | 2018-11-06 | **14569** ($2,220,000) | master_curated / stated_only | ⚠︎ yes | 1 | 846 ($3,600,000) |
| 25734 | 2019-09-01 | **11906** ($4,995,153) | broker_stated / — | ⚠︎ yes | 1 | 11907 ($5,000,000) |
| 25740 | 2022-11-10 | **878** ($1,805,158) | master_curated / implausible_unverified | no | 1 | 879 ($1,475,000) |
| 25751 | 2022-10-10 | **881** ($1,970,902) | — / implausible_unverified | ⚠︎ yes | 1 | 882 ($3,276,842) |
| 25767 | 2015-12-14 | **8086** ($4,628,317) | noi_derived / — | no | 1 | 8692 ($4,500,000) |
| 25772 | 2015-04-29 | **892** ($2,250,000) | master_curated / stated_only | ⚠︎ yes | 1 | 891 ($2,551,741) |
| 25862 | 2020-06-05 | **907** ($1,800,000) | source_reported / stated_only | ⚠︎ yes | 1 | 906 ($2,060,000) |
| 25889 | 2018-05-18 | **5156** ($3,670,000) | broker_stated / — | ⚠︎ yes | 1 | 911 ($4,100,100) |
| 25974 | 2016-04-29 | **944** ($1,170,000) | source_reported / stated_only | no | 1 | 943 ($950,400) |
| 26124 | 2013-01-01 | **12755** ($930,000) | noi_derived / — | ⚠︎ yes | 3 | 981 ($733,515), 980 ($1,150,000), 979 ($1,710,000) |
| 26152 | 2013-03-01 | **987** ($2,166,828) | source_reported / stated_only | no | 3 | 5776 ($1,321,703), 5770 ($1,869,470), 5861 ($2,119,000) |
| 26172 | 2021-09-02 | **993** ($2,933,333) | master_curated / stated_only | no | 1 | 994 ($2,590,000) |
| 26187 | 2015-06-09 | **13686** ($3,456,892) | master_curated / stated_only | ⚠︎ yes | 1 | 999 ($3,972,701) |
| 26220 | 2021-05-31 | **1003** ($1,950,000) | source_reported / stated_only | no | 1 | 1004 ($1,000,000) |
| 26453 | 2019-06-26 | **1021** ($4,156,158) | noi_derived / stated_only | no | 1 | 1022 ($4,080,000) |
| 26493 | 2019-05-23 | **1027** ($2,161,481) | noi_derived / stated_only | no | 2 | 1028 ($1,264,605), 14563 ($1,485,395) |
| 26527 | 2018-08-22 | **1045** ($1,355,774) | — / implausible_unverified | no | 1 | 1046 ($1,237,425) |
| 26547 | 2013-12-04 | **1054** ($1,475,000) | source_reported / stated_only | no | 1 | 14661 ($450,000) |
| 26632 | 2015-04-15 | **1072** ($2,288,118) | source_reported / stated_only | no | 2 | 6079 ($2,000,000), 5129 ($2,102,116) |
| 26691 | 2019-12-31 | **13913** ($1,496,850) | noi_derived / — | no | 1 | 1081 ($2,500,000) |
| 26818 | 2025-03-20 | **14423** ($986,500) | master_curated / stated_only | ⚠︎ yes | 1 | 7953 ($1,025,000) |
| 26914 | 2026-04-22 | **14315** ($870,000) | noi_derived / — | no | 1 | 14325 ($190,000) |
| 27116 | 2016-10-06 | **14615** ($4,100,000) | master_curated / stated_only | ⚠︎ yes | 1 | 1179 ($4,448,000) |
| 27694 | 2014-08-07 | **14656** ($4,090,000) | master_curated / implausible_unverified | ⚠︎ yes | 1 | 1243 ($6,111,000) |
| 27700 | 2025-01-31 | **14425** ($2,000,000) | — / — | ⚠︎ yes | 1 | 1244 ($4,000,000) |
| 27704 | 2009-05-29 | **14676** ($1,260,000) | master_curated / implausible_unverified | ⚠︎ yes | 1 | 1262 ($1,699,500) |
| 27704 | 2020-07-01 | **11572** ($1,387,822) | noi_derived / — | ⚠︎ yes | 1 | 11578 ($1,530,013) |
| 27722 | 2008-06-28 | **1257** ($2,668,500) | broker_stated / stated_only | no | 1 | 14679 ($1,827,000) |
| 27722 | 2009-05-06 | **1256** ($2,668,500) | broker_stated / stated_only | no | 1 | 14677 ($2,075,000) |
| 27722 | 2016-06-06 | **1255** ($2,668,500) | broker_stated / stated_only | no | 1 | 14622 ($2,290,600) |
| 27782 | 2017-06-29 | **14596** ($4,513,000) | — / — | no | 1 | 14279 ($13,486,000) |
| 28433 | 2011-12-22 | **6405** ($3,360,000) | source_reported / stated_only | ⚠︎ yes | 1 | 5897 ($3,370,000) |
| 28749 | 2013-12-13 | **6303** ($1,798,000) | source_reported / stated_only | ⚠︎ yes | 1 | 8590 ($1,300,000) |
| 28749 | 2020-06-25 | **7992** ($1,798,000) | source_reported / stated_only | ⚠︎ yes | 1 | 8589 ($1,400,000) |
| 28749 | 2022-01-24 | **7991** ($1,798,000) | source_reported / stated_only | ⚠︎ yes | 1 | 8588 ($2,050,000) |
| 28800 | 2023-09-12 | **6102** ($1,025,954) | — / — | no | 1 | 14706 ($950,000,000) |
| 30400 | 2024-07-01 | **8874** ($3,170,651) | master_curated / stated_only | ⚠︎ yes | 1 | 6023 ($3,357,000) |
| 31480 | 2019-03-22 | **14564** ($11,725,000) | master_curated / stated_only | ⚠︎ yes | 1 | 6728 ($15,354,000) |
| 31898 | 2018-12-29 | **8229** ($3,510,000) | master_curated / stated_only | ⚠︎ yes | 1 | 5042 ($4,125,000) |
| 31898 | 2019-07-02 | **756** ($4,125,000) | noi_derived / stated_only | ⚠︎ yes | 2 | 8232 ($19,937,500), 8228 ($25,103,000) |
| 33975 | 2011-09-23 | **421** ($1,777,691) | broker_stated / stated_only | no | 1 | 422 ($1,370,000) |
| 35346 | 2017-01-17 | **315** ($4,231,164) | noi_derived / stated_only | no | 1 | 13788 ($3,482,500) |
| 37574 | 2025-09-02 | **8046** ($2,000,000) | noi_derived / — | ⚠︎ yes | 1 | 8374 ($2,600,000) |
| 38174 | 2026-01-16 | **13374** ($18,700,000) | — / — | no | 1 | 13377 ($16,615,000) |
| 39180 | 2021-03-01 | **10628** ($2,850,000) | broker_stated / — | ⚠︎ yes | 1 | 10629 ($2,743,460) |
| 39955 | 2021-03-01 | **10714** ($2,050,000) | broker_stated / — | ⚠︎ yes | 1 | 10715 ($2,140,500) |
| 1858531 | 2017-07-17 | **14594** ($4,016,500) | master_curated / stated_only | ⚠︎ yes | 1 | 188 ($4,780,500) |
| 2052184 | 2018-05-31 | **1029** ($3,624,794) | broker_stated / stated_only | no | 1 | 1031 ($1,825,000) |
| 2161026 | 2023-03-01 | **9738** ($4,200,000) | broker_stated / — | no | 1 | 9739 ($4,157,158) |
| 2216261 | 2019-09-30 | **13903** ($2,764,500) | broker_stated / stated_only | ⚠︎ yes | 1 | 6285 ($3,654,620) |
| 3525845 | 2012-10-25 | **14669** ($1,874,000) | master_curated / stated_only | ⚠︎ yes | 1 | 481 ($3,047,805) |
| 3525903 | 2019-07-02 | **13890** ($2,617,000) | master_curated / stated_only | ⚠︎ yes | 1 | 323 ($3,358,043) |

## Appendix B — Review queue (14 same-day chain / circular groups, LEFT LIVE)

Never auto-collapsed. Surfaced in `v_sales_price_conflict_review`. Rows 24596 / 25858 /
26044 are genuine 3-transfer same-day chains; the Decarion / Castagnolo / Behringer /
Suntrust self-deals and the Bradley↔Leibsohn loop are circular source-disagreement to
confirm by hand.

| property | sale_date | rows | transfers (seller → buyer ($price)) |
|---|---|---|---|
| 23409 | 2024-11-08 | 2 | Phil Decarion → ? ($3,050,000)  ·  Phil Decarion → Phil Decarion ($3,700,000) |
| 23425 | 2017-08-24 | 2 | Michael Agee → NETSTREIT Corp ($3,175,000)  ·  Alderson Commercial → Michael Agee ($3,367,292) |
| 23494 | 2022-01-13 | 2 | Seymore Rubin Associates → Ocean Block Capital ($2,475,000)  ·  Ocean Block Capital → Candor Capital ($2,615,000) |
| 24174 | 2021-08-04 | 2 | Robert Crivello → Net Lease Alliance ($4,042,000)  ·  Net Lease Alliance → Sierra Auto Properties ($5,500,000) |
| 24596 | 2017-12-12 | 3 | Atlantic Collision → Sheela Nayak ($2,158,639)  ·  Sheela Nayak → Myung Kim ($2,825,000)  ·  Myung Kim → Reda Massooud ($4,000,000) |
| 24960 | 2019-07-02 | 2 | William Cleveland → Elliott Bay Capital ($8,700,000)  ·  Elliott Bay Capital → Platform Ventures ($8,794,000) |
| 25737 | 2018-02-01 | 2 | Bradley Associates BMO Financial Group ($1.4m approx) → Leibsohn Family Trust ($2,190,000)  ·  Leibsohn Family Trust → Bradley Associates ($2,564,000) |
| 25858 | 2017-07-27 | 3 | Ritchie Development → Jack Glaves ($778,000)  ·  Jack Glaves → Dr Ramanath Bhandari ($849,103)  ·  Dr Ramanath Bhandari → Gary Fultheim ($1,065,000) |
| 25944 | 2020-03-25 | 2 | Oman-Gibson Assocs → William Sanders Trust ($1,175,000)  ·  William Sanders Trust → Lovenson Family Trust ($1,250,000) |
| 25988 | 2022-08-15 | 2 | Castagnolo Properties Inc → Castagnolo Properties Inc ($3,188,000)  ·  Castagnolo Properties Inc → Robert T Lee ($3,650,000) |
| 26044 | 2014-05-15 | 3 | Behringer → Behringer ($5,031,934)  ·  Behringer → ? ($5,200,000)  ·  Behringer → Broadstone Net Lease ($5,552,000) |
| 26493 | 2022-01-01 | 2 | Kairos Real Estate Partners → Chinu Mridha ($1,701,741)  ·  Merchant'S Fine Wine → Kairos Real Estate Partners ($2,099,000) |
| 33706 | 2021-12-03 | 2 | Fresenius Medical Care → Suntrust ($1,404,889)  ·  Suntrust → Suntrust ($1,789,335) |
| 2167872 | 2016-12-16 | 2 | Elliott Bay Capital → Platform Ventures ($1,761,000)  ·  Dialysis Venture Partners → Elliott Bay Capital ($1,965,000) |
