# Round 76 — June-10 export review findings (Layer A: cohort data)

Receipts-first investigation of the two verified-live Layer-A defects. Live data
pulled 2026-06-10 from gov (`scknotsqkcheojiaewwh`) and dia
(`zqzrriwuavgrquhisnoa`).

---

## A1 — empty cohort columns / dual bucketing — **FIXED (JS, ships on Railway redeploy)**

### Root cause (proven)
`CHART_COLUMNS` in `api/_shared/cm-excel-export.js` is keyed by
`chart_template_id`, **not vertical**, and lists the **union** of both verticals'
cohort schemes for the three cap-by-term tabs:

| tab | dia scheme | gov scheme |
|---|---|---|
| `Data_Sold_Cap_by_Term` | cap_12plus / cap_8to12 / cap_6to8 / cap_5orless | cap_10plus / cap_5to10 / cap_less5 / cap_outside_firm |
| `Data_Cap_by_Term` | cap_12plus / cap_8to12 / cap_6to8 / cap_5orless | cap_10plus / cap_6to10 / cap_less5 / cap_outside_firm |
| `Data_Ask_Cap_by_Term` | cap_12plus / cap_8to12 / cap_6to8 / cap_5orless | (dia only) |

But each vertical's view exposes **only its own scheme** (verified via
`information_schema.columns`):

- dia `cm_dialysis_sold_cap_by_term_dot` → `cap_12plus, cap_8to12, cap_6to8, cap_5orless`
- gov `cm_gov_sold_cap_by_term_dot` → `cap_10plus, cap_5to10, cap_less5, cap_outside_firm`
- gov `cm_gov_cap_by_term_q` → `cap_10plus, cap_6to10, cap_less5, cap_outside_firm`

So each exported tab shipped **4 permanently-NULL cohort columns**. Scott reads
the empty gov-scheme `10+ Year Cap` column inside a **dia** tab as a "missing
10+ cohort", and the half-blank tab as "the data conflicts with itself".

Secondary defect surfaced: a gov-internal naming split — the **dot** view
exposes `cap_5to10` while the **quarterly** view exposes `cap_6to10` for the
same "6-10 yr" cohort.

### Fix
`selectCohortColumns(cols, chartTemplateId, vertical, rows)` — prunes the
cap-by-term tabs to the vertical's canonical scheme:
1. drops the **other** vertical's cohort scheme entirely, and
2. drops any remaining cohort column that is **100% empty** across the data
   (auto-resolves the gov `cap_5to10`/`cap_6to10` alias — only the column the
   active view actually exposes survives).

Non-cohort columns (period_end / subspecialty) are never touched. The native
chart injector already sniffs the rows + drops missing columns, so chart series
binding is unaffected — they simply can no longer bind to a null set.

Before/after (proven):
```
sold_cap_by_term_dot_plot  UNION: cap_12plus,cap_8to12,cap_6to8,cap_5orless,cap_10plus,cap_5to10,cap_less5,cap_outside_firm
                           DIA  : cap_12plus,cap_8to12,cap_6to8,cap_5orless
                           GOV  : cap_10plus,cap_5to10,cap_less5,cap_outside_firm
cap_rate_by_lease_term     DIA  : cap_12plus,cap_8to12,cap_6to8,cap_5orless
                           GOV  : cap_10plus,cap_6to10,cap_less5,cap_outside_firm
```
Regression test: `test/cm-cohort-column-prune.test.mjs` (7 cases). Full suite
555 pass / 0 fail.

**Canonical bucketing decision (per the A1 ask):** dia = 12+/8-12/6-8/≤5 ·
gov = 10+/6-10/<5/Outside-Firm. This is already what each vertical's view
produces; the only change needed was removing the off-vertical columns from the
tab. No DB/view change required for A1.

---

## A2 — non-monotonic gov cohorts — **FIXED (gov applied live 2026-06-10); dia leg gated for Scott**

### Resolution (applied live to gov `scknotsqkcheojiaewwh`, migration `20260610_cm_round76_a2_gov_cap_by_term_misbin_median.sql`)
Two surgical fixes to the three gov cap-by-term views (`cm_gov_cap_by_term_q`,
`_m`, `cm_gov_sold_cap_by_term_dot`), in Scott's order:

**(1) Mis-bin floor (correctness).** The firm_rem ladder preferred
`s.firm_term_years_at_sale` first, but that column is in practice the **original**
firm term (98.6% identical to `s.firm_term_years` where both exist — 1,230/1,248),
NOT remaining-at-sale. For mid-lease sales it overstates remaining and over-buckets
the deal. A blanket reorder is wrong (gsa termination often points past the sold
lease's firm end → moves 437 rows mostly UPWARD). The correct floor is
`COALESCE(LEAST(firm_term_years_at_sale, gsa_termination_remaining,
lease_firm_remaining), firm_term_years, lease_expiration_remaining)` — only ever
SHORTENS an overstated proxy (**67 rows table-wide, all downward**: 6-10→<5 25,
10+→6-10 24, 10+→<5 18). Smoking gun: Williston VT — GSA termination AND
lease-firm-remaining both say ~1yr, proxy said 6.0 → was 6-10, correctly → <5.

**(2) Mean → median (`percentile_disc`).** The cohort statistic was the mean,
which the 2024-26 skew exaggerated (10+ mean 7.04 sat below its own median 7.28,
so 6-10 visually overtook 10+). Inner per-cohort stat only; the ±1q/±3mo smoothing
of the gated series stays `avg()`. `percentile_disc` (not `_cont`) keeps the column
`numeric` — `CREATE OR REPLACE VIEW` can't change column type and `_cont` returns
double precision; the disc-vs-interpolated difference is <few bps at these n.

**n≥5 gate, 2yr-TTM window, smoothing all unchanged** (Scott's guardrail).

### Firm_rem source audit (the receipts Scott asked for, gov 6-10 cohort, 2-yr → 2026-Q1)
- Which source terms each 6-10 sale: **22/26 tier-1** (`firm_term_years_at_sale`),
  **4/26 tier-2** (GSA termination). **Zero** from the suspect tier-4/tier-5.
- Is tier-1 right? Mostly — but it's effectively *original* term (see above), so it
  overstates remaining for the mid-lease minority. Table-wide it overstates by >1yr
  in only 41/1,536 cross-checkable rows (~2.7%). In the recent 6-10 cohort exactly
  **1/22** is clearly mis-termed (Williston). The cohort's high cap is therefore
  **not** a sourcing artifact — ~85% are correctly-termed near-commencement deals
  that genuinely traded high in 2024-26.

### Before / after (live views, smoothed + gated)
| view · quarter | 10+ | 6-10 | <5 | ordering |
|---|---|---|---|---|
| q · 2022 BEFORE | 6.24 | 6.69 | 6.96 | monotonic |
| q · 2022 AFTER  | 6.13 | 6.77 | 7.02 | monotonic (~89bps premium intact ✓) |
| q · 2026 BEFORE | 6.99 | **7.16** | 7.08 | CROSS (6-10 highest — the defect) |
| q · 2026 AFTER  | 7.00 | 7.14 | 7.29 | **monotonic ✓** |
| dot · 2026 BEFORE | 7.02 | **7.16** | 7.05 | CROSS |
| dot · 2026 AFTER  | 7.07 | 7.12 | 7.24 | **monotonic ✓** |

**The 6-10-as-top-line spike now occurs in 0 quarters after 2015-09-30** — the
entire 2024-26 region Scott flagged is clean (the 12 remaining spikes are all
2005-2015 deep-history thin-n, a separate Layer-B1 completeness item).

### Genuinely-inverted period — documented, not smoothed away (per Scott's rule)
2024-Q3 → 2025-Q4 the gov fan is now **parallel but inverted**: 10+ > 6-10 > <5
(e.g. 2025-Q1 10+ 7.30 > 6-10 7.05 > <5 6.96). This is the real post-2023 gov
repricing (long-duration federal deals trading wider on rate/agency risk) that the
R73 migration already established survives 2yr pooling + n≥5. The fix removes the
**artifactual** 6-10 spike; this **genuine** inversion is shown honestly.

### dia leg — gated for Scott's call (not applied)
Scott asked to apply median cross-vertically "if dia carries the same skew." Receipts:
dia skew is **mild and bidirectional**. At 2017 the 8-12 cohort spikes (mean 7.16 vs
median 6.90 — median *helps* the "pre-2018 conflict"), but at 2026 the dia **mean is
already monotonic** (12+ 6.55 < 8-12 6.56 < 6-8 6.80 < ≤5 7.26) and median slightly
disorders 6-8/≤5 (7.15 vs 7.09, ~6bps). Also the dia *line* chart sources from
`master_m`, not the dot view, so a clean median swap there is non-trivial. And the
gov mis-bin LEAST floor **cannot** apply to dia (dia uses `firm_term_years_at_sale`
directly, no gsa/lease cross-check source). **Recommendation:** hold dia — median is
neutral-to-mixed and risks moving dia *away* from the PDF. Decide at the gate.

---

## A2 — original diagnosis (retained for the receipts trail)

### The symptom (live, `cm_gov_cap_by_term_q`, smoothed)
2026-Q1: 10+ = 6.99% · **6-10 = 7.16%** · <5 = 7.08% · Outside = 7.44%
→ the 6-10 line crosses above 10+ and <5 (expected order 10+ < 6-10 < <5 < Out).

### Receipts — per-cohort n by quarter (2-yr TTM pool, pre-smoothing)
| period | n 10+ | cap 10+ | n 6-10 | cap 6-10 | n <5 | cap <5 | n Out |
|---|---|---|---|---|---|---|---|
| 2026-Q1 | 14 | 7.04 | 26 | 7.20 | 43 | 7.13 | 13 |
| 2025-Q4 | 16 | 6.94 | 35 | 7.12 | 53 | 7.04 | 10 |
| 2025-Q1 | 27 | 7.07 | 51 | 7.00 | 71 | 6.89 | 9 |
| 2024-Q1 | 42 | 6.55 | 66 | 6.56 | 106 | 6.78 | 25 |
| 2023-Q1 | 61 | 6.15 | 89 | 6.61 | 155 | 6.82 | 33 |
| 2022-Q1 | 64 | 6.27 | 94 | 6.73 | 164 | 6.92 | 47 |
| 2020-Q1 | 58 | 6.34 | 78 | 6.73 | 161 | 7.13 | 46 |

### What the receipts rule OUT
- **Not starved.** Every cohort clears the n≥5 gate by a wide margin
  (2026-Q1: 14/26/43/13). A2's "is the 6-10 bucket starved" → **no**.
- **Not a single outlier.** Mean-vs-median over the 2-yr window ending 2026-Q1:

  | cohort | n | mean | median | min | max | sd |
  |---|---|---|---|---|---|---|
  | 10+ | 11 | 7.04 | 7.28 | 6.11 | 8.00 | 0.65 |
  | 6-10 | 17 | 7.20 | 7.25 | 6.00 | 7.97 | 0.61 |
  | <5 | 20 | 7.13 | 7.35 | 5.54 | 8.17 | 0.79 |
  | Out | 13 | 7.36 | 7.46 | 5.50 | 9.96 | 1.17 |

  The medians are clustered 7.25–7.46 with **no clean term premium** — the
  cohorts genuinely overlap; it is not one deal swinging a thin bucket.
- **Not fixable by re-bucketing on original term.** Bucketing the same window
  by `s.firm_term_years` (original total firm term, the suspected master
  method) is **not viable**: 49 of 61 rows (80%) have it NULL. This is exactly
  why the view uses the remaining-term ladder (`firm_rem`). Re-bucket rejected.

### What the receipts show IS happening
1. **A real regime change ~2024→2025.** 2020–2023 carry a clean ~70bps term
   premium (10+ ≈6.2%, <5 ≈6.9%, monotonic). From 2025 the premium compresses
   to ~0 and crosses (2025-Q1 fully inverts: 10+ 7.07 > <5 6.89). This is a
   multi-quarter pattern, not a blip — consistent with gov term-premium
   compression in the higher-rate market.
2. **Mean-skew amplifies the crossing.** The 10+ cohort's mean (7.04) sits
   *below* its own median (7.28) — a few low-cap long-term trades drag the mean
   down, so on a **mean** chart 6-10 visually overtakes 10+ harder than the
   medians warrant.

### Decision gate for Scott (no view change made — dry-run posture)
The honest fix is a judgment call between:
- **(a) Switch the cohort statistic mean → median (or trimmed mean).** More
  robust to the skew that exaggerates the crossing; median is the conventional
  "cap rate by term" deck statistic. Reduces the artifactual portion but will
  NOT force monotonicity — the medians still overlap (the compression is real).
- **(b) Keep mean, annotate the compressed period.** Document 2024-2026 as a
  genuinely compressed/inverted gov term premium with these receipts, and let
  the lines cross honestly (matches the A2 instruction to "document any
  genuinely-inverted period with receipts").
- **(c) Do both** — switch to median AND annotate the residual overlap.

Recommendation: **(c)** — median is the more defensible statistic for a cap-by-
term cohort chart and pulls the recent cohorts back toward parallel, with a
footnote that the 2024-2026 gov term premium has genuinely compressed. Either
way the change is a `CREATE OR REPLACE VIEW` on `cm_gov_cap_by_term_q` /
`_m` / `_sold_cap_by_term_dot`, applied live with before/after, then back to the
gate — deferred pending Scott's pick.

---

### dia mis-bin check — CLEAN, no fix (Scott's conditional)
dia has no gsa ladder, but it carries `firm_term_expiration_at_sale` (firm-term
END date at sale) as a cross-check. Of 2,021 dia sales with both,
**97.4% (1,969)** have `firm_term_years_at_sale` ≈ (expiration − sale_date),
avg gap −0.01yr; only 22 (1.1%) overstate remaining by >1yr. So dia's term
column is genuinely **remaining-at-sale, not original** — dia does NOT have the
gov mis-bin error. **No dia mis-bin fix applied** (per Scott: do it iff real).

---

## A3 — propagation: eligible-DB-rows vs chart-rows (dia cap-by-term lead)

### dia cap-by-term "doesn't match PDF / conflicts prior to 2018" — NOT a propagation gap
The dia LINE chart (`cap_rate_by_lease_term`) sources from
`cm_dialysis_cap_by_term_m`, a thin rename over the master table
`cm_dialysis_market_quarterly_master_m`. Compared the master_m cohort columns
against the sales-computed `cm_dialysis_sold_cap_by_term_dot` (the DB universe)
per period 2001-2026: **byte-identical, 0.00 bps difference, matching month
coverage every year.** The R66x unification holds — the chart pulls master_m
exactly. **There is no propagation/filter gap dia-side.**

### The real cause = genuine pre-2014 cohort sparsity (Layer B1 at cohort grain)
Eligible dia sales per cohort per year (cap_rate_final in band + term present):
- **≤5 cohort: literally 0 deals every year 2005-2013**; first appears 2014.
- **6-8 cohort: 0-2/yr before 2014.**
- **8-12: thin** (often <12/yr ⇒ <3 in many 1yr-TTM windows ⇒ intermittently
  gated ⇒ the spiking "conflicting" line; e.g. the 2017 8-12 = 7.16% spike is
  a thin-n artifact off ~20 deals).
- **~40% of pre-2018 dia sales have NULL cap** (2017: 75 cap-null vs 114 usable),
  shrinking effective n further.
- Plus a hard hole: **2002-2004 = zero data** in both sources.

The 4-cohort dia fan first becomes continuous at **2014-06-30** (since then
142/147 months carry all 4 cohorts; pre-2014 = 156 partial months where ≤5 / 6-8
don't exist). So the pre-2014 tangle is structural sparsity, not a bug.

### CORRECTION — there is already a 2015 floor, and the crossing persists to 2018
The dia cohort charts (`cap_rate_by_lease_term`, `sold_cap_by_term_dot_plot`,
`asking_cap_by_term_dot_plot`) **already floor at static year 2015** in
`cm-native-chart-injector.js MIN_YEAR_BY_TEMPLATE` (added 2026-05-29 for exactly
this "conflicts prior to 2018" note). So the chart Scott sees starts at 2015, not
2001 — and his note is still accurate because the crossing PERSISTS past 2015.
Dia dot view ordering at year-ends (smoothed, what the chart shows):

| yr | 12+ | 8-12 | 6-8 | ≤5 | ordering |
|---|---|---|---|---|---|
| 2014 | 6.82 | 7.02 | 6.71 | 7.67 | CROSS |
| 2015 | 6.52 | 7.02 | 6.96 | 7.03 | CROSS |
| 2016 | 6.54 | 6.60 | 6.99 | 7.31 | ordered |
| 2017 | 6.19 | 7.12 | 6.78 | 6.96 | CROSS |
| 2018 | 6.24 | 6.81 | 7.07 | 6.92 | CROSS |
| 2019 | 6.18 | 6.60 | 6.94 | 7.11 | ordered |

The 8-12 cohort is volatile through 2018; ordering only settles ~2019. This is
because the ≤5 cohort (n=2/4/4/10/21 in 2015-18) and 8-12 stay modest-n, and dia
is on **mean** (Scott's confirmed call — median rejected). So:
- **Pre-2014 is genuine sparsity** (≤5/6-8 absent) — the existing 2015 floor
  already crops most of it.
- **2014 is NOT the right floor** — it's thinner than 2015 (would reintroduce
  crossing, exactly what Scott warned against).
- **The residual 2015-2018 crossing is modest-n noise on the mean**, not a bug,
  and only fully clears ~2019.

### RESOLVED — floor dia cap-by-term at 2019 + annotate (Scott 2026-06-10, APPLIED)
Scott's call: floor at the earliest quarter the series stays consistent (doctrine:
"floor where consistent; gate + annotate genuine thinning"). For dia that's **2019**
(2015-2018 cross on small-sample noise; ordering only settles 2019). 2014 ruled out
(thinner). No added smoothing (Scott's gov-#20 over-smoothing objection).

**Pre-apply check (Scott asked): is the master/PDF dia cap-by-term richer than ours?**
NO — the **master Excel carries no cap-by-term tab at all** (`audit/cm-style-audit/
dia-diff.md`: "Data_Sold_Cap_by_Term / Data_Ask_Cap_by_Term — master does not
include this tab"). The chart is LCC-built from `master_m`, which == the
sales-computed dot view byte-for-byte (0.00 bps, proven above). So there are **no
curated comps we're not pulling** → this is a floor decision, NOT a propagation
finding. (The deck p.22 PDF itself isn't in the repo to read a start year, but the
data evidence is conclusive; dia firm-term IS well-captured — 97% — unlike gov,
whose cap-by-term thinness is a real firm-term coverage gap per
`CAPITAL_MARKETS_CAP_BY_TERM_RECONCILIATION_2026-05-29.md`.)

**Applied (Railway redeploy ships it; DB unaffected):**
- `cm-native-chart-injector.js` — replaced the three cohort templates' static
  `2015` floor with `capByTermFloor(rows)`: returns **2019 for dia** (detected by
  its exclusive `cap_8to12`/`cap_5orless` cohort columns), **2015 for gov**
  (unchanged — gov's own A3 classification is pending). The floor crops only the
  charted x-axis; the Data_* tab keeps full history.
- `cm-excel-export.js` — appended the annotation to the `cap_rate_by_lease_term`
  description: "Dialysis starts 2019: before then the ≤5- and 8-12-year cohorts
  carry too few comps per TTM window to hold a stable ordered premium… Gov starts
  2015."
- Verified: `node --check` clean (both files); chart suite 183/0; full suite 555/0;
  12 functions. capByTermFloor → 2019 on dia rows / 2015 on gov rows.

(gov cap-by-term + gov sentiment-10+ A3 classification still owed — next A3 targets.)

---

## A3 — gov #13 Cap-by-Credit (two-part: classifier + design E2), APPLIED

### Part 1 — classifier: genuine sparsity, NO propagation gap
Source view `cm_gov_cap_by_credit_q` reads the master mat's `federal_cap`/
`state_cap`/`municipal_cap`. Eligible-DB-rows vs charted-quarters:

| cohort | eligible sales (cap+tier) | charted quarters (of 101) |
|---|---|---|
| Federal | 3,414 | 101 |
| State | 303 | 76 |
| Municipal | 81 | 29 |

State (303) and municipal (81) **are** reaching the chart (76 / 29 quarters) —
consistent with the eligible counts under a TTM n-gate. In 2014+ there are **0
isolated single points** (muni gaps are contiguous runs). So Scott's "missing
data" is genuine **sparsity** (muni ≈ <1 sale/quarter), not a filter dropping
eligible rows. **The stale Round-21 / R73 note ("0 state, ~5 municipal") is
simply wrong now** — retired in both the chart description and the renderer/
injector comments. No data fix; this is the floor/marker class.

### Part 2 — design E2: consistent cohort line style (APPLIED)
The defect: state/municipal rendered with **markers on every point + a thinner
line (2 vs 2.5)** while federal was a clean line — so they read as a different
SERIES TYPE (Scott E2: "line type different for municipal and state — fix").
- **PNG image** (`cm-chart-image-renderer.js`) — all three now share one line
  style (solid, `borderWidth 2.5`, `tension 0.3`); a scriptable `pointRadius`
  (`isoPointRadius`) shows a marker **only at a genuinely isolated point** (value
  present, both neighbors null), so a lone reading still appears but contiguous
  runs render identically to federal. `spanGaps:false` keeps real gaps broken.
  (QuickChart's JS-literal serializer preserves the function — confirmed.)
- **Native Excel chart** (`cm-native-chart-injector.js`) — Excel can't do
  per-point conditional markers, so all three render as one uniform plain line
  (no per-series markers) = literally "the same line style as federal." Isolated
  points are surfaced in the PNG; the editable chart prioritizes a clean trend.
- **Description** (`cm-excel-export.js`) — replaced the stale "0 state/~5 muni"
  note with the honest sparsity framing (303/81 eligible; ~76/29 quarters; same
  line style across cohorts).
- Test `R73 B13 …markers` → rewritten to `R76 E2 …uniform plain-line style`.
- Verified: `node --check` clean (3 files); full suite 555/0; 12 functions.

(gov sentiment-10+ + dia Ask-Cap-by-Term A3 classification still owed.)

---

## A3 — gov Sentiment "10+" cohort (classifier + R73 #22 definition), CONFIRMED HEALTHY

### Part 1 — classifier: cohort is well-populated, NO propagation gap, NO absence
The gov sentiment long-term cohort fetches from `cm_gov_seller_sentiment_m`.
Density by year (TTM):

| yr | n_all | n_6+ | months charted (6+) |
|---|---|---|---|
| 2010 | 10 | 6 | 12/12 |
| 2013 | 17 | 5 | 12/12 |
| 2016 | 37 | 8 | 12/12 |
| 2019 | 79 | 12 | 12/12 |
| 2022 | 75 | 16 | 12/12 |

The 6+ cohort renders **12/12 months every year from 2010** (n above the n≥3
gate throughout). So this is neither a propagation gap nor genuine absence —
unlike cap-by-credit muni. Notably, **R73 #22's 10+→6+ redefinition is itself
what fixed the "missing data"**: a 6+ firm-yr cohort is far denser than a 10+
one would be. The existing 2016 floor crops the modest-n early years (n 5-9 in
2010-2017) — consistent with the cap-by-term "floor where consistent, don't
over-smooth" doctrine. No floor change.

### Part 2 — R73 #22 definition: ALREADY CORRECT in data AND label
- **Data**: the live `cm_gov_seller_sentiment_m` buckets the long-term cohort at
  **`firm_term_years >= 6`** (verified in the view def — every long-term FILTER
  is `>= 6`). NOT 8+, NOT 10+.
- **Label**: the renderer labels gov `6+` (dia `10+` — correct, dia's core is
  10+), and the `Data_Sentiment` header is relabeled `10+ yr`→`6+ yr` for gov
  (export R73 #22 block). So bucket and label agree — no fix needed.
- **The only stale artifact** was a code COMMENT in `capital-markets.js` claiming
  the cohort is an "8+yr split" — corrected to note the live bucket is 6+
  (`firm_term_years >= 6`, R73 #22). No functional change; `node --check` clean.

---

## A3 — dia Ask-Cap-by-Term / cohort dots (CLOSES A3), APPLIED + Layer-C handoff

Source: `cm_dialysis_asking_cap_by_term_m` ← `cm_dialysis_active_listings_m`
(2yr TTM window, n≥5 gate, 7-mo smooth). Two failure modes separated per Scott:

### (b) date-gap exclusions → Layer C (the headline, NOT a floor)
The active-window JOIN requires `listing_date IS NOT NULL AND <= period_end`.
Receipts on dia `available_listings` (excl. synthetic):
- **2,808** listings have a usable asking cap (0.04-0.12).
- **932 of those (33%) have a NULL `listing_date`** → excluded from EVERY
  active-window anchor, so a third of the cap-eligible asking universe never
  reaches the cohort chart.
- Future `off_market_date` / future `sold_date` = **0** (the #9-style over-stay
  overcount is NOT present in dia today — clean on that axis).
**Routing: Layer C** (on-market snapshot/date-quality). Flooring cannot recover
these rows; the fix is the listing_date gap / membership logic, tracked under C.

### (a) genuine cohort sparsity → completeness floor 2017 (APPLIED)
The ≤5 and 6-8 asking cohorts do **not exist before 2017** (mo68/mo5 = 0 in
2013-15, partial 2016); all four render continuously (12/12) from **2017**
(n12=24, n8=28, n68=7, n5=16). So it IS the same structural sparsity as sold —
but the floor differs:
- **Asking caps cross in nearly every year** (2016 CROSS, 2017 CROSS, 2018-19
  ordered, 2020 CROSS, 2021 CROSS, 2022 CROSS) even at high n — because asking
  is seller pricing, not closed-sale evidence, so there is **no term-premium
  ordering to floor on** (unlike sold, which settles ~2019).
- Therefore the honest asking floor is **completeness (2017)**, not the sold
  ordering floor. My initial R76 `capByTermFloor` had over-cropped asking to
  2019 (it inherited the sold rule); split out **`askByTermFloor` → 2017** for
  `asking_cap_by_term_dot_plot` (sold + line chart keep `capByTermFloor` → 2019).
- Annotated the asking chart description: starts 2017 (completeness); asking
  cohorts don't form a clean term-premium ladder — read levels, not ordering.
- Verified: `node --check` clean; full suite 555/0; 12 functions.

**A3 is complete.** Four flagged cohort/cap charts classified:
cap-by-term (dia, floor 2019) · gov #13 cap-by-credit (sparsity + E2 line-style)
· gov sentiment 6+ (healthy, R73 #22 verified) · dia ask-cap-by-term (floor 2017
+ a Layer-C date-gap handoff: 932 NULL-listing_date listings).

---

## Status of the rest of Round 76 (scoped across sessions, per the note)
- **A1** — done.
- **A2** — gov fix applied live + verified (mis-bin floor + median); the genuine
  2024-25 inversion documented. **dia leg held for Scott's gate decision.**
- **A3 / B / C / D / E / F / G** — not started. A3 (eligible-DB-rows vs
  chart-rows per cohort/year) is the natural next receipt pass and shares the
  classification SQL above; B1 owns the pre-2016 deep-history 6-10 spikes.
