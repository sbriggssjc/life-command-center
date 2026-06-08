# CM Round 73 — Layer B: data/logic bugs (receipts)

**Date:** 2026-06-08 · branch `claude/focused-shannon-xrbpM` · PR #1102
Leading with #9 and #20 per Scott's sequencing. Each fix decision routes through
the gate before applying (and, for bulk writes, dry-run → gate → commit).

---

## #9 dia Market Turnover — active-universe over-count ✅ SHIPPED (view live)

**Diagnosis (confirmed, Scott's receipt):** 2024-Q3 counted 312 active (grew from
the 256 in Scott's snapshot as new listings imported) = 249 organic + **63
synthetic**; only **126** organic carried a NULL off-market date. Two inflators:
1. `synthetic_from_sale` rows (sold deals back-cast as listings) counted active
   while "in flight" to their sale — not tracked-available inventory.
2. Organic listings with no off-market date stayed active for up to **1095 days
   (3yr)**. Real dia DOM: **median 196d, p90 453d** (88% close ≤365d, 92% ≤540d),
   so a listing with no recorded close after a year is almost always a *missed
   off-market event* (stale data), not live 1.5–3yr-old inventory.

**Fix (gated 2026-06-08 → 540d):** exclude synthetics from the point-in-time
active count (kept in the historical added-to-market series); `off_market_date`
always wins (no age cap when a real end date exists); the **540-day** cap is a
backstop governing **only** the null-end organic tail. Scott chose 540 over 365
to keep the legitimate 4–8% long-on-market tail that p90 implies. The
availability-checker increasingly stamps real off-market dates, so the
assumed-active residual shrinks over time.

**Implementation note:** `is_syn` must `COALESCE(... , false)` — organic rows have
`data_source IS NULL`, so `NOT (data_source='synthetic_from_sale')` is NULL and
silently zeroed `active_count` on the first apply. Fixed.

**Landed (before → after):**
| quarter | active | turnover | months-of-supply |
|---|---|---|---|
| 2023-03 | 266 → 185 | 0.49 → 0.58 | 12.4 → 8.6 |
| 2024-03 | 206 → 188 | 0.46 → 0.48 | 14.0 → 12.7 |
| 2024-09 | 312 → 239 | 0.26 → 0.31 | 34.3 → 26.3 |
| 2025-06 | 322 → 193 | 0.33 → 0.45 | 24.8 → 14.8 |
| 2026-03 | 265 → 166 | 0.42 → 0.53 | 16.9 → 10.6 |

Turnover ratio rises sensibly (denominator shrank), months-of-supply no longer
spikes to an unrealistic 34. **Honest note:** the recent-quarter count lands ~166
(latest), above the ~130 Scott referenced, because (a) 540 was chosen over the
365 that hit ~130, and (b) the *point-in-time historical* count correctly counts
listings active then that have since closed (real end dates) — the 126 was only
the "still-open-today" subset. The 2025-H2 residual (active 273/307) is the
**separate #8/#24 over-stamping item**, not this fix.

Migration: `supabase/migrations/20260715_cm_round73_b_dia_market_turnover_active_universe.sql`.

---

## #20 gov NM-vs-Market — is_northmarq contamination ✅ FLAG FIXED · ⚠️ spread is a cap-basis follow-up

**Premise was inverted; root cause was a data bug (the flag), not the chart
method.** The view showed NM cap **ABOVE** non-NM market for ~90% of the series
(2019–22 NM ~7.0–7.3% vs market ~6.6–6.9%), labels correct, method sound.

**Root cause (Scott-confirmed):** `is_northmarq` contaminated by the loose R23
broker-string backfill — 169 flagged, NM cohort averaged 7.92% vs the deck's
real NM 6.78%. Rule: NM iff the **LISTING** broker is SJC ("SJC; Briggs/…") or
Northmarq. Source: master `L. BROKER` (`staging.gov_master_sold`, 116 NM-listed).

**Shipped (gated, live):**
- **Flag re-derivation** (`…_gov_is_northmarq_rederive.sql`): **169 → 66**.
  96 removed = **92 with no NM broker at all** + **4 NM-as-buyer**; **0 false
  drops**. Clean NM 2024-Q2 (1yr TTM) = **6.79%** (deck 6.78%). ✓
- **View window** (`…_gov_nm_vs_market_2yr_window.sql`): 2yr TTM both lines,
  n≥3, smoothing ±4mo→±2mo (keeps the thin clean NM line continuous).

**The spread did NOT flip to the deck's ~50–72bps — and it's the MARKET line,
not the flag.** Reconciled to the view's exact `NOT is_nm AND brokered`: it
computes **6.87%** at 2024-Q2 (1yr; banded/unbanded/all-deals all ≈ 6.87%, only
raw-incl-implausible reaches 7.33%) — **not** the 7.50% in Scott's receipt. So
the deck's wide spread depends on the deck's **cap-rate basis (master-curated
caps)**, which our transaction `sold_cap_rate` doesn't reproduce. On 1yr, clean
NM (6.79%) is ~8bps below market (6.87%); the 2yr window keeps NM continuous but
its lagging 2yr market avg reads NM slightly *above* in recent quarters.

**dia parallel — DRY-RUN ONLY, held (does not reproduce the deck):** master NM
= **184** (Scott's 183 ✓; `staging.dia_master_sales` listing_broker; the
referenced `scripts/dia_master_nm_listings.json` does not exist in the repo).
Re-derivation → **128** (not ~185); clean dia NM 2024-Q2 = **7.29%** (deck 6.38%)
and sits **above** our market (6.76%) — wrong direction. dia's cap-rate basis
diverges from the deck even more than gov's. **Not committed** — awaiting Scott
on the cap-basis question.

**Open question for Scott (back through the gate):** the flag cleaning is done
and correct, but the NM-below-market value-prop spread needs the cap-rate basis
addressed (repoint the chart to master-curated NM/market caps?), OR a decision
on the gov view window (1yr = NM below but blanks recently / 2yr = continuous but
NM-above). The flag fix stands regardless; dia flag commit is held.

---

## Still open in Layer B (later sessions)
#8/#24 on-market 2025+ over-stamping verification, #13 gov credit-tier render,
#21 rent-growth, #1 dia bid-ask legend dedup. Layers C/D unchanged.
