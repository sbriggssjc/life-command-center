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

## 3. D13 — dia pre-2010 "mechanical" valuation index (`cm_dialysis_valuation_index_q`) — CANDIDATE

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

**Proposed fix (candidate, NOT applied):** align the render gate with the base
threshold — `WHERE ... AND ttm_n >= 30` (was `>= 12`). Series then begins
2010-Q2 at the 100 base, dropping the 7 thin/back-cast quarters including the
dead-flat 2009-Q1. Removes nothing real (the dropped values are < base-grade
samples), but it **removes visible history from Scott's deck**, so it's held for
his go-ahead. Candidate migration:
`supabase/migrations/dialysis/20260607_cm_round70_d13_valuation_index_gate.sql`.
Alternative if Scott wants to keep the reach: annotate pre-2010-Q2 as
"low-sample (n<30)" rather than drop — but the chart renderer reads a numeric
series, so a true annotation needs a renderer change (Layer C).

---

## 4. D11 / D12 / G37 — "data gaps" notes — BLOCKED ON CHART IDENTITY

These three are referenced only as **images 11/12/37 in the June-6 review doc**,
which is not in the repo — there is no number→view map for them in
`CLAUDE_CODE_PROMPT_round70_june6_notes.md` (its B5 line lists them without
naming the charts). I can't produce an honest receipts table against the right
view until each is identified. **Surfaced to Scott** (see PR / question). Once
named, each gets the same one-table fix-or-document pass.

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

**Verdict: the heuristic is sound and isolates a real early-termination signal,
but it does NOT reproduce the deck's "~3 TTM at 2024-Q2 vs 5-yr avg 107."** The
reconstructed series is a steady ~50 TTM with no 2024-Q2 collapse. Two things
need Scott's call before any view ships:
1. **Definition.** My "termination" still includes **relocations** (agency left
   the building early → that lease ended early, but a new lease opened elsewhere
   with no `old_lease_number`/same-`location_code` link). The deck's "3" implies
   a much narrower give-back definition. Which counts?
2. **The 3/107 deck figures** almost certainly came from a different definition;
   my receipts can't manufacture that swing without fabricating.

Held as a candidate view (`cm_gov_lease_termination_true_q`) +
`supabase/migrations/government/20260607_cm_round70_terminated_heuristic_CANDIDATE.sql`
— **not** wired into the live Lease Renewal/Termination chart. The recent-tail
gate and the definition are settled with Scott first.

---

## Summary

| item | verdict | action |
|---|---|---|
| G27 | genuine-thin | chart-note (no view change) |
| G29 | fixable slice + genuine-sparse | **fixed live** (additive rent recovery) |
| D13 | thin + back-cast | candidate gate (held — removes history) |
| D11/D12/G37 | unidentified | **blocked** — need chart identity from Scott |
| terminated | sound but ≠ deck 3/107 | candidate view (held — definition is Scott's call) |
