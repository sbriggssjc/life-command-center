# CM Round 73 — Layer A: cap-by-term cohort consistency (receipts + verdict)

**Date:** 2026-06-08 · **Author:** Claude Code (branch `claude/focused-shannon-xrbpM`)
**Scope of this session:** Layer A headline (cohort lines "illogically passing
one another"). Settles Scott's central question with receipts and ships the one
fully-validated, correctly-routed fix (gov #14). Remaining Layer A charts and
Layers B–D are scoped for follow-up at the bottom.

---

## TL;DR verdict

> **"Is the crossing a data/formula gap, or genuine?"** — Both, and the receipts
> separate them cleanly:
>
> - **The historical crossings are ARTIFACTS** of thin per-cohort n + too-short
>   a TTM pool. They disappear under wider pooling + the existing sample gate.
> - **The recent (2024–2026) gov inversion is GENUINE** — it survives a 2-year
>   pool and an n≥5 gate, so it is real post-2023 repricing, not noise.
>
> Fix shipped: gov `cm_gov_cap_by_term_m` TTM window **1yr → 2yr** (live). The
> gov cohort fan is now ordered/parallel 2018Q1–2023Q4 (was 6 cross quarters),
> the 2026-03 thin-n spike is gone (8.30%→7.49%), and the genuine 2024+
> inversion is isolated and shown honestly.

---

## How the charts are actually wired (verified, important for routing)

| Chart (note #) | Source the EXPORT renders | Already gated/smoothed? |
|---|---|---|
| **gov #14** Cap by Remaining Lease Term | **`cm_gov_cap_by_term_m`** (live `cm_chart_catalog.view_name_template`; the JSON catalog file saying `_q` is **stale**) | n≥5 + ±3mo smoothing — but 1yr TTM (the gap) |
| dia #10 Closed-Sales-by-Term dot | `cm_dialysis_sold_cap_by_term_dot` → master_m `cap_*_year` | n≥3 + 9-month centered smoothing (Round 66x) |
| dia #5 / #11 Asking Cap by term/buckets | **available_listings**-based asking views (NOT investigated this session) | — |
| gov #22 Seller Sentiment 10+ cohort | `cm_gov_seller_sentiment_m` | separate view; relabel ask (not done) |
| gov #25 Closed-Sales-by-Term | gov closed/dot | — |

Key consequence: **editing `cm_gov_cap_by_term_q` would NOT have fixed the gov
chart** — the live catalog serves `_m`. The fix targets `_m` (and aligns `_q`
so they can't diverge — the Round 66x three-source-divergence lesson).

---

## Receipts — gov #14 (`sales_transactions`, firm-term-REMAINING cohorts)

### Raw 1-year-TTM per-cohort n by quarter (why it crosses)
The term premium (>10yr = lowest cap) holds with **healthy n through 2022**, then
the cohort n **collapses** and the lines cross. n is the story:

| qend | n(10+) | n(6-10) | n(<5) | note |
|---|---|---|---|---|
| 2016-03 | 58 | 51 | 69 | healthy; 6-10 already runs high (genuine, see below) |
| 2021-12 | 41 | 46 | 88 | healthy; clean premium |
| 2023-12 | 14 | 23 | 42 | thinning |
| 2024-12 | **9** | 28 | 28 | thin |
| 2025-12 | **6** | **7** | 19 | very thin |
| 2026-03 | **6** | **3** | 14 | n=3 → 6-10 prints **8.30%** (pure artifact) |

The n≥5 gate already on `_m` isn't enough on a 1yr pool because n hovers at the
gate (5–9) in the tail, so gated values are still single-outlier-driven.

### BEFORE — live `cm_gov_cap_by_term_m` (1yr TTM, n≥5, ±3mo smoothing)
6 illogical cross-quarters in the "should be clean" region, plus the tail spike:

| qend | 10+ | 6-10 | <5 | status |
|---|---|---|---|---|
| 2018-06 | 6.42 | 7.03 | 6.94 | **CROSS** (6-10 > <5) |
| 2018-09 | 6.49 | 7.06 | 6.93 | **CROSS** |
| 2018-12 | 6.55 | 7.05 | 6.96 | **CROSS** |
| 2023-06 | 6.49 | 6.44 | 6.74 | **CROSS** (10+ > 6-10) |
| 2023-09 | 6.74 | 6.56 | 6.77 | **CROSS** |
| 2023-12 | 6.91 | 6.66 | 6.76 | **CROSS** |
| 2026-03 | 6.77 | **8.30** | 7.26 | **CROSS** (thin-n=3 spike) |

### AFTER — `cm_gov_cap_by_term_m` (2yr TTM, n≥5, ±3mo smoothing) — APPLIED LIVE
**2018Q1–2023Q4 = 24 consecutive ordered quarters, 0 crossings.** Tail spike gone.

| qend | 10+ | 6-10 | <5 | status |
|---|---|---|---|---|
| 2018-06 | 6.47 | 6.96 | 7.07 | ordered ✅ |
| 2018-12 | 6.48 | 6.99 | 7.00 | ordered ✅ |
| 2023-06 | 6.24 | 6.55 | 6.81 | ordered ✅ |
| 2023-12 | 6.45 | 6.50 | 6.73 | ordered ✅ |
| 2024-03 | 6.59 | 6.55 | 6.72 | cross (genuine, onset) |
| 2025-12 | 6.96 | 7.46 | 6.93 | cross (genuine) |
| 2026-03 | 6.93 | **7.49** | 6.94 | cross (genuine; was 8.30) |

Net at quarter-ends 2018–2023: **6 cross → 0**. 2026-03 6-10yr: **8.30 → 7.49**.

### The genuine 2024–2026 inversion (survives aggressive pooling)
Re-pooled at 2yr + n≥5 + 3Q smoothing, the >10yr cohort cap rises **above** the
shorter cohorts from 2024 on and **stays** inverted — n10 is ~14–16 over the 2yr
window, so this is not thin-n. Economic read: post-2023, long-duration federal
leases repriced wider (rate environment + DOGE/agency-footprint risk on long
commitments), while short-term (<5yr) deals got bid for renewal/value-add upside.
**This is real and should be shown, not smoothed away** — it is the honest answer
to "is the premium gap a data gap?": no, the recent gap genuinely inverted.

---

## Receipts — dia closed-sales cohorts (already addressed by Round 66x)

dia's deck cohorts (12+/8-12/6-8/≤5) already route through the **canonical**
`cm_dialysis_sold_cap_by_term_dot` with an n≥3 gate + **9-month** centered
smoothing (Round 66x). I re-ran dia under the same proposed spec used for gov
(2yr TTM + n≥5 + 3Q) on the legacy 3-cohort line as a cross-check:

- **2019Q2–2026Q1: fully ordered fan** (10+ < 6-10 < <5), premium widening sensibly.
- Only residual: a 4-quarter hair-weave in 2018 between the two *short* cohorts
  (3–8 bps; the long-term premium is intact throughout) — genuine, not noise.

So dia is **not** a crossing bug. Round 66x already documented the real dia
residual: the *fan compresses* to ~65 bps vs the deck's ~140 bps because
`cap_rate_final` prefers broker-stated (stabilized) caps that understate
short-term going-in yield. Closing that fan is gated on the **separate Phase-1
rent_at_sale reconciliation** (so `noi_derived` can be promoted for short-term
deals), per `docs/capital-markets/CLAUDE_CODE_PROMPT_dia_data_integrity_MASTER.md`.
**Recommendation: do NOT re-smooth dia this round** — it's already gated/smoothed;
the lever is the Phase-1 rent work, not more pooling.

---

## What shipped this session

- **Live (gov DB `scknotsqkcheojiaewwh`):** `cm_gov_cap_by_term_m` + `_q` TTM
  1yr→2yr (and `_q` gate 3→5). Migration tracked at
  `supabase/migrations/20260715_cm_round73_a_gov_cap_by_term_2yr_ttm.sql`.
  No JS/Railway deploy required — the chart reads the view per request.
- This receipts doc.

## Scoped follow-ups (NOT done this session)

- **gov #22** seller_sentiment: confirm the cohort is **6+yr** (R70 A1 "core")
  and fix the LABELS (`cm_gov_seller_sentiment_m` currently splits "all" vs a
  "long_term" cohort — verify the threshold and relabel).
- **dia #5 / #11** Asking Cap by term / buckets: listings-based asking views,
  not yet investigated — apply the same gate+pool discipline if they cross.
- **dia #10 / gov #25** dot charts: individual-sale scatters; verify both read
  the canonical gated dot series (dia does post-66x).
- The stale **`public/reports/cm_chart_catalog.json`** should be re-exported
  from the live `cm_chart_catalog` (it still lists `_q` for cap_rate_by_lease_term).
- **Layers B (data/logic bugs), C (chart design), D (x-axis reach)** — untouched;
  each is its own session per the Round 73 prompt ("A alone is a full session").
