# Round 68 batch 3 — dia sold-side history depth (R68-B) + YOY/index (R68-D)

**Diagnosis + plan, grounded live on Dialysis_DB (`zqzrriwuavgrquhisnoa`) 2026-06-05.**
Addresses Scott's notes D1 / D3 / D10 / D12. Diagnose-first per the round's mandate;
the only bulk write (Task 1) ships as a dry-run plan → verify → workstation `--commit`.

The canonical cap-by-term series is `cm_dialysis_sold_cap_by_term_dot` and the live
def reads **`firm_term_years_at_sale`** (the column) + **`cap_rate_final`** with the
per-cohort **n≥3** gate and a centered 9-month smooth (R66d body, R66x no-gap edge).
The other three consumers (`master_m` cohort cols, `cap_by_term_m`, `cap_by_term_q`)
read the dot view — the R66x byte-identical invariant. **Term backfill changes the
view's INPUT (`firm_term_years_at_sale`); it never forks a definition.**

---

## Task 1 (D10) — why cohorts merge pre-2018, and the lever

**Mechanism (b) is the real one.** The resolver isn't mis-bucketing; it's returning
**NULL** for a large share of pre-2018 sales (term% 49–78%), so deals fall out of
*every* cohort and the gated/smoothed series collapses toward the blended mean.

The lever is the master workbook's curated TERM column, exactly as the 20260712
precedent did for the 280 r2-imported sales — now extended to **every
fingerprint-matched master↔sale pair**.

### Identity test (established)
same state · |sale_date|≤90d · |price|≤3% · **|cap|≤5bp** comparing master `sold_cap`
to our **untouched** source cap `COALESCE(stated_cap_rate, cap_rate)` (NOT
`cap_rate_final`, which may already carry a master override). Cap agreement is what
makes it an identity (date+price collide across portfolios). Master rows without an
in-band cap can't satisfy it → reported `nocap_skipped`, not written (unless
`--allow-nocap`).

### Write
For an identity-matched, **un-locked** sale where `firm_term_years_at_sale IS NULL`
(NULL_FILL) or `|cur − master| > 1.5y` (OVERRIDE — the Venoy class):
set `firm_term_years_at_sale = master.term_years`, `firm_term_source='master_curated'`,
`firm_term_expiration_at_sale`, `firm_term_computed_at`, and lock per `--lock-mode`.

### Grounded bounds (live 2026-06-05)
`already_master == locked` every year → the only locked terms today are the 280-row
r2 import; everything else is unlocked and eligible. Master term coverage vs our
term-NULL ceiling, by year:

| yr | DB sales | DB term_null (null-fill ceiling) | master term rows / in-band-cap |
|----|----|----|----|
| 2013 | 83 | 30 | 30 / 26 |
| 2014 | 110 | 28 | 40 / 40 |
| 2015 | 158 | 45 | 62 / 57 |
| 2016 | 163 | 43 | 97 / 91 |
| 2017 | 199 | 44 | 133 / 124 |
| 2018 | 251 | 64 | 169 / 163 |
| 2019–2022 | ~1130 | ~350 | ~620 |
| **2026** | 57 | **38** | **4 / 2** |

The lift concentrates 2013–2022. **2026 master coverage is only 4 rows — Task 1
cannot fix 2026; that's a going-forward capture problem (Task 2).** Exact per-row
counts + 20-row sample come from the dry-run.

### LOCKING — decided: `--lock-mode=all` (lock them)
There is an AFTER trigger on `leases` (`dia_leases_refresh_firm_term`) that
**re-resolves `firm_term_years_at_sale` for every UNLOCKED sale** on a property
whenever any lease there changes — returning NULL for NULL_FILLs and the wrong value
for OVERRIDEs. So an unlocked master backfill is silently reverted on the next lease
touch. **Scott's call (2026-06-05): lock them**, `firm_term_locked=true`, on three
grounds: (1) the fingerprint gate IS the verification — each term is the broker-curated
value for the *same* transaction, the highest-trust source; (2) the Round-66 #1
freeze-at-sale doctrine already decided term-remaining is a frozen historical fact, and
a leases trigger reverting it is exactly the Venoy regression; (3) a future covering
lease "auto-winning" only helps if the master was wrong — rare by construction, and
then it's a manual-review correction with receipts, not a trigger's call.

So the default is `--lock-mode=all` with `firm_term_source='master_curated'` and a
**fingerprint receipt appended to `notes`** (`r68b_term<-master fp(Δcap=…bp,Δd=…d,…)`,
non-destructive, idempotent). Release valve: locked master terms are revisited per-deal
via manual review — the trigger never wins against a receipt. `--lock-mode=overrides`
remains available but is not the recommended commit.

### Run (workstation — creds live there, not in the web sandbox)
```bash
DIA_SUPABASE_URL=... DIA_SUPABASE_SERVICE_KEY=... \
  node scripts/round68b-term-backfill-from-master.mjs --plan-out=r68b_term_plan.json
# review per-year counts + sample, then:
... node scripts/round68b-term-backfill-from-master.mjs --commit            # default lock-mode=all
# revert if needed: ... --revert=r68b_term_plan.json --commit
```
**Acceptance after commit:** re-run the term% table; per-cohort n + cohort separation
2013–2018 before/after at the standard anchors; the four cap-by-term consumers stay
identical (term backfill is an input change, not a def change).

---

## Task 2 — the 2026 term collapse (34%) is a capture gap, NOT a resolver gap

The resolver **does** run on the intake path: a BEFORE-INSERT trigger
`trg_dia_sales_firm_term` resolves term on every sale insert/update, and the leases
trigger re-resolves when a lease lands later. Proof (live): among unresolved
2024–2026 sales, **`unres_but_has_covering_lease = 0`** — wherever a covering lease
exists, term *is* resolved. The collapse is pure data availability:

| yr | unresolved | no lease at all | lease present but non-covering | has years_remaining in notes |
|----|----|----|----|----|
| 2024 | 54 | 18 | 36 | 0 |
| 2025 | 72 | 26 | 46 | 0 |
| 2026 | 38 | 23 | 15 | 0 |

`has_notes_term = 0` everywhere → the capture path never writes
`sale_notes_extracted.years_remaining`, so the resolver's tier-3 never fires.

**Fix (forward, JS — ships on Railway redeploy):** in the sidebar/intake sale writer
(`api/_handlers/sidebar-pipeline.js::upsertDomainSales` / the OM promote path),
when CoStar/OM exposes a lease term or expiration for the sold asset, write it into
`sale_notes_extracted.years_remaining` (or upsert the covering `leases` row) so tier-1
or tier-3 resolves at insert. **Backfill** of the 2024–2026 unresolved set is covered
by Task 1 only where master has the row (2024–2025 mostly; 2026 barely) — the rest
needs the forward capture fix to self-heal as leases/notes arrive.

---

## Task 3 (D12) — pre-2011 choppiness: gate, don't fabricate

21–32 sales/yr and 10–19 caps pre-2011 → monthly TTM quartile bands whipsaw. Data
lever first: master has only **10 (2011) / 18 (2012)** term rows pre-2013 and very few
pre-2011 sales not already in the DB — a mini-import is **not** worth it (well under
the >10 unimported-rows threshold once fingerprint-deduped). So the honest fix is a
**presentation gate** on `cm_dialysis_cap_quartile_m` / the Volume+Cap+Quartile chart:
**suppress the quartile band where TTM n<8, keep the avg line**, and add the chart
note. (Spec'd; not yet implemented — column contract + exact view to gate confirmed
next, same pattern as the index gate below.)

---

## Task 4 (D1) — Bid-Ask 2014/15 sporadic: bounded, gate pre-2016

Bid-ask needs ask+sold pairs; priced listings 2014/2015 ≈ 24/40 (synthetics are
price-less **by design and must stay out** — do not relax the synthetic guard). Lever
order: (a) mine CoStar `price_change_history`/raw capture for historical asks on
pre-2017 listings; (b) if coverage stays thin, **gate the bid-ask series pre-2016 to
n≥5 pairs** and document. (Spec'd; the live `cm_dialysis_bid_ask_spread_m` column
names need confirming before the surgical gate — next.)

---

## Task 5 (D3) — YOY% before 2014 + valuation-index reach

**Two different series, two different root causes:**

1. **`cm_dialysis_yoy_change_m`** (lag-12 of `ttm_volume` via `master_m`) is already
   non-null from **2002-01-31** in the view. So "starts 2014" is a **CHART/EXPORT
   crop**, not a view clamp (disproves the view-clamp and master_m-filter hypotheses).
   `master_m` exposes `transaction_count_ttm`, so the fix is: gate the view at
   `transaction_count_ttm ≥ 12` (honest start ≈ 2009–2010) **and** lower the chart's
   x-axis floor. (JS chart-crop fix — next; view-side gate is a 1-line add.)

2. **`cm_dialysis_valuation_index_m`** started **2014-04-30** because (a) `month_anchors`
   floored at 2010 and (b) `indexed` cropped at `period_end ≥ base_period` where base =
   first month with TTM rent+cap n≥30 (~2014). **SHIPPED in this batch** — migration
   `20260713_cm_round68d_dia_valuation_index_extend_back.sql`: floor → 2008, swap the
   base-period crop for a per-row **n≥12** gate (base stays anchored at n≥30 for a
   stable =100 reference). The same n≥12 gate is added to `_q` (which was rendering
   from 2000-09-30 with 22 ungated thin quarters). This is the dia twin of the gov G13
   min-n gate. `yoy_change_pct` (lag-12 of the index) inherits the longer window.
   **APPLIED LIVE 2026-06-05** (per Scott — view changes go live per-request, no
   mid-window consumer before this batch's export). Post-apply: both `_m` and `_q`
   now start **2011-09-30** (was 2014-04 / 2000-09); index ranges 94.8–152.7 (_m),
   95.9–170.8 (_q) — sane, no whipsaw.

---

## Status

| Task | Artifact | State |
|----|----|----|
| 1 (D10) | `scripts/round68b-term-backfill-from-master.mjs` + grounded bounds | **Ready for workstation dry-run → verify → commit.** Lock-mode decided: `all` + notes receipt. |
| 2 | `sidebar-pipeline.js` — tier-3 `years_remaining` fallback at sale insert | **DONE** (rides next Railway redeploy). Derives years_remaining from `lease_expiration − sale_date` for the most-recent sale when no narrative term + no covering lease; a later lease row still upgrades via tier-1. dia-only, freeze-at-sale safe. |
| 3 (D12) | `20260714_cm_round68b_dia_cap_quartile_gate_8.sql` (gate 4→8) | **APPLIED LIVE 2026-06-05.** Band suppressed where TTM n<8 (2005/2010 blank, 2007-08/2011+ kept); avg line untouched. |
| 4 (D1) | bid-ask gate | **No change needed** — `cm_dialysis_bid_ask_spread_m` already gates `n_with_spread>=5` globally with the synthetic guard (`data_source IS DISTINCT FROM 'synthetic_from_sale'`) intact. 2014=10/12 mo shown, 2015=12/12, 2012-13 correctly suppressed. Lever (a) wouldn't change the 2014-floored chart. |
| 5 (D3) | `20260713_…valuation_index_extend_back.sql` + `cm-native-chart-injector.js` floor | **APPLIED/DONE.** View live (both start 2011-09); chart `valuation_index` floor 2013→data-aware `ttm_n>=12` (≈2011) — extends the index line + YoY% overlay together. Standalone `yoy_volume_change` chart already floors 2005 (R62). |
