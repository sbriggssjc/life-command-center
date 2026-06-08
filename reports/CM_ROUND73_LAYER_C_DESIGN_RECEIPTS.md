# CM Round 73 — Layer C: chart design (deck-match) + receipts

**Date:** 2026-06-08 · **Author:** Claude Code (branch `claude/beautiful-hopper-j0he60`)
**Scope of this session:** Layer C (the four chart-design / axis fixes — highest
visible impact, JS-only, no gated DB writes). Each change ships to BOTH render
paths (PNG renderer `cm-chart-image-renderer.js` + native Excel injector
`cm-native-chart-injector.js`) with harness assertions. Live before/after ranges
were pulled from the gov + dia CM views to ground every axis decision. Scott
verifies the rendered export. Layers B and D are scoped for follow-up at the
bottom.

---

## TL;DR

| # | Chart | Change | Status |
|---|-------|--------|--------|
| C1 | #17 gov Lease Renewal Rate | Revert R70-G25's all-positive stack → **diverging** (expired/terminated below zero) + signed **Net Change** line | shipped (both paths + harness) |
| C2 | #18 gov Lease Termination Rate | **Already** stacked firm/soft bars + rate line on secondary % axis (matches deck p29) | verified — no change, locked by harness |
| C3 | #23 gov Valuation Index | Re-pin gov left axis **210–350 → 150–420** (stale R66 pin clipped the post-R70-A4 climb) | shipped (both paths + harness) |
| C4 | #26 gov + dia Volume + Cap + Quartile | Lower the cap (right) axis MIN per vertical to **lift the band off the volume area** | shipped (both paths + harness) — Scott to confirm render |

**Bonus:** C1's revert also clears the **2 long-standing "pre-existing CM chart
failures"** the codebase had been carrying (the R68-E G5 diverging spec + XML
tests, orphaned when R70-G25 flipped the runtime to all-positive but never
updated the tests). Injector suite is now **fully green** (178/178 + 1 skip; was
174/177 + 2 fail).

---

## C1 — #17 Lease Renewal Rate → diverging + net line (deck p28)

**Ask (Scott):** "expirations and terminations show a negative number below zero;
total actions = a net number so we can display the trend line."

**What changed.** The series→sign map (CONFIG in both paths) flips
`expired_leases` and `terminated_leases` to **−1**:
- `cm-chart-image-renderer.js` `LEASE_RENEWAL_SERIES` — expired/terminated `sign:-1`; net-line label `Total Actions` → **`Net Change`**.
- `cm-native-chart-injector.js` `RENEWAL_SERIES` — same sign flip; `net_movement` helper header `Total Actions` → **`Net Change`**.

The injector's negated-helper-col machinery (negated cols for every subtractive
series + the below-zero stacking) was already built for the original R68-E
diverging design; R70-G25 had merely set every sign to `+1`, which left
`negSeries` empty. Flipping the two signs **reactivates the exact original
machinery** — additive outcomes (first-gen / renewed / succeeding) stack above
zero, expired + terminated plot as negative bars below zero, the value axis
auto-crosses at zero (single shared count axis), and the gray line is now the
signed sum (net change).

**Harness:** the pre-existing `R68-E G5` spec test (barSeries valCol
`['B','C','D','G','H']`, helper cols `expired_leases_neg/terminated_leases_neg/
net_movement`, net = `+++−−`) and the `R68-E G5 XML` test (`invertIfNegative
val="0"`, single `<c:valAx>`, negated cols G/H, net line col I) now pass.

---

## C2 — #18 Lease Termination Rate (deck p29) — already correct

**Ask (Scott):** "firm term count and soft term count as bars stacked on top of
one another … the total active lease count over time."

**Finding:** both paths **already** render this exactly as the deck shows — two
**stacked** count bars (`Leases In Firm Term` (computed = total − outside, navy
bottom) + `Leases Outside Firm Term` (sky top), `grouping="stacked"`) on the
left integer axis, plus the soft-term **termination-rate line on a secondary %
axis** (`yRightRange {0, 0.25}`, wider than the deck's ~14% because 2025 data
exceeds it). No change needed. Locked by the `R68-E G6 XML` harness test (asserts
two value axes, right axis formats as %, stacked bars). Documented here so the
next export reads it as "verified," not "untouched."

---

## C3 — #23 Valuation Index y-axis not rendering (gov)

**Ask (Scott):** index line "looks more normal now" but the axis doesn't render —
fix valAx min/max so the line shows.

**Root cause (live data, `cm_gov_valuation_index_m`, 2026-06-08):**

| window | min | max |
|---|---|---|
| gov full (1997–2025, 323 rows) | 4.99 | **410.30** |
| gov 2013–2025 (dense `ttm_n≥12`) | 260.3 | 410.3 |
| gov by year: 2018 hi 363 · 2020 hi **410.3** · 2021–24 hi 357–369 | | |

The axis was pinned **`{min:210, max:350}`** (set at R66, 2026-05-31). **R70-A4**
(`gov_valuation_index_unsmooth_extend` + `master_splice`) subsequently raised the
gov index to ~161 (2009 trough) … 410 (2020 peak). With `max:350` **every value
above 350 — the entire post-2018 climb — was clipped off the top of the plot
area**, which reads as "the axis / line isn't rendering." The 210–260 band below
the data was dead space.

**Fix:** re-pin gov to **`{min:150, max:420}`** in both paths. This frames the
full rendered series with **no clip** in either window (renderer's fixed
240-month window reaches the 2009 trough ~161; injector's dense-year window
starts 2013 ~260). The dense 2013–2025 band lands at ~41–96% of frame — good
vertical use, the long-run climb reads clearly.

**dia unchanged.** `cm_dialysis_valuation_index_m` runs 94.10–149.37; the
existing `{min:90, max:165}` pin frames it cleanly (consistent with this being a
gov-only report).

**Harness:** new `R73 C3` test asserts gov `{150,420}` / dia `{90,165}`.

---

## C4 — #26 Volume + Cap + Quartile Band — secondary-axis separation

**Ask (Scott):** "adjust the y-axis on cap rate so the volume portion isn't
hidden behind the cap rate data."

**Geometry (live data, 2026-06-08, 2014+):**

| vertical | volume TTM ($M) | Q1–Q3 cap band | avg-cap dots | band on old axis [5.0,10.5] |
|---|---|---|---|---|
| gov | 838 – 7,144 | **5.82% – 9.57%** | 7.22% – 8.13% | ~15% – 83% of frame |
| dia | 226 – 1,545 | **5.70% – 7.70%** | 6.34% – 7.11% | ~13% – 49% of frame |

The cap series is already on a secondary (right) axis, but the Q1–Q3 band sat
**low** on it (gov 15–83%, dia 13–49%), overlaying the volume area (left axis,
auto 0→peak). Screen position `f = (v − min)/(max − min)`; **lowering the
cap-axis MIN raises the whole band** (both numerator and range grow, `f→1`),
clearing the lower frame for the volume area — without touching the volume axis
(no fragile peak hardcode that would need maintenance as volume grows).

**Fix (per vertical, both paths):**
- **gov:** `{min:0.050, max:0.105}` → **`{min:0.020, max:0.105}`**. Band → ~45–89% of frame (volume gets the lower ~45%). Keeps `max:10.5%` for the ~10.08% gov upper-quartile (no top clip).
- **dia:** → **`{min:0.030, max:0.090}`**. Band → ~45–78% of frame (dia top-q ~7.7% well under 9.0%).

**Harness:** new `R73 C4` test asserts the per-vertical right-axis ranges.

> **Scott to confirm the render.** This is geometry-grounded (lifts each band
> into the upper frame so volume reads beneath it) but the exact lane split is
> best judged on the rendered export. If overlap remains, the follow-up lever is
> a small volume-axis headroom pin. The dia rent/SF box (#4) whisker review noted
> in the prompt was not touched this session.

---

## Verification

- `node --check` clean on both `cm-chart-image-renderer.js` and
  `cm-native-chart-injector.js`. `ls api/*.js | wc -l` = 12.
- `test/cm-native-chart-injector.test.mjs`: **178 pass / 0 fail / 1 skip** (179
  total). Pre-edit: 174 pass / **2 fail** (the orphaned R68-E G5 diverging tests)
  — both cleared by C1.
- `test/cm-export-bundle-audit.test.js` (5), `test/cm-stat-recipes.test.js` (12),
  `test/cm-summary-table.test.js` (19): all green.
- Live-data reads only (no DB writes) on the gov (`scknotsqkcheojiaewwh`) + dia
  (`zqzrriwuavgrquhisnoa`) projects.

**Deploy:** JS-only — ships on the Railway redeploy of merged `main`. No view /
migration changes, so deploy ordering is irrelevant.

---

## Remaining Round-73 scope (follow-up sessions)

Per the prompt's "scope across sessions if needed." Order was C → B → D; C is done.

**Layer B singles (verification + small fixes):**
- **#8/#24** on-market / turnover 2025+ over-stamping — verify the R70/R73 gates
  hold honest floors in a fresh export (deeper `listing_date` backfill is R74 6c).
- **#13** gov Cap by Credit Tier — state/muni cohorts are sparse; render sparse
  cohorts with **markers** (so single points show) and/or pool to annual.
  Document the genuine-thin floor. (Live: gov view has 0 populated state/muni cap
  rows — needs the data feed; markers only help once rows exist.)
- **#21** gov Rent Growth — confirm the R72 CAGR perf fix cleared the
  FETCH-FAILED sentinel; verify it populates in a fresh export.
- **#1** dia Bid-Ask — duplicate series-label emission (legend dedup bug) +
  outlier band review.

**Layer D x-axis reach (extend to earliest consistent quarter, else gate+annotate):**
- #2 #3 #7 #12 #15 #16 #26 — set the catAx/dateAx floor where the series stays
  continuous.
- **#19** gov Net Lease Spread — backfill the 10Y treasury series back to 2001 so
  the line reaches the chart start. **Note:** the live treasury source is
  Treasury.gov (`treasury.js`, DGS10 equivalent) feeding `cm_{gov,dia}_macro_rates_m`,
  not FRED directly. This is a **data backfill** (writes rows) → dry-run → gate.
