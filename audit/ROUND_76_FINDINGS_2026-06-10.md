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

## A2 — non-monotonic gov cohorts — **DIAGNOSED, view change GATED for Scott**

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

## Status of the rest of Round 76 (scoped across sessions, per the note)
- **A1** — done (this session).
- **A2** — diagnosed (this session); view change awaits Scott's stat decision.
- **A3 / B / C / D / E / F / G** — not started. A3 (eligible-DB-rows vs
  chart-rows per cohort/year) is the natural next receipt pass and shares the
  classification SQL above.
