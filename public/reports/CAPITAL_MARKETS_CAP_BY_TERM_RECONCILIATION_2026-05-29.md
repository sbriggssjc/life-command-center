# Cap-by-Term Cohort Reconciliation — gov (master/PDF vs ours)

**Date:** 2026-05-29
**Scope:** `cm_gov_cap_by_term_m` / Data_Cap_by_Term vs *State of the Government-Leased Market* p.15 ("Cap Rate Comparison | The Value of Firm Lease Term").

## Master (PDF p.15, 2Q-2024) — a clean firm-term ladder

| Cohort | TTM cap | 10-yr avg |
|---|---|---|
| 10+ Year | 6.94% | 6.35% |
| 6–10 Year | 7.27% | 7.22% |
| Less than 5 Years | 7.73% | 8.49% |
| Outside Firm Term | 8.33% | 9.08% |

Monotonic: longer firm term → tighter cap, ~140 bps spread end-to-end.

## Ours (cm_gov_cap_by_term_m, recent) — ladder broken

- `cap_less5` is **NULL** (master shows 7.73%).
- `cap_6to10` (8.87%) sits **above** `cap_outside_firm` (8.0%) — inverted.
- All cohorts run ~80 bps high (the known sales-universe gap).

## Root cause — firm-term can't be resolved for ~67% of sold gov properties

Fresh cohort breakdown for the 2026-Q1 TTM window (69 qualifying sales):

| Firm-term source | Coverage (of 69) |
|---|---|
| `leases` lateral join (lease active at sale, firm_term_years > 0) | **22** |
| `sales_transactions.firm_term_years` (direct, from the Sold sheet) | **6** |

Why the `leases` join fails (the 47 it can't classify):

| Reason | Count |
|---|---|
| Property has **no lease record at all** | 20 |
| Property has a lease but it **expired before the sale** (no at-sale lease captured) | 26 |
| Active lease but `firm_term_years` NULL | 1 |
| Resolved firm term | 22 |

So **~67% of recent sold gov properties have no resolvable at-sale firm term**, and they all fall into "Outside Firm Term" (64 of 69 in that bucket when computed off the direct column; 47 off the lease join). The named cohorts (10+, 6–10, <5) are left with n=1–13 — tiny, noisy, and `<5` empty. That's why the ladder is inverted/incomplete.

The direct `sales_transactions.firm_term_years` column *is* the right concept (it's the Sold-sheet FIRM value), but it's only populated on the **Excel-imported historical** sales — the recent **CoStar-captured** sales don't carry it. The master deck has firm term on every comp because the analyst **fills FIRM/TERM in by hand**; our automated capture doesn't.

## Conclusion: source-data coverage gap, not a view/chart bug

The 2015 trim (shipped) fixes the erratic *lines* and the missing x-labels. The cohort **levels** can't match the master until firm-term data exists on the recent sales. This is the same class of limitation as cap-by-credit state/municipal and the inventory-backlog history — the chart logic is correct; the input data is sparse.

## Fix path (data enrichment, not a chart change)

1. **Backfill `sales_transactions.firm_term_years`** for sold gov properties, in priority order:
   a. From the matched **`gsa_leases`** inventory (it carries lease effective/expiration → derive firm/total term) joined on lease_number / property.
   b. From the **CoStar lease tab** capture where available (the sidebar pipeline can populate firm term).
   c. Manual fill for flagship comps (mirrors the master's process).
2. **Then** rework the cohort computation in `cm_gov_market_quarterly_master_m_mat` to bucket on `COALESCE(sales_transactions.firm_term_years, lease-join firm term)` so coverage is maximized and the named cohorts fill.
3. Re-verify the ladder is monotonic (10+ < 6–10 < <5 < outside) and within ~range of the master.

Until (1) lands, expect the cohort lines to remain thin/inverted in recent periods — the trim keeps the *shape* clean but can't manufacture firm-term classification we don't have.

## Note on the duplicate column

`cm_gov_cap_by_term_m` emits both `cap_6to10` and `cap_5to10` mapped to the same underlying `cap_5to10_year`. The chart only plots `cap_6to10`, so there's no doubled line — but the redundant `cap_5to10` column should be dropped during the rework above for clarity, and the bucket boundary aligned to the master's **6–10** (ours is currently 5–10).
