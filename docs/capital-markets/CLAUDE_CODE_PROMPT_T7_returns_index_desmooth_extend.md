# Claude Code prompt — T7: de-smooth the gov returns index (+ dia for consistency) + extend to ~1997

> Scott (June-25, gov export): the gov **Returns Index** "does not move like dialysis or our PDF/Excel — so
> much smoother, like a formula error" + "extend to 1997." **Grounded — and the premise needs a correction:
> there is NO gov-specific formula bug. gov and dia use byte-identical returns formulas, and BOTH are
> double-smoothed.** The fix is to remove the redundant moving average (same family as T3/T3b) on both, and
> extend the gov history. gov `scknotsqkcheojiaewwh`, dia `zqzrriwuavgrquhisnoa`. View-only (Unit 1) +
> a shared materialized-table window change (Unit 2). Reversible. No domain-row writes. ≤12 api/*.js.

## Receipts (grounded live 2026-06-25)
`cm_gov_returns_indexes_m` and `cm_dialysis_returns_indexes_m` have the **same** structure: a cash-return
blend `0.5·avg_cap_rate_ttm + 0.25·lower_quartile_cap_ttm + 0.25·upper_quartile_cap_ttm` (the inputs are
**TTM = trailing-12-month** cap-rate averages — already a smoother), gated `n≥4` trailing-year sales, THEN a
**7-month centered moving average** on the final SELECT:
```sql
round(avg(cash_return)         OVER w, 5),
round(avg(leveraged_return_mid) OVER w, 5)
WINDOW w AS (PARTITION BY subspecialty ORDER BY period_end ROWS BETWEEN 3 PRECEDING AND 3 FOLLOWING)
```
That's TTM **plus** a 7-mo MA = double-smoothing. Month-over-month volatility, raw (pre-MA) vs smoothed:

| | raw MoM | smoothed MoM | MA strips | smoothed range |
| --- | --- | --- | --- | --- |
| **gov** | 12.47 bps | 4.53 bps | ~64% | 6.90–8.96% |
| **dia** | 15.27 bps | 5.58 bps | ~63% | 5.84–8.07% |

So the MA removes ~⅔ of the real movement on **both**. The residual gov<dia (12.47 vs 15.27 raw) is **genuine
market** — gov/GSA net-lease cap rates are ~22% less volatile than dialysis — NOT a formula difference. gov
returns runs **2001-01 → 2026-03**, capped by the master table start (`cm_gov_market_quarterly_master_m_mat`
also starts 2001-01), NOT by data: capped sales exist back to 1970, with **60 in 1997-2000** (~15/yr, thin).

## Unit 1 (the de-smooth — the "too smooth / formula" fix)
Remove the 7-month `OVER w` MA from **`cm_gov_returns_indexes_m`** and **`_q`**: select the gated TTM blend
(`cash_return`, `leveraged_return_mid`) **directly**, drop the `WINDOW w` clause — mirroring the T3/T3b
de-smooth. Keep the TTM blend, the **n≥4 density gate**, and the cash/leveraged formula exactly.
- **Apply the SAME de-smooth to dia** `cm_dialysis_returns_indexes_m` / `_q` (they carry the identical
  redundant MA; T3/T3b de-smoothed the dia cap-by-term but not the returns index). **Why both:** de-smoothing
  only gov would invert the picture (gov choppier than a still-smoothed dia). De-smoothing both restores real
  movement to each and keeps them comparable; gov stays genuinely smoother (the real market difference).
  **(Decision for Scott: if he wants gov-only, do gov and skip the dia change — but then the two charts are
  on different smoothing bases. Recommended: both.)**
- **Expect choppier lines — that's the point** (gov ≈12 bps/mo, dia ≈15 bps/mo, matching the PDF/Excel's
  movement). The n≥4 gate is the honesty floor; do NOT re-introduce any moving average to smooth it back.

## Unit 2 — DEFERRED (Scott's call, 2026-06-25): ship Unit 1 now; do the 1997 extension separately
Scott chose to ship the de-smooth (Unit 1, the actual "too smooth" fix) now and handle the 1997 extension as
a separate, carefully-audited change later (it widens the SHARED master mat — too broad to bundle with the
view-only de-smooth). **Do NOT extend the history in this change.** The detail below is retained for the
deferred follow-up.

<details><summary>Deferred — extend the gov history to ~1997 (do later)</summary>

The gov returns index starts 2001-01 only because `cm_gov_market_quarterly_master_m_mat` does. Extend that
**materialized** table's period window back to **1997-01** (find its `generate_series` / window start; change
it and refresh the matview), so the returns index inherits the longer history.
- **CAVEAT — thin early data:** 1997-2000 has ~60 capped gov sales (~15/yr). With the **n≥4 trailing-year
  gate**, the sparsest early months will GAP (NULL), and the populated early months are **indicative** (small
  samples). That's honest — do not lower the n≥4 gate to force a continuous early line. Annotate the early
  span as indicative if the chart doesn't already carry a pre-data floor note.
- **SHARED-TABLE CARE:** `cm_gov_market_quarterly_master_m_mat` feeds MANY gov CM charts (cap rates, returns,
  etc.). Extending its window exposes 1997-2000 to all of them. **Audit every consumer** — confirm each
  either already has its own display floor (so it won't suddenly show thin 1997-2000 points) or renders the
  sparse early points gap-honestly. **Report the full consumer list + what each does at 1997-2000** before
  finalizing; do not let the extension surface thin early points on a chart that shouldn't show them.
- If extending the shared mat is too broad a blast radius, the fallback is a returns-index-specific earlier
  window (compute the returns blend from `sales_transactions` back to 1997 without widening the shared mat) —
  assess and report which approach is cleaner.

</details>

## Gate (verify live, both DBs) — Unit 1 only
- gov + dia `returns_indexes_m`/`_q` no longer apply the 7-mo MA; output == the gated TTM blend. MoM
  volatility ≈ raw (gov ≈12.47, dia ≈15.27 bps) — spot-check a few months: rendered value == raw gated blend.
- n≥4 gaps preserved; the cash/leveraged blend + TTM window unchanged; gov stays smoother than dia (market).
- The history window is UNCHANGED (still 2001-01 → 2026-03); the 1997 extension is deferred (do not touch the
  shared mat in this change).
- Reversible (restore the `OVER w` MA). No domain-row writes. ≤12 api/*.js.

## Boundaries / scope
- Returns index only — do NOT touch the valuation index (`cm_*_valuation_index_*`, separate charts) or the
  cap-rate basis. Keep the n≥4 gate and the cash/leveraged blend formula; the ONLY changes are (1) removing
  the redundant MA and (2) extending the history window.
- No new date/cap fabrication — the early years are real-but-thin and must gap honestly, not be smoothed or
  back-filled. The residual gov<dia smoothness is genuine market and must NOT be "corrected" to match dia.
