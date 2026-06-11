# Mis-Ingestion Sweep — non-representative rows in the dia (and gov) sales/property book

**Date:** 2026-06-11
**Mode:** EXPLORATION — receipts-first audit + classification + a **gated** remediation plan.
**NO writes were made.** Everything below is read-only evidence. The remediation
SQL in `remediation_dia.DRAFT.sql` is **NOT applied** and must clear the gate
(§7) before any write.
**Companion to:** `audit/listing-lifecycle-2026-06-11/` (that sweep = duplicate/stale
*listing* rows; this sweep = wrong *assets / sales* in the book).

Databases: dia `zqzrriwuavgrquhisnoa`, gov `scknotsqkcheojiaewwh`.

---

## 0. TL;DR

- The Layer-G "spike" was the tip. At the **$30M+ tail alone there are 26 dia
  sales; 5 are already excluded, ~21 are still counted** as single-asset
  dialysis NNN when they are whole multi-tenant centers, non-dialysis assets,
  or portfolio/price errors.
- Extending below the tail with **data-driven** signals, the dia non-excluded
  book (3,037 sales) carries:
  - **~40–57 wrong-asset sales** (≥2 corroborating signals; high-confidence
    core = 40 surfaced, see §2).
  - **A Fresenius *industrial* cluster** — 19 sales (11 non-excluded), avg
    **145,000 sf / $12.3M**, $28–168/sf — distribution/manufacturing net-leased
    to Fresenius, not clinics.
  - **A separate, larger phantom-duplicate problem**: **195 groups / 224
    phantom extra sales / ≈ $906M double-counted volume** — the same sale
    re-recorded 2–4× across CoStar/CSV re-captures. This distorts **volume and
    transaction count** more than the wrong-asset rows distort price/sf.
- **gov already solved its version of this.** 14,142 gov sales, **68% already
  excluded**, **100% classified** via a real taxonomy
  (`sales_record_classification` + `sales_exclusion_reason`). gov's residual
  non-excluded outliers are legit large deals or price/rba data-quality errors
  on *real gov* assets — not non-gov bleed. **The remediation for dia is to port
  gov's machinery.**

---

## 1. Phase 1 — AUDIT (read-only). Signal bands are data-driven, not arbitrary.

### Baseline (dia)
| metric | value |
|---|---|
| total sales | 4,716 |
| already `exclude_from_market_metrics=true` | 1,679 (35.6%) |
| **non-excluded (the working book)** | **3,037** |
| has `portfolio_id` | 79 |
| max sold_price | $950,000,000 (costar_sidebar) |

### Band A — price/sf (non-excluded SIZED sales, n=2,941)
`p50 $331 · p75 $490 · p90 $694 · p95 $909 · p99 $1,966`
→ **`> $1,500/sf` ≈ p97** — a defensible "implausible for single-asset dialysis
NNN" line (dialysis NNN clears ~$400–1,000/sf). **44** non-excluded sized sales
exceed it; **29** exceed $2,000/sf.

### Band B — building size (properties with a non-excluded sale, n=1,954)
`p50 8,415 · p90 16,060 · p95 25,114 · p99 71,369`
→ **`> 25,000 sf` ≈ p95** (a single clinic is ~5–12k sf). **98** properties
exceed it; **51** exceed 40k sf. The 98,136-sf "Osceola Village" is the tell.

### Band C — property_type (non-excluded sales)
The dia book is mostly Healthcare/Office/single-tenant medical, **but already
contains** non-dialysis types counted as comps: `Retail` (34), `Retail Centers`
(11), `Office, Retail` (11), `Industrial` (9), `Multiple` (70), `Shopping Mall`
(2), `Warehouse`/`Warehouse-Distribution`, `Cinema`, `power center`,
`Mixed Use` (8), `Ground Lease` (2), `Land` (3).

### Signal buckets (non-excluded, n=3,037)
| signal | def | hits |
|---|---|---|
| `psf` | price/sf > 1,500 | 44 |
| `size` | building_size > 25,000 | 139 |
| `name` | name/address ~ Plaza\|Village\|Commons\|Mall\|Shopping\|Marketplace\|Galleria\|Pavilion\|Corporate Park\|Business Center\|Town Center\|Promenade\|Outlet\|Power Center\|Crossing | 82 |
| `nottenant` | tenant+operator NOT a dialysis operator¹ | 28 |
| `ptype` | property_type ~ retail\|warehouse\|industrial\|shopping\|mall\|cinema\|distribution\|mixed\|multi-tenant\|multiple\|ground lease | 164 |
| `pf` | `portfolio_id` set OR notes ~ portfolio\|multiple properties | 89 |
| `mtnotes` *(weak/corroborating only)* | notes ~ tenants:\|anchor\|grocery\|supermarket | 468 (noisy — CoStar emits "Tenants:" on single-tenant rows too) |

¹ dialysis operator allow-list (operator universe is ~99% these):
`davita, fresenius, fmc, fkc, fmcna, renal, kidney, dialysis, satellite,
nephrolog, rogosin, dialyspa, dcc, dci, centro de cuidado, hemodialysis`.
Operator universe confirmed: Fresenius 1,316 / DaVita 1,066 / US Renal 75 /
American Renal 31 / Satellite 14 / DCI 12 / Northwest Kidney 4 … plus one-offs.
A non-dialysis operator/tenant is therefore a strong signal (note the book even
carries a "Family Dollar" and a "Mens Medical Institute" tenant).

**The `mtnotes` signal is deliberately demoted to corroborating-only** because it
false-positives heavily. **No row is classified on a single signal** (§ Guardrails).

---

## 2. Phase 2 — CLASSIFY (the judgment, with evidence)

**High-confidence core: 40 sales with ≥2 of the 6 corroborating signals** (the
loose count undercounts no-notes rows by ~5–17 due to a SQL NULL caveat noted in
§5; true high-confidence set ≈ 45–57). Full re-runnable query:
`candidates_dia.sql`.

This set **validates the corroboration rule** — it contains genuine KEEPs that a
single-signal auto-rule would have wrongly excluded:

| KEEP (false-positive on one signal) | why it's real |
|---|---|
| sale 5500 `Dcc - Olympia Fields` $400k / 4,868 sf / $82 | real DCI clinic; `nottenant` only fired because regex missed "Dcc" |
| sale 734 `Hiram` (Fresenius) $2.3M / 8,370 sf / $276 | real clinic that happens to sit in a retail strip |
| sale 4 `University Plaza` (Fresenius) $1.86M / 6,564 sf / $284 | ditto — "Plaza" in the name only |
| sale 286 `Shiloh` / Fkc-Belleville $2.97M / 8,200 sf / $363 | real clinic; `Multiple`+`pf` are weak flags |

### Classification of the seed set + extensions

**A. WHOLE_CENTER / MULTITENANT** (dialysis is one tenant; price = whole center)
→ *exclude from market metrics*, reason `whole_center_multitenant`:
6711 Galleria 100 (AFLAC+Fresenius), 6592 Victory Plaza (Vallarta Supermarket),
6658 Rockleigh (Spectra Labs+Fresenius), 6596 Orlando Airport Business Center
(Frontier/FedEx), 6631 Osceola Village (98k sf retail), 6654 Commons at Royal
Palm, 6760 Century Town Center, 6685 Village at Shoal Creek, 6630 Lincoln County
Shopping Center, 6703 Lorden Plaza, 6710 Mid-Ohio Valley Medical Complex (92k sf),
6736 Bristol Distribution Center, 6733 Stratford Village Center (Kaiser),
6753 Shops at Waterbury, 6699 Kennedy Plaza*, 6664 Kemper Lakes Business Center*
(*no dialysis tenant on the row at all — likely a bad property link too).

**B. MISCLASSIFIED — WRONG TYPE** (not a dialysis clinic at all)
→ *flag to re-type/remove from the dialysis book* (provenance-tagged, never
hard-deleted), reason `misclassified_wrong_type`:
6726 "Fmr Encana Oil & Gas" (Plano office), 5723 Stateline 94 Corporate Park
(590k-sf warehouse), 8819 Mens Medical Institute (men's-health, not dialysis),
7023 TGen HQ (research building), 8105 BridgePoint Healthcare (LTACH hospital,
not a dialysis operator — verify), **+ the Fresenius industrial cluster** (§4):
5935, 5870, 5867, 5817, 5952, 5931, 5930, 5842 … (70k–183k sf, $28–168/sf —
distribution/manufacturing).

**C. PORTFOLIO_SALE** (one sale_id standing in for a portfolio, or price error)
→ *exclude (or split)*, reason `portfolio_sale`:
14706 $950M Fresenius Johnsonville SC (6,987 sf — already excluded, keep),
14353 $142.9M Fresenius Anniston (9,972 sf → $14,330/sf — portfolio or price
error), 8905 $130.85M Satellite/Oakland (CIM Group), 8110 "2450 Fire Mesa St
(Part Of A[portfolio])", 14122 6490 Mt Moriah (portfolio flag).

**D. UNCONFIRMED** (high-$ but no size/tenant to confirm single-asset)
→ *exclude pending evidence*, reason `unconfirmed`:
6759 1 Park West Blvd, 6641 Northway Square East, 6856 Westover Hills Medical
Plaza II, 6752 Northwest Kidney Centers $43M, 5530 NKC Broadway $42.5M, 6212
Walnut Creek 85k-sf office $41M, 6212-class no-size high-$ rows (the "$50M
Rockleigh" archetype).

**E. GENUINE single-asset (large but real)** → KEEP, note: the small-clinic
false-positives above, plus any NKC/large-clinic rows that verify on inspection.

---

## 3. The bigger, separate finding — PHANTOM DUPLICATE SALES

Distinct from "wrong asset": the **same** sale recorded multiple times across
re-captures. Among non-excluded, priced sales:

- **195 dup groups · 224 phantom extra rows · ≈ $906,000,000 double-counted
  volume** (group = same `property_id` + identical `sold_price`, different
  `sale_date`).
- Examples: property **1715545 → 4 rows all $19,396,000** (2016/2023/2024/2025);
  26404 → 3× $10,260,000; 29108 → 3× $8,302,000; 27156 → 3× $4,742,050; Conyers
  (8416/8413) 2× $21,510,208; Odessa II (8434/8435).
- Phantom dups by year skew recent (CoStar snapshot re-capture): **2021: 26 ·
  2022: 33 · 2023: 42 · 2024: 23**.
- `dedup_group_id` / `dedup_natural_key` columns **exist but did not catch these**
  — the de-dup pass missed identical-price/different-date re-captures.

### Keeper-date is NOT mechanical (Scott Check-2 finding, 2026-06-11)
**Supersession** is mechanical (one row survives per `(property_id, sold_price)`
fingerprint → the $906M double-count clears regardless of which survives). But
**which year the survivor lands in is not.** Of 195 groups, only **16 span ≤1yr**;
**134 span >3 years** at an *identical* price (prop 23494: 1985 **and** 2022 at
$2,615,000; prop 30025: 1996 **and** 2025 at $15,010,000). A property selling
twice for the *exact* same price is effectively impossible (so `genuine_resale`
rarely fires — Check 1), which means one date in each wide group is a **legacy
artifact**, and a blanket "earliest" keeper would **park a real 2022 deal in 1985
and drop it off the recent volume charts**. Keeper rule is therefore **cluster/
modal-year aware** (keep the densest year-cluster — fixes prop 1715545, whose two
2016 captures + notes pin the true year to 2016), and the **204 all-distinct-year
rows are flagged `keeper_ambiguous`** in the frozen table for Scott's targeted
keeper-year confirmation (`confirmed_keep_sale_id`) before any write.

This is the dominant distortion of **volume / transaction-count / avg-deal-size**
metrics and should be remediated alongside the wrong-asset rows (gov already has
an `excluded_*`/`duplicate_row` class for exactly this — see §6).

---

## 4. The Fresenius industrial cluster (sub-pattern worth a decision)

`property_type ~ industrial|warehouse|distribution`: **19 sales (11
non-excluded), avg 145,234 sf, avg $12.3M**, $28–168/sf. These are Fresenius
**distribution/manufacturing** facilities (real Fresenius net leases, but **not
dialysis-clinic comps**). They simultaneously **depress price/sf** and **inflate
average deal size**. Decision for Scott: treat as `misclassified_wrong_type` for
the clinic comp set (recommended) vs. keep as a separate "Fresenius corporate
real estate" bucket excluded from clinic metrics.

---

## 5. Before / after at the spike quarters (the reliable slice + an honest caveat)

Per-year dia non-excluded book (these three columns are exact):

| yr | n_all | vol_all | avg_all | phantom_dups |
|---|---|---|---|---|
| 2019 | 292 | $1.496B | $5.12M | 13 |
| 2020 | 300 | $1.069B | $3.56M | 12 |
| 2021 | 296 | $1.114B | $3.76M | **26** |
| 2022 | 279 | **$1.315B** | **$4.71M** | **33** |
| 2023 | 190 | $0.788B | $4.15M | **42** |
| 2024 | 129 | $0.502B | $3.89M | 23 |
| 2025 | 187 | $0.774B | $4.14M | 18 |

### VERIFIED before/after — computed from the fully-confirmed frozen list (2026-06-11)
All 290 candidates carry a `confirmed_class`; the "after" removes the 5 terminal
exclusion classes + phantom non-keepers (keyed off each keeper's **exact**
`sold_price`, not the rounded table column), keeping the 3 genuine clinics.
Book-wide: **286 rows removed** (223 phantom-dups = **$905.25M** double-count +
63 wrong-assets = **$1.594B** gross non-representative volume); book 3,037 → 2,751.

| yr | avg before → after | volume before → after | dropped dup / wrong |
|---|---|---|---|
| 2019 | $5.12M → $3.83M | $1.496B → $1.019B | 13 / 13 |
| 2021 | $3.76M → $3.62M | $1.114B → $0.981B | 24 / 1 |
| **2022** | **$4.71M → $3.96M (−16%)** | **$1.315B → $0.938B (−29%)** | 32 / 10 |
| **2023** | **$4.15M → $3.68M (−11%)** | **$0.788B → $0.570B (−28%)** | 33 / 2 |
| 2024 | $3.89M → $3.95M | $0.502B → $0.422B | 22 / 0 |
| 2025 | $4.14M → $3.47M | $0.774B → $0.569B | 16 / 7 |

The 2022/23 "spike" deflates exactly as Layer G implied; **dedup dominates the
recent-year correction**, wrong-assets dominate the dollar magnitude. (An earlier
blunt `signals<2` recompute was discarded — a Postgres NULL-propagation trap plus
the rounded-price join both **overstated/undercounted** removal; the table above
is the authoritative computation.)

### Root-cause — which ingestion path leaked each class (dia)
| data_source | wrong-asset candidates | phantom dups |
|---|---|---|
| (null/legacy) | 27 | 31 |
| costar_sidebar | 17 | 80 |
| historical_csv_import | 11 | 82 |
| master_xlsx_backfill_r2/r72 | 2 | 31 |
| sjc_track_record_v2 / sf_internal_comp | 0 | 0 |

→ Wrong assets enter via **legacy/null + CoStar sidebar capture + the historical
CSV import**. Phantom dups are dominated by **CoStar sidebar re-capture +
historical CSV re-import**. The guard belongs at the **sidebar `upsertDomainSales`
writer** and the **CSV importer**, plus a data-quality view (§6).

---

## 6. gov comparison — the analogous bleed-through is *already handled*

| gov metric | value |
|---|---|
| total sales | 14,142 |
| `exclude_from_market_metrics=true` | **9,666 (68%)** |
| `sales_record_classification` populated | **14,142 (100%)** |
| non-excluded sized price/sf | p50 $220 · p95 $540 · p99 $827 (only **16** > $1,000/sf) |

gov already runs a mature taxonomy from prior DQ9/DQ10/r17c passes:
`government_candidate`, `excluded_non_government_sale`
(`sale_property_link_no_government_identity` — the non-gov/USA-owner bleed),
`excluded_portfolio_component` (`portfolio_address_noise`),
`excluded_nonbuilding_sale` (`land_or_nonbuilding`), `duplicate_row`, and
`[portfolio-aggregate] per-property price … nulled`. gov's residual non-excluded
outliers (e.g. DoT Cambridge $750M, Army Sacramento $485M = legit; SSA Mission
Viejo $14,762/sf = a price/rba error on a *real gov* SSA asset) are **data-quality
on real gov assets, not wrong-asset mis-ingestion**.

**Conclusion:** gov needs only a light residual pass (a handful of price/rba
fixes). **dia needs gov's framework ported.**

---

## 7. Phase 3 — gated remediation PLAN (dry-run → gate → write). NOTHING APPLIED.

Draft (un-applied) SQL: `remediation_dia.DRAFT.sql`. Steps, in order:

1. **Freeze the candidate list. ✅ DONE (read-only) 2026-06-11.** Materialized as
   dia table **`public._sweep_candidates_2026_06_11`** (290 rows) via
   `CREATE TABLE AS` (`candidates_dia.sql`). It carries the signals, a
   `proposed_class`, and empty `confirmed_class` / `reviewer` / `reviewed_at` /
   `review_notes` columns for Scott's row-by-row confirmation. The exact "after"
   numbers (§5) compute against this stable list, not a moving query.
   **Proposed-class distribution (review, not authoritative):**
   | proposed_class | rows | Σ price | needs confirm? |
   |---|---|---|---|
   | `phantom_duplicate` | 224 | $905,879,926 (195 survivor groups) | deterministic — apply unless marked `genuine_resale` |
   | `review` | 31 | $1.15B | yes — ambiguous high-$ tail (Anniston $142.9M, Satellite $130.85M…) |
   | `whole_center_multitenant` | 25 | $302.0M | yes |
   | `industrial_corporate` | 10 | $147.2M | yes (Fresenius operator RE — labeled, kept, excluded from clinic comps) |

   **Gate state (2026-06-11):** option (a) applied — the **224 phantom-dups are
   pre-confirmed** `confirmed_class='phantom_duplicate'` (supersession is
   mechanical); **204 carry `keeper_ambiguous=true`** + a `KEEPER-YEAR CHECK`
   note for Scott's targeted Check-2 keeper-year confirmation (override via
   `confirmed_keep_sale_id`). The **66 non-dup rows await `confirmed_class`.**
   The table now carries `keep_sale_id`, `keeper_year`, `keeper_year_n`,
   `span_yrs`, `distinct_years`, `keeper_ambiguous`, `confirmed_keep_sale_id`.

   Non-dup review queue (66 rows) + targeted keeper-year spot-check (204):
   ```sql
   -- (1) the 66 wrong-asset rows needing a class:
   SELECT sale_id, price, psf, bsf, property_type, name, tenant, city, state,
          which, proposed_class FROM public._sweep_candidates_2026_06_11
   WHERE confirmed_class IS NULL ORDER BY price DESC;
   -- set confirmed_class per row before STEP 3+ of remediation_dia.DRAFT.sql run

   -- (2) Check-2 keeper-year spot-check (widest spans first):
   SELECT property_id, price, span_yrs, keeper_year, keep_sale_id, review_notes
   FROM public._sweep_candidates_2026_06_11
   WHERE keeper_ambiguous ORDER BY span_yrs DESC;
   -- override confirmed_keep_sale_id where earliest != the true sale year
   ```
   The KEEPs in §2 (Dcc-Olympia Fields, Hiram, University Plaza) prove the
   non-dup classes can't be auto-applied — this table is the human gate.
2. **Port gov's taxonomy to dia** (additive, reversible): add
   `sales_record_classification` + `sales_exclusion_reason` to dia
   `sales_transactions` (mirror gov). Backfill existing `exclude_from_market_metrics=true`
   rows to `classification='excluded_legacy'` so nothing is silently reclassified.
3. **Apply non-representative exclusions** (no hard-deletes):
   `exclude_from_market_metrics=true` + `sales_record_classification` +
   `sales_exclusion_reason` = the §2 class, **and** a `field_provenance` row
   (`source='mis_ingestion_sweep_2026_06_11'`) per the LCC provenance doctrine.
4. **Re-type the wrong-type rows** (class B): set a `domain_classification_flag`
   on the property (e.g. `non_dialysis_reclassified` / `fresenius_industrial`)
   rather than deleting — keeps the row, removes it from clinic metrics.
5. **De-duplicate phantom sales** (class §3): keep the earliest/most-complete row
   per `(property_id, sold_price)` group, mark the rest
   `transaction_state='superseded_duplicate'` + `exclude_from_market_metrics=true`
   (mirror gov `duplicate_row`); populate `dedup_group_id` so the existing
   machinery owns them going forward. **Never delete.**
6. **Ingest guards (stop re-accumulation):**
   - **Writer guard** at sidebar `upsertDomainSales` (and the CSV importer):
     reject/queue-for-review a sale when corroborated signals fire
     (psf > band AND (name OR size OR non-dialysis ptype/tenant)), before it
     reaches market metrics — mirroring the existing `isJunkTenant()` defense.
   - **Data-quality view** `v_data_quality_issues` (dia) — add `whole_center_sale`,
     `non_dialysis_asset`, `phantom_duplicate_sale`, `oversized_clinic` issue
     kinds so new arrivals surface in the triage UI instead of silently counting.
   - **De-dup hardening:** extend the de-dup natural key to catch
     identical-price / different-date re-captures (the 195-group miss).
7. **Recompute before/after from the frozen list** and present to Scott. **Only
   after sign-off** do steps 3–5 write.

---

## Guardrails honored

- **Receipts-first. NO writes made.** All numbers above are from read-only
  `SELECT`s. The remediation SQL is a DRAFT and is not applied.
- **Idempotent + provenance-tagged + never hard-delete** — exclude / re-type /
  supersede and keep every row (mirrors gov and the LCC field-provenance
  doctrine).
- **No single-signal auto-exclusion** — §2 lists real KEEPs (Dcc-Olympia Fields,
  Hiram, University Plaza) that a one-signal rule would have wrongly dropped.
  Classification requires corroborating evidence (operator + $/sf + size + name
  together) and human confirmation at the gate.
- **dia first (the concrete case); gov run too** — gov's analogous bleed is
  already swept; only a light residual price/rba pass remains.

---

## Appendix — exact figures & query provenance
- Bands: §1 (read-only percentile queries on non-excluded sized sales).
- 40-row high-confidence candidate set + the seed $30M+ tail: `candidates_dia.sql`.
- Duplicates: 195 groups / 224 rows / $905,879,926 phantom volume (exact).
- Industrial cluster: 19 sales / 11 non-excluded / avg 145,234 sf / avg $12,275,904.
- gov: 14,142 / 9,666 excluded / 100% classified (read-only).
