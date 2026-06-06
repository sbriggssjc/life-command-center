# R69 Task 4 — Valuation Index reconciliation (master vs ours)

**Status: ANALYSIS + GATED DRY-RUN. No view changed live.** The corrected
definition repoints the index's rent source, which is a doctrine decision — it
needs Scott's blessing before the view change ships (per the round's gating rule).

Masters: `scripts/gov_master_allcharts.json` (366 mo, 1995–2025-06),
`scripts/dia_master_charts.json` (219 mo, 2009–2026-01), branch
`r69/master-index-data`.

Ours (gov, live): `cm_gov_valuation_index_m/_q`, `cm_gov_returns_indexes_m/_q`.

---

## 1. Side-by-side at anchor dates (gov, raw NOI/cap $ index)

| Date    | Master VI | Ours (raw) | Ours rebased(=100 @2010) |
|---------|-----------|------------|--------------------------|
| 1997-12 | 136.2     | — (no data) | —                       |
| 2005-12 | 191.1     | — (no data) | —                       |
| 2010-12 | 147.7     | 293.8      | 96.3                     |
| 2015-12 | 180.3     | 269.5      | 88.3                     |
| 2020-12 | 197.6     | 264.3      | 86.7                     |
| 2024-12 | 237.0     | 234.7      | 77.0                     |

**Master rises +60% over the decade (147.7→237). Ours falls −20% (293.8→234.7).**
This is Scott's "values only declining since 2010 (suspect)" — confirmed.

(2000-12 in the master = 19.2, a divide anomaly; the master is only *continuous*
from ~2005, so any back-extension target is ~2005, not 1997.)

---

## 2. Formula diff

**Master VI = (Avg. Rent − Expenses PSF) / Avg Cap Rate.** Exact match at every
anchor (e.g. 2010 (21.548−8.878)/0.086 = 147.7; 2024 (26.867−8.396)/0.078 =
237.0). Both the rent and the expense are TTM **universe** averages.

**Ours VI = avg_noi_psf / avg_cap_rate**, where `avg_noi_psf` is the average of
**per-sold-comp** NOI/SF. (The view already computes `avg_rent_psf` /
`avg_expenses_psf` separately but does not use them for the index.)

Two differences, only the second matters:

1. *avg-of-NOI vs (avg-rent − avg-exp).* Swapping ours to `(avg_rent_psf −
   avg_expenses_psf)/cap` barely moves it (2010 306.1, 2024 226.4) — **still
   declines.** So this is NOT the root cause.

2. **Rent SOURCE (the root cause).** Our rent input is the *sold-comp*
   `gross_rent_psf`, which is composition-biased and **declines** (32.49→26.71 by
   anchor). The master's `Avg. Rent` is a stable **universe** series that holds /
   rises (21.5→26.9). A universe rent series in our gov DB behaves like the
   master's, not like our sold-comp rent:

   | Date    | Ours sold-comp rent | GSA-inventory active-lease avg rent_psf | Master Avg.Rent |
   |---------|--------------------|------------------------------------------|-----------------|
   | 2010-12 | 32.49              | 32.56 (n=833, thin)                      | 21.5            |
   | 2015-12 | 28.38              | 30.82 (n=2,537)                          | 23.6            |
   | 2020-12 | 27.70              | 30.94 (n=5,088)                          | 25.8            |
   | 2024-12 | 26.71              | 31.56 (n=7,413)                          | 26.9            |

   The GSA-inventory universe rent is **flat/stable** (right shape), unlike our
   declining sold-comp rent. It does NOT match the master's *level* (~$31 vs
   ~$22-27), so the master uses a different/weighted universe rent — see the
   gated question below.

Expenses are fine: master Expenses PSF ~8-11 stable; our `avg_expenses_psf`
~9-10 stable. The decline is entirely the rent input.

---

## 3. Corrected definition (proposed — DRY-RUN, not applied)

```sql
-- valuation_index = (universe_avg_rent_psf - universe_avg_expenses_psf) / avg_cap_rate
-- with the rent (and expense) sourced from the gov UNIVERSE (active leases),
-- not the thin/composition-biased sold-comp sample. Extend the month spine back
-- to where the chosen universe rent series is continuous (GSA inventory becomes
-- meaningful ~2013; if a longer rent series is chosen, back to ~2005 to match
-- the master's continuous range). Keep the rebase-to-100-at-first-month step.
```

This removes the composition bias (universe rent is stable→rising), which flips
the index from declining to rising in line with the master and with reality
(gov RE values rose 2010-2024 on cap compression + rent growth).

---

## 4. THE GATED DECISION (needs Scott)

The only open question is **which rent/expense universe series** the index should
use, because the master's `Avg. Rent` (~$22-27) is *lower* than every single gov
rent table I have (GSA inventory ~$31; sold-comp ~$27-32; renewal ~$32-36). The
master is clearly a universe series (stable shape) but at a level I can't
reproduce from one of our tables 1:1 — it is probably SF-weighted, or filtered
(e.g. office-only, or excludes BTS/high-rent), or net-of-something.

Options to confirm before I touch the view:
- **(A)** Use GSA-inventory active-lease avg rent_psf (stable, available, but
  ~$31 level → index level shifts up vs the master; shape matches).
- **(B)** SF-weighted GSA-inventory rent (likely closer to the master level).
- **(C)** Reproduce the master's exact rent construction if Scott can point to
  the source column/filter behind the workbook's `Avg. Rent`.

Recommendation: **(B)** SF-weighted universe rent + (rent−exp)/cap + extend spine,
rebased. I'll wire it as a dry-run view variant, post the 8-anchor master-vs-new
table for sign-off, then swap the live view + `_q` + the returns-index views
(which share the same NOI input) in one gated migration.

## 5. dia (D2) — same pattern, deferred to the same gate
dia master carries `Valuation Index` (276.95 @2009 → 305.85 @2026), `Rent per SF
(ttm)`, `Cash/Leveraged Return Index`. The dia valuation view has the identical
avg-per-comp-NOI construction. Apply the same corrected definition (universe rent
source) once Scott confirms the rent source on the gov side; dia rent universe =
dia leases projected rent (`v_sales_comps.rent` / `dia_project_rent_at_date`).

---

*Generated R69 Task 4, 2026-06-06. Receipts are live reads from the gov DB
(`scknotsqkcheojiaewwh`) and the master workbooks on `r69/master-index-data`.*
