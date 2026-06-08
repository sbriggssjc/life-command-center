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

---

## Layer A completion — the other five charts (session 2, 2026-06-08)

Finished the full Layer A theme so the next export doesn't read "fixed on one of
six." Each applied live + verified before/after; sold-side kept separate from the
asking-side pool throughout (per directive).

### #11 dia Asking Cap Ranges by Term Buckets — `cm_dialysis_asking_cap_by_term_m`
Same disease as #14 (1yr TTM + n≥3); the sparse **6-8yr** asking cohort sat at
n=4–17 in 2020 and spiked to 7.6–7.8%. **Fix:** TTM 1yr→2yr, gate 3→5. 2019 and
2023–2026 order cleanly. The residual **2020–2022 6-8 elevation survives 2yr
pooling at n=26–105 → genuine** asking-side behavior (asking caps are broker
theater, don't obey the term premium), documented not smoothed away.
*Asking-only view; the sold dot is untouched.*

### #5 dia Asking Cap Quartiles — Active Listings — `cm_dialysis_asking_cap_quartiles_active_m`
Was **point-in-time, no TTM**: core-10+ band rode n_core=**2–8** listings/month
(quartiles of 2–4 points = noise); total upper-Q spiked when n_total fell to
12–17. **Fix:** pool quartiles over a trailing 2yr window → n_total 317–1249,
n_core 108–212; bands stable, core sits cleanly inside/below total. *Caveat:
quartile-over-listing-months weights by time-on-market — an honest reading of
"asking caps visible over the window"; documented.*

### #22 gov Seller Sentiment — `cm_gov_seller_sentiment_m` + labels
Cohort was 10+yr ("long-term"); R70 A1 deliberately left it there, **Scott now
overrides** → gov 6+yr **core**. **Fix:** threshold 10→6 (column names kept).
The 10+ cohort was near-empty in the tail (R70 A1: n=0–2 in 2024–25); **6+ carries
n=5–17** and the long-term sentiment line now renders where it was NULL —
resolving the "missing data" half too. **Labels made vertical-aware** (gov "6+
yr" / dia "10+ yr", which also corrects a stale "8+ Yr" mislabel in the PNG
renderer) in `cm-excel-export.js` (data-sheet headers → injector series titles)
and `cm-chart-image-renderer.js` (PDF). dia's cohort is unchanged (stays 10+).

### #25 gov Closed-Sales-by-Term dot — `cm_gov_sold_cap_by_term_dot`
The "_dot" view emits per-period cohort AVERAGES — the SAME closed-sales cohort
as #14, just markers — and carried the identical 1yr-TTM + n≥3 bug. **Same fix**
(TTM 1yr→2yr, gate 3→5) so the line (#14) and its dot twin can't disagree.
Result mirrors #14: ordered 2018–2023, genuine 2024+ inversion.

### #10 dia Closed-Sales-by-Term dot — `cm_dialysis_sold_cap_by_term_dot` — NO CHANGE
Cross-check only: this IS the canonical Round-66x sold series (cap_rate_final,
n≥3, 9-month smoothing). **Left untouched per directive** — sold-side stays
separate from the asking-side 2yr pool; its residual is the documented Phase-1
broker-cap structural item, not a crossing bug.

### Catalog drift fix
Reconciled `public/reports/cm_chart_catalog.json` `view_name` fields to the live
`cm_chart_catalog` table — **9 of 25** were stale (incl. cap_rate_by_lease_term
`_q`→`_m`, plus volume/count/cap-ttm/quartile/avg-deal/nm-vs-market/macro). The
JSON is documentation-only (runtime reads the table), but the drift could have
misled a future round into editing the wrong object.

---

## What shipped (both sessions)

**Live DB views (no Railway deploy needed — read per request):**
| # | View | DB | Change |
|---|---|---|---|
| 14 | `cm_gov_cap_by_term_m` (+`_q`) | gov | TTM 1yr→2yr, gate 3→5 |
| 25 | `cm_gov_sold_cap_by_term_dot` | gov | TTM 1yr→2yr, gate 3→5 |
| 22 | `cm_gov_seller_sentiment_m` | gov | cohort 10+→6+ core |
| 11 | `cm_dialysis_asking_cap_by_term_m` | dia | TTM 1yr→2yr, gate 3→5 |
| 5 | `cm_dialysis_asking_cap_quartiles_active_m` | dia | 2yr quartile pool |
| 10 | `cm_dialysis_sold_cap_by_term_dot` | dia | **unchanged** (canonical 66x) |

Migrations tracked at `supabase/migrations/20260715_cm_round73_a_*.sql`.

**JS (ships on Railway redeploy of merged `main`):** vertical-aware seller-sentiment
labels in `api/_shared/cm-excel-export.js` + `api/_shared/cm-chart-image-renderer.js`
(`node --check` clean). The DB cohort change (#22) is live now; the label text
updates land with the deploy — graceful, deploy-order safe.

**Docs:** this receipts file; `public/reports/cm_chart_catalog.json` drift fix.

## Honest residuals (genuine, documented — not bugs)
- gov #14/#25: 2024–2026 term-premium **inversion** is real post-2023 repricing.
- dia #11: 2020–2022 **6-8 elevation** is genuine asking-side broker-theater.
- dia #5: quartiles pool over listing-months (time-on-market weighting).
- dia sold fan compression (#10): the Phase-1 rent_at_sale item (unchanged here).

## Still open (next sessions, per the Round 73 prompt)
- **Layer B** (data/logic bugs — #9 active-universe over-count, #20 NM-vs-Market,
  #8/#24 on-market storage, #13 credit tier, #21/#1), **Layer C** (chart design —
  #17/#18/#23/#26), **Layer D** (x-axis reach). Each is its own session.
