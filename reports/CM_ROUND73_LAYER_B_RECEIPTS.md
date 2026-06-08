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

## #20 gov NM-vs-Market — is_northmarq contamination 🔄 IN PROGRESS (dry-run → gate)

**The premise was inverted, and the root cause is a data bug, not the chart
method.** Receipt: the view shows NM cap **ABOVE** non-NM market for ~90% of the
series (2019–22 NM ~7.0–7.3% vs market ~6.6–6.9%), labels correct, method sound.

**Root cause (Scott-confirmed):** `is_northmarq` is contaminated by the loose R23
broker-string backfill + 20 mis-flagged 7d rows, so the NM cohort averages
~7.92% vs the deck's real NM 6.78% (~57bps *below* non-NM). Authoritative rule:
a gov sale is Northmarq iff its **LISTING** broker is Stan Johnson Company
("SJC") or Northmarq (Team Briggs + individuals sit under the SJC prefix). Source
of truth: master Sold sheet **L. BROKER** column (`staging.gov_master_sold`,
116 NM-listed deals).

**Plan (dry-run → Scott's gate → commit; flag column only, no price/term):**
1. For gov sales matched to a master row, set `is_northmarq` from master
   `L. BROKER ~ '^(SJC|Stan Johnson|Northmarq)'`; unmatched sales fall back to
   our own `listing_broker` on the same pattern (NOT purchasing broker, NOT a
   generic contains).
2. Audit the current 141 flags — report which lose the flag (competitor-listed
   contaminants) and which are added.
3. Recompute `cm_gov_nm_vs_market_m`; verify NM lands near the deck's 6.78% /
   ~40–57bps below non-NM at 2024-Q2.
4. Confirm the chart now shows the NM line below market; provenance-tag the
   re-derivation.

---

## Still open in Layer B (later sessions)
#8/#24 on-market 2025+ over-stamping verification, #13 gov credit-tier render,
#21 rent-growth, #1 dia bid-ask legend dedup. Layers C/D unchanged.
