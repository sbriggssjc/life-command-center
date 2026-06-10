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

### Recommendation (Layer-D / B1 gate decision for Scott)
The dia cap-by-term x-axis currently reaches back to 2001/2005 and shows the
structurally-incomplete pre-2014 fan (tangled/partial lines = the "conflict").
Per Scott's standing rule ("extend only where consistent; gate + annotate
genuine thinning"), the fix is to **floor the dia cap-by-term x-axis to ~2014-06**
(where all 4 cohorts are continuous) and/or annotate the thin pre-2014 region —
NOT a data/propagation change. Decide at the gate. (The same eligible-rows check
still owes the gov cap-by-term + cap-by-credit cohorts — A3 continues.)

---

## Status of the rest of Round 76 (scoped across sessions, per the note)
- **A1** — done.
- **A2** — gov fix applied live + verified (mis-bin floor + median); the genuine
  2024-25 inversion documented. **dia leg held for Scott's gate decision.**
- **A3 / B / C / D / E / F / G** — not started. A3 (eligible-DB-rows vs
  chart-rows per cohort/year) is the natural next receipt pass and shares the
  classification SQL above; B1 owns the pre-2016 deep-history 6-10 spikes.
