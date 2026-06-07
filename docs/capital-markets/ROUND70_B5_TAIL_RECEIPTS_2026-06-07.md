# Round 70 — B5 tail + terminated heuristic — receipts & verdicts (2026-06-07)

Receipts-first resume of Round 70 Layer B. One receipts table + verdict per
item. View changes that are purely additive (recover real data) applied live;
changes that **remove** what Scott sees, or whose **definition is Scott's call**,
are committed as candidate migrations and surfaced for his decision before ship.

DB refs: gov `scknotsqkcheojiaewwh`, dia `zqzrriwuavgrquhisnoa`.

---

## 1. G27 — gov NM line (`cm_gov_nm_vs_market_q`)

**Receipt** — per-quarter TTM n of NM vs non-NM (brokered) sold-with-cap, gov
`all`, plus the *rendered* NM line (after the `nm_n>=3` gate + ±4-**month**
smoothing window). Key window:

| quarter | nm_n (TTM) | nm_any (TTM, all NM sales) | mkt_n (TTM) | rendered nm_cap |
|---|---|---|---|---|
| 2022-Q4 | 6 | 9 | 46 | 0.0654 |
| 2023-Q1 | 3 | 4 | 43 | 0.0652 |
| 2023-Q2 | 1 | 2 | 39 | 0.0632 |
| 2023-Q3 | 1 | 2 | 33 | **NULL** |
| 2023-Q4 | 1 | 1 | 33 | **NULL** |
| 2024-Q1 | 1 | 1 | 28 | **NULL** |
| 2024-Q2 | 2 | 3 | 26 | **NULL** |
| 2024-Q3 | 1 | 3 | 23 | 0.0710 |
| 2024-Q4 | 3 | 5 | 13 | 0.0710 |
| 2025-Q2 | 3 | 5 | 11 | 0.0729 |

**Verdict: genuine-thin — document, do not fabricate.** The NM line gaps
2023-Q3 → 2024-Q2 (4 quarters) because TTM NM **brokered sold-with-cap** is 1–2
there. This is real: `nm_any` (every NM gov sale, cap or not) is only 1–3 across
the same window — Northmarq simply closed very few gov deals in the 2023–24
gov-leased lull. The ±4-month smoothing window (the spine is monthly) cannot
bridge it because every month inside ±4 is also sub-3. The R70-7b +15 NM flags
already lifted 2024-Q3+ back over the gate. **Nothing renderable is still being
dropped** — the only way to "fill" the gap is to relax the gate to n=1–2 (a 1–2
deal average is noise) or widen smoothing (masks the real lull). Recommend a
chart-note: *"NM line omits quarters with < 3 trailing-12mo Northmarq brokered
gov sales (2023–24 gov-leased deal lull)."* **No view change.**

---

## 2. G29 — gov rent-by-year-built, 2017+ (`cm_gov_rent_by_year_built`) — FIXED (live)

**Receipt** — per year_built, properties with a usable rent-PSF, by source.
`recoverable_from_lease` and `recoverable_from_gsa_leases` are **both 0** — these
newer-vintage rows have no `leases` row, no `gsa_leases` rent, no FRPP link, no
lease_number. The only recoverable source is the property's **own**
`gross_rent / sf_leased` (the `gross_rent_psf` column was just never computed by
`enrich_properties` for GSA-sourced rows).

| year_built | n_props_total | gross_rent_psf NULL | cur in-band (before) | + recoverable own-cols | combined (after) | renders (n≥8) |
|---|---|---|---|---|---|---|
| 2017 | 176 | 172 | 4 | 0 | 4 | no |
| **2018** | 297 | 291 | 6 | +2 | **8** | **yes (new)** |
| 2019 | 136 | 132 | 4 | +1 | 5 | no |
| 2020 | 14 | 10 | 4 | +3 | 7 | no |
| 2022 | 151 | 151 | 0 | +1 | 1 | no |

**Verdict: dominantly genuine-sparse + a small fixable propagation slice → fixed
the slice.** The bulk of 2017+ vintages are GSA-inventory rows with **no rent
anywhere in our DB** (e.g. the VA/Riverview 63,737-SF building appears ~10× as
duplicate rows, all rent-NULL — also a dup-pollution problem). ~11 properties
2017+ do carry `gross_rent` + `sf_leased` but a NULL `gross_rent_psf` — real data
the view wasn't reading.

**Fix applied live** (`cm_gov_rent_by_year_built`): source rent-PSF as
`COALESCE(gross_rent_psf, gross_rent/sf_leased)` inside the `[5,200]` band.
Purely additive — recovers real data, removes nothing.
- **Before → after:** 2018 vintage **6 → 8 → now renders** ($43.24/SF);
  2012 (35→36), 2015 (11→14) gain depth; 2017/2019/2020/2022 stay dark
  (genuinely < 8). Migration:
  `supabase/migrations/government/20260607_cm_round70_g29_rent_by_year_built_rpsf_recovery.sql`.
- Residual 2017+ sparsity is real (no rent in DB) → chart-note candidate.
- Follow-up (separate, not this round): the duplicate GSA-inventory property
  rows (VA/Riverview etc.) inflate `n_props_total` and should go through the
  property-merge lane.

---

## 3. D13 — dia pre-2010 "mechanical" valuation index (`cm_dialysis_valuation_index_q`) — GATE APPLIED LIVE

**Receipt** — rendered dia valuation index + per-quarter `n_sales` + `ttm_n`,
pre-2014. The render gate is `ttm_n >= 12`; the index **base** (=100 anchor) is
the first quarter with `ttm_n >= 30`, which is **2010-Q2**.

| quarter | valuation_index | n_sales (qtr) | ttm_n |
|---|---|---|---|
| 2008-Q3 | 91.52 | 4 | 12 |
| 2008-Q4 | 89.8459 | 5 | 17 |
| **2009-Q1** | **89.8459** (byte-identical carry) | **0** | 17 |
| 2009-Q2 | 87.02 | 3 | 20 |
| 2009-Q3 | 88.81 | 4 | 24 |
| 2009-Q4 | 91.64 | 4 | 28 |
| 2010-Q1 | 88.88 | 6 | 28 |
| **2010-Q2** | **100.00 (base)** | 5 | **31** |

**Verdict: thin + back-cast — gate, don't fabricate.** Every quarter
2008-Q3 → 2010-Q1 (7 quarters) is rendered on a trailing-12mo sample of **12–28**
sales — below the 30-sale threshold the **base itself** requires — and is divided
by a base computed from a *later* quarter (2010-Q2). 2009-Q1 is the literal
"mechanical" artifact: `n_sales = 0`, so the TTM rent/cap is carried forward
unchanged and the index prints a value byte-identical to 2008-Q4 — a dead-flat
segment that is not market movement.

**Fix applied live** (Scott-blessed): align the render gate with the base
threshold — `WHERE ... AND ttm_n >= 30` (was `>= 12`). Series now begins 2010-Q2
at the 100 base, dropping the 7 thin/back-cast quarters incl. the dead-flat
2009-Q1. Migration:
`supabase/migrations/dialysis/20260607_cm_round70_d13_valuation_index_gate.sql`.
**Paired follow-up (Scott's call):** rather than *lose* the mechanical history,
*gain honest history* — splice the dia master's own `Valuation Index`
(`scripts/dia_master_charts.json`, column confirmed present, monthly from 2008)
as a `master_curated` pre-2010-Q2 segment, scaled for a continuous join at the
2010-Q2 base (the gov 1997-splice pattern). The gate ships now; the splice rides
back through the gate separately so the fix isn't held hostage to the
enhancement.

---

## 4. D11 / D12 / G37 — cap-by-term "data gaps" (identified by Scott)

All three are the cap-rate-by-lease-term-cohort family. Per-cohort n receipts
below; verdicts confirm Scott's predictions.

### D11 — dia sold cap-by-term (`cm_dialysis_sold_cap_by_term_dot`)
Per-year n by `firm_term_years_at_sale` cohort (cap in [4%,12%]):

| yr | n_cap | 12+ | 8–12 | 6–8 | ≤5 | term-missing |
|---|---|---|---|---|---|---|
| 2018 | 168 | 66 | 37 | 19 | 21 | 25 |
| 2021 | 157 | 24 | 39 | 47 | 31 | 16 |
| 2022 | 110 | **2** | 29 | 39 | 32 | 8 |
| 2023 | 101 | **11** | 18 | 27 | 33 | 12 |
| 2024 | 72 | **7** | 13 | 20 | 22 | 10 |
| 2025 | 113 | **8** | 20 | 30 | 40 | 15 |

**Verdict: genuine-thin (12+ cohort collapse).** The visible gap is the **12+
cohort drying up 2022+** (2–11/yr vs 54–72 in 2016–17) → < 3/quarter → the 12+
dot gates out. Real market shift: dia long-term sold deals scarce post-2021. The
8–12/6–8/≤5 cohorts stay renderable. Secondary `term-missing` slice (10–25/yr,
cap present + `firm_term_years_at_sale` NULL) is a modest propagation residual —
but those sales aren't predominantly 12+, so recovering them won't lift the 12+
cohort over the gate. **Document; the locked-master curated overlap already
covers the rest.**

### D12 — dia asking cap-by-term (`cm_dialysis_asking_cap_by_term_m`)
Per-year n by cohort, base = `cm_dialysis_active_listings_m` (listing-**months**,
the unit the view's TTM consumes):

| yr | 12+ | 8–12 | 6–8 | ≤5 | term-missing | total |
|---|---|---|---|---|---|---|
| 2020 | 53 | 125 | 17 | 43 | 40 | 278 |
| 2022 | 16 | 79 | 42 | 23 | 23 | 183 |
| 2024 | 42 | 83 | 136 | 91 | **83** | 435 |
| 2025 | 51 | 49 | 262 | 99 | **145** | 606 |

**Verdict: partly fixable (asking-side term propagation).** Unlike D11, the
asking cohorts are **not** thin — every bucket carries dozens of listing-months
and renders. The gap Scott saw ("missing quite a bit") is the **growing
`term-missing` slice** (38 → 145 listing-months 2018→2025): active listings that
carry a cap but no `firm_term_years`. That's a **fixable propagation gap** on the
listing side (propagate firm-term to `available_listings` from the linked sale /
lease, the same propagation B2 chased for sold 10+). Recovering it would
back-fill the cohorts, especially 2024–25. **Fixable → flag for a listing-term
propagation pass** (data write, dry-run→gate — not done here; quantified:
~83–145 listing-months/yr recoverable candidates).

### G37 — gov sold cap-by-term (`cm_gov_sold_cap_by_term_dot`) = G17 cross-ref
Per-year n by `firm_rem` cohort, **after** the view's COALESCE term ladder
(gsa_leases → leases → sale → lease_expiration):

| yr | n_cap | 10+ | 5–10 | <5 | ≤0 | term-missing (post-ladder) |
|---|---|---|---|---|---|---|
| 2021 | 118 | 28 | 32 | 30 | 13 | 15 |
| 2022 | 89 | 15 | 30 | 22 | 16 | 6 |
| 2023 | 53 | 13 | 15 | 10 | 12 | 3 |
| 2024 | 31 | **8** | 11 | 7 | 0 | 5 |
| 2025 | 31 | **5** | 4 | 10 | 3 | 9 |

**Verdict: same as G17 — curated-vs-market universe + falling recent volume, not
a formula bug.** Gov sold-with-cap volume falls 76→31→16 (2016→2026) and the
longer cohorts (10+) drop to 5–8/yr → < 3/quarter → gated. The COALESCE ladder
already mitigates term-missing to a 3–9/yr residual (down from the raw lag) —
that residual is the small propagation slice the **7d unimported-master-rows**
decision feeds. **Cross-reference G17; do not re-derive.** Supabase doesn't beat
the Excel here because the Excel's curated universe carried more recent
sold-with-term rows than our market-captured set — the gap is universe, not math.

---

## 5. Terminated snapshot-disappearance heuristic (A3 tail) — CANDIDATE, propose-don't-ship

The live `cm_gov_lease_termination_rate_q` counts `gsa_leases.termination_date`
in the trailing year. Per PR #1083 that field is the GSA **firm-term /
termination-right** date (avg ~1,614 days before `lease_expiration`, 0 in the
1–180d band) — **not** actual early terminations. The heuristic detects leases
that **vanish from `gsa_snapshots` before their `lease_expiration`**.

### 5a. Snapshot-coverage receipt (must gate these first)
- Monthly snapshots 2013-01 → 2026-06, **with gaps** (e.g. 2013-04/06/09, 2019-02).
- **2019-02-01 has only 11 leases** (vs ~8,054 neighbors) — a broken partial
  snapshot. Naive last-seen would falsely "disappear" ~8,000 leases at 2019-01.
  → exclude snapshots with `count < 1000`.
- **2026-03 → 06 are frozen duplicates** (identical 7,495) and 2026-03 *added*
  rows vs 2026-02 (reshuffle). → the recent tail can't be trusted for *new*
  disappearances.

### 5b. Disappearance decomposition (valid snapshots only)
9,098 leases permanently disappeared over the snapshot era. Timing vs the
last-snapshot `lease_expiration`:

| bucket | n | meaning |
|---|---|---|
| within −180d/+120d of expiration | 6,931 | natural expirations |
| > 180d **before** expiration | 2,008 | early-vanish candidates |
| > 120d after expiration | 159 | lingered then dropped |
| latest_action = Succeeding | 991 | renewed under successor |
| latest_action = Extension | 3,014 | extended (not terminated) |

### 5c. True early terminations (early-vanish, not a renewal action, no successor
lease via `old_lease_number` chain or same-`location_code` replacement), per
calendar quarter of disappearance:

~10–20 / quarter, steady, 2013 → 2025-Q1. Representative tail:
2023: 12/17/13/16 · 2024: 10/10/12/14 · 2025-Q1: 15 · 2025-Q2: 3.
**2025-Q3/Q4 missing, 2026-Q1 = 177** (frozen-tail / reshuffle artifact — must
be gated out).

**TTM at 2024-Q2 = 49** (13+16+10+10); 5-yr TTM average ≈ **49** — essentially
flat.

### 5d. Calibration against the master — the decisive receipt
`scripts/gov_master_allcharts.json` carries the master's own
**`Terminated Leases (ttm)`** column (negative = loss convention). It matches
Scott's anchors to the unit and shows a clean **collapse**:

| quarter | master Terminated (ttm) | my heuristic TTM |
|---|---|---|
| Q1-2021 | −339 | ~50 |
| Q4-2021 | −107 | ~50 |
| Q2-2022 | **−88** ✓ | ~37 |
| Q2-2023 | **−41** ✓ | ~58 |
| Q1-2024 | **−3** ✓ | ~49 |
| Q2-2024 | **−3** ✓ | 49 |
| Q2-2025 | 0 | n/a (frozen tail) |

**Verdict: the snapshot-disappearance heuristic does NOT reproduce the master —
not by tuning, by shape.** The master is a declining wave (339 → 88 → 41 → 3 → 0,
a COVID-era give-back collapse); my reconstruction is flat ~50. My filter is
under-counting the 2021 peak (those give-backs were mostly leases vanishing
*near* expiration — non-renewals, which my >180d-early test excludes) and
over-counting 2024 (relocation/churn the test doesn't separate). Per Scott's own
rule ("if the refined count tracks the anchors, ship; if a residual class
remains, enumerate and gate") — **it does not track, so it does not ship.**

**Recommendation (matches the dia-VI splice doctrine Scott just endorsed):** the
master's `Terminated Leases (ttm)` is the validated ground truth, built from the
same GSA data and matching every anchor. **Splice it as the deck's termination
series** (tagged `source='master_curated'`), replacing the current
`cm_gov_lease_termination_rate_q.terminated_ttm` (which counts the firm-term
`termination_date`, semantically wrong). Reverse-engineering the GSA-monthly-diff
"termination" definition so Supabase reproduces the collapse natively is its own
round — the snapshot heuristic isn't it. The candidate view + receipts are kept
for that future work; **nothing wired into the live chart this session.**

Candidate: `cm_gov_lease_termination_true_q` +
`supabase/migrations/government/20260607_cm_round70_terminated_heuristic_CANDIDATE.sql`
(header updated with this calibration).

---

## Summary

| item | verdict | action |
|---|---|---|
| G27 | genuine-thin (NM gov deal lull) | chart-note (no view change) |
| G29 | fixable slice + genuine-sparse | **fixed live** (additive rent recovery) |
| D13 | thin + back-cast pre-2010-Q2 | **gate applied live** (ttm_n≥30); dia-VI master splice = follow-up (source confirmed) |
| D11 (dia sold) | genuine-thin (12+ cohort collapse 2022+) | chart-note |
| D12 (dia asking) | fixable (listing term-propagation, 83–145 lm/yr) | flag for listing-term propagation pass |
| G37 (gov sold) | = G17 (universe + falling volume) | cross-ref G17, chart-note; 3–9/yr residual feeds 7d decision |
| terminated | heuristic ≠ master by shape (flat 50 vs collapse 339→0) | **don't ship heuristic**; recommend master `Terminated Leases (ttm)` splice |

### Applied live this session
- gov `cm_gov_rent_by_year_built` — G29 rent-PSF recovery (additive).
- dia `cm_dialysis_valuation_index_q` — D13 gate `ttm_n ≥ 30` (Scott-blessed;
  drops the 7 thin/back-cast pre-2010-Q2 quarters incl. the n=0 2009-Q1 carry).

### Held / follow-up (Scott's calls captured)
- **dia VI master splice** — extend the index back to 2008 from
  `scripts/dia_master_charts.json` `Valuation Index` (column confirmed present),
  tagged `master_curated`, scaled for a continuous join at the 2010-Q2 base
  (gov 1997-splice pattern). Build pending; the gate already removed the bad tail.
- **gov terminated master splice** — replace the wrong firm-term-date count with
  the master `Terminated Leases (ttm)` series (matches all anchors).
- **D12 listing-term propagation** — data write, dry-run→gate, own round.
