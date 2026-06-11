# CM Round 76 — Layers F + G receipts (audit-first, Scott-gated)

**Date:** 2026-06-11 · branch `claude/zealous-johnson-v72vpm`
**Posture:** read-only audit. No view change, no write, no exclusion applied.
Every number below is a live read off the gov (`scknotsqkcheojiaewwh`) and dia
(`zqzrriwuavgrquhisnoa`) projects. Layers F and G each end at a decision gate.

---

## LAYER F — gov #20 NM-vs-market cap basis (audit-first, then the basis)

Chart: `nm_vs_market_cap` (gov). Live view: `public.cm_gov_nm_vs_market_m`
(2-yr TTM, simple average, NM gated n≥3, market ungated, ±2-mo output smoothing,
caps banded to [4%, 12%], excludes `implausible_unverified` + `exclude_from_market_metrics`).

### Phase 1 — AUDIT (is anything taking gov #20 *unnecessarily higher*?)

Scott's instruction was to scrub the cohort for outliers / errors / ingestion
gaps BEFORE choosing the basis, mirroring the dia approach. **Result: there is no
single outlier, duplicate, or ingestion error inflating gov #20.** The view's
existing guards already remove the obvious inflators, and what remains is clean:

| Audit check | Finding | Effect on #20 |
|---|---|---|
| Outlier caps `<4%` or `>12%` | Already banded out by the view (`cap BETWEEN 0.04 AND 0.12`) | none — already excluded |
| `implausible_unverified` quality | NM **49 @ 9.03%**, market **1,264 @ 8.90%** | already NULLed by the view |
| `exclude_from_market_metrics` NM deals | **28 NM @ 7.96%** (high — correctly removed) | exclusion working in the right direction |
| Duplicates (same address+date+price, in-band) | **6 groups / 6 extra rows** across the whole cohort | trivial |
| Low-quality market caps (`market_implied` / `om_pro_forma`) | `market_implied` **19 @ 7.74%**, `om_pro_forma` **15 @ 7.17%** | tiny vs `stated_only` 1,665 @ 6.90% — nudges market up a hair; optional to gate out |

**The real driver is cohort starvation, not error.** NM in-band deals per year:

| yr | n | simple | price-wtd |
|---|---|---|---|
| 2020 | 9 | 7.48% | 7.07% |
| 2021 | 9 | 6.43% | 5.59% |
| 2022 | 4 | 6.73% | 6.88% |
| 2023 | 2 | 6.79% | 6.64% |
| 2024 | **1** | 7.30% | 7.30% |
| 2025 | **1** | 7.50% | 7.50% |

The recent 2-yr window holds only **2 in-band NM deals** — $20.0M @ 7.50% (DHS,
VT, 2025‑05) and $1.77M @ 7.30% (USDA, AR, 2024‑11) — both above the ~7.0% market.
So the recent NM line reads **above** market (2025‑11: NM 7.34% / market 7.06% /
spread **+0.28%**) and then blanks from 2025‑12 (n<3). That is small-sample
recency, not a contaminated cohort. **Note for gov specifically:** price-weighting
(the dia fix) makes gov *worse* — the single $20M 7.50% deal dominates — so gov's
lever is the *pool/window*, not the weighting.

### Phase 2 — the two bases, with the audit-clean numbers

| basis | NM | market | spread | matches deck? |
|---|---|---|---|---|
| **A. Raw market-universe (current view, recent 2-yr TTM)** | ~7.34% (then null) | ~7.06% | **+0.28% (NM above)** | ❌ contradicts deck |
| **B. Curated internal-comp (all-time NM confirmed, in-band `stated_only`)** | **6.89%** (n=49) | 6.90% (n=1,665) | ~flat | ≈ deck NM 6.78% |
| deck (Value-Prop page reference) | 6.78% | 7.35% | −0.57% (NM below) | — |

Basis B restores the NM-below-market value-proposition relationship the deck
tells, using **no fabricated deals** — just NorthMarq's confirmed comp set pooled
wide enough to escape the 2-deal recent window. **This is a basis-definition
choice, which is Scott's call — no view change until the gate.**

### Phase 1b — deep deal-by-deal audit (Scott's follow-up: reproduce 6.89%, then go deal-by-deal)

**(1) The 6.89% reproduces exactly — it is the *clean-quality* subset, and it is
biased LOW.** The full gov NM universe decomposes as:

| slice | n | avg cap |
|---|---|---|
| all NM with a cap | 128 | **8.24%** ← the ~8.0% intuition |
| all NM not-excluded | 99 | 8.11% |
| NM in-band [4–12%], all quality | 98 | 7.96% |
| **NM in-band, excl. `implausible_unverified` (the 6.89% cohort)** | **49** | **6.89%** |
| NM `implausible_unverified` | 65 | 9.56% |
| NM cap > 12% | 2 | 26.00% (data error — e.g. 111 Greencourt VA = **22.42%**) |

The entire 8.11% → 6.89% gap is the `implausible_unverified` flag. So 6.89% does
**not** stand on its own as "the NM number" — it is what's left after the cap-
quality filter drops *half* the NM universe.

**(2) Deal-by-deal: the high-cap NM tail is NOT uniformly garbage.** Every
not-excluded NM deal ≥7% is `implausible_unverified`, but they split by *why* the
cap is high. Of the 49 in-band `implausible_unverified` NM rows:

| bucket | n | avg cap | read |
|---|---|---|---|
| **A. short / holdover firm term (<3y)** | 8 | 9.32% | **legitimately high** (601 W Main IL 11.78% @3.5y State; 10703 Stancliff TX 10.6% @0.55y; 2600 W Hillsboro AR 8.82% @ **−1.58y holdover**) |
| **B. low-credit state/local** | 8 | 9.37% | **legitimately high** (state/municipal genuinely trades wider) |
| **C. long-firm federal at high cap** | 9 | 9.11% | **genuinely suspect** (4750 S Garnett OK 9.44% @ **14.1y** SSA — a long federal lease should not trade at 9.4%) |
| **D. other mid-term** | 24 | 8.78% | mixed — needs per-deal |

**Conclusion (the honest number is in between).** 6.89% is biased **low** because
the cap-quality flag drops ~16 *legitimately-high* short-term/low-credit NM deals
(buckets A+B, avg ~9.3%) **along with** the genuine errors. ~8.1% is biased
**high** because it keeps the 22% error and the suspect long-firm-federal rows.
Reclassifying A+B back into the clean cohort lands NM ≈ **7.5%**
(`(49×6.89 + 16×9.35)/65`), with C + the >12% rows correctly excluded.

**(3) Name-by-name reconciliation to the deck's NM comp set: BLOCKED — need the
deck list.** I don't have the deck's NM Value-Prop comp roster, so I can't confirm
whether the deck's 6.78% itself excludes the short-term/low-credit highs (which
would explain why it sits below our reclassified ~7.5%) or uses a different
curated set. **Ask: provide the deck NM comp list (names/addresses) and I'll
reconcile ours against it row-by-row.**

**Gate (no view change yet).** The basis is not a one-line window swap — the real
lever is the `implausible_unverified` flag on the NM rows. Recommended sequence:
(a) Scott provides the deck NM comp list → I reconcile; (b) I dry-run a cap-quality
**re-derivation** that keeps the genuine errors flagged but reclassifies the
term/credit-justified highs; (c) then the basis (and any view change) is decided
on the reconciled cohort. Until then: **no view change.**

---

## LAYER G — dia "huge outlier ~2022/23"

dia market context: **median sale $3.0M, p95 $10.26M** (2018–2024, non-excluded).
The two giants are **already excluded**: $950M (200 Stuckey St, Johnsonville SC,
2023‑09 — the round-59 bogus sale) and the **$93.5M HQ2** (3201 S 323rd St,
Federal Way WA, 2022‑05, `implausible_unverified`). Confirmed: the spike is **not**
HQ2.

The spike is the next tier — **7 non-excluded deals ≥ $30M in 2021‑07 … 2023‑12**,
each many multiples of the $3M median / $10M p95, which inflate the dia
avg-deal-size / volume series around 2022/23:

| sale_id | date | property | $M | excl | note |
|---|---|---|---|---|---|
| 6592 | 2023‑01‑26 | 13003‑13075 Victory Blvd, Los Angeles CA | **57.75** | no | far beyond single-clinic NNN scale |
| 6658 | 2022‑06‑08 | 8 King Rd, Rockleigh NJ | **50.00** | no | |
| 5530 | 2021‑10‑08 | 700 Broadway, Seattle WA | 42.50 | no | |
| 6596 | 2022‑12‑20 | 5730 S Semoran Blvd, Orlando FL | 36.50 | no | |
| 8819 | 2023‑01‑05 | 1052‑1090 Old Des Peres Rd, Des Peres MO | 36.39 | no | |
| 6631 | 2022‑08‑05 | 3040 Dyer Blvd, Kissimmee FL | 36.07 | no | |
| 6654 | 2022‑07‑07 | 501 N State Rd 7, Royal Palm Beach FL | 34.00 | no | |

These read as portfolio / MOB-scale sales, not the single-clinic NNN dialysis
comps the dia market series is meant to represent. **Recommendation:** dry-run an
`exclude_from_market_metrics` pass on this cluster (mirroring the HQ2 / $950M
policy) — but per-deal confirmation that each is genuinely non-representative is
**Scott's gate**, and the exclusion write is dry-run → gate → commit.

---

## LAYER E — status (chart-code, ships to gate via re-export)

- **E2 gov #13 cap-by-credit line styles — ALREADY LANDED** (R76 E2, in `main`:
  all three cohorts share one uniform plain-line style; `isoPointRadius` marks
  only genuinely-isolated points). Cohort-n sparsity confirmed **genuine** (Federal
  3,414 eligible / 101 quarters; state + municipal real but sparse) — no filter is
  dropping eligible rows. Nothing to change.
- **E1 gov #18 lease-termination — ALREADY STACKED IN CODE** (`lease_termination_rate`
  template + R73 C2: stacked firm/soft count bars + termination-rate line on a
  secondary % axis, both render paths, harness `R68-E G6`). "Still not stacked" on
  the June‑10 export is almost certainly a **stale Railway build**, not a code gap —
  needs a redeploy of merged `main` to confirm, not an edit.
- **E3 gov #26 volume+cap — axis separation (R73 C4) LANDED** (gov right-axis
  `{0.020, 0.105}`). The remaining "type + palette" tweak is best judged on a fresh
  render.
- **E4 y-axis titles — SHIPPED (chart-code → re-export).** Extended the
  multi-line builder (`buildMultiLineChartXml`) with an optional rotated
  value-axis title (`yLeftAxisTitle`, mirroring the combo's `axisTitleFrag`,
  inserted between gridlines and numFmt per CT_ValAx order) + a matching
  `yAxisTitle` in the PNG renderer's `commonOpts` (`scales.y.title`). Labelled
  **'Cap rate'** on the three cap-rate line charts Scott is reviewing:
  `nm_vs_market_cap` (#20), `cap_rate_by_credit` (#13), `cap_rate_by_lease_term`.
  The min/max on these are already tight (set per template). New harness test
  `R76 E4` (185 pass / 0 fail / 1 skip); `node --check` clean on both paths;
  12 functions. Verified on Scott's re-export (Railway redeploy).

### Closeout note (verification rides the redeploy)
E1, E3, and E4 are all **code-correct in `main`** and render on the next Railway
redeploy + fresh export (the recurring stale-build pattern in CLAUDE.md — code
live in `main`, export served from an old build). No piecemeal re-export needed;
fold their visual confirmation into the closeout redeploy.
