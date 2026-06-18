# R42 — propagate new rent/NOI → recompute derived cap rates

**Status:** Unit 1 (ongoing recompute) + Unit 3 (loader) **shipped/applied live**.
Unit 2 (one-time backfill of the existing stale set) **built + dry-run only —
GATED on Scott's sign-off** (it changes published-adjacent CM values in bulk).

Applied live 2026-06-18 to **gov** (`scknotsqkcheojiaewwh`) + **dia**
(`zqzrriwuavgrquhisnoa`). Migrations:
`supabase/migrations/{government,dialysis}/20260618120000_*_r42_caprate_recompute_on_rent_change.sql`.

## The problem
A sale's derived cap is computed **once**, by the `auto_cap_rate` snapshot
trigger, when the SALE row changes. `leases` / `lease_escalations` /
`property_financials` have no cap recompute, so rent learned **after** a sale was
ingested never refreshes the sale's derived cap. The daily
`*-propagate-recompute-tick` only propagated sale info, not caps.

Where the published cap actually comes from (grounded live):
- **gov** CM views read `cap_rate_history.cap_rate` (COALESCE first; raw
  `sold_cap_rate` is only a fallback). → refresh the **ledger**.
- **dia** CM views read `cap_rate_final` (of-record), whose `noi_derived`
  candidate = `rent_at_sale / sold_price`. → refresh `calculated_cap_rate` +
  `rent_at_sale` (the `dia_sales_cap_of_record_tg` re-derives `cap_rate_final`).

## What shipped
**Unit 1 — recompute when rent/NOI changes (bounded daily pass).**
`{gov,dia}_recompute_caps_for_property(property_id)` recomputes the **derived**
cap via the AUTHORITATIVE `{gov,dia}_compute_cap_rate()` (no reimplementation)
for the property's live sales / active listings (/ gov sale_events) and rewrites:
- gov: `cap_rate_history.cap_rate` (+ rent/source/conf) only.
- dia: `cap_rate_history.cap_rate` + `sales_transactions.calculated_cap_rate` +
  `rent_at_sale` (→ of-record trigger refreshes `cap_rate_final`).

`propagate_sales_recompute(lookback_hours)` (the existing nightly cron fn) now
also scans properties whose `leases`/`property_financials` (gov: +
`lease_escalations`) changed in the window and calls the recompute (≤1500
props/tick). Idempotent — every write is guarded `cap_rate IS DISTINCT FROM
<fresh>`, so a re-run with unchanged rent writes nothing.

**Never touched:** the RAW ingested broker cap (`cap_rate_history.ingested_cap_rate`,
gov `sold_cap_rate`, dia `cap_rate`/`stated_cap_rate`) and `manual` overrides.
Out-of-band recomputes are dropped by the compute function's own `[0.005,0.30]`
(gov) / `[0.01,0.25]` (dia) guard — never stored.

**Unit 3 — every comp surface reads the fresh value.** `dialysis.js`
`loadDiaSalesCompsFromTxns` cap-pick now prefers `cap_rate_final` (the of-record
the CM views use, kept fresh by Unit 1), falling back to the legacy column ladder
only where of-record is NULL — so the bypass loader, the projecting view, and the
ledger agree, and no comp that shows a cap today blanks.

## Unit 2 — SCOPED backfill (R42.1; NOT run; needs Scott's sign-off)
The first R42 dry-run was a **blanket** apply (gov 1,034 / dia 532 events). Review
found it would fix hundreds of garbage ingest caps but also publish a few
**bad-rent** caps (prop 1152: rent $1.77M on a $4.36M sale → 40% gross yield →
29% cap; old 4.05% → new 29.4% is a *regression*). **R42.1 scopes it.**

`{gov,dia}_recompute_caps_backfill(p_dry_run DEFAULT true, p_min_drift, p_band_lo,
p_band_hi, p_max_yield, p_max_props)` now auto-applies a recompute **only when ALL
hold**: `income_confidence='high'` · recomputed cap in band (gov `[0.04,0.12]`,
dia `[0.045,0.11]` — from the live high-conf distribution) · implied gross yield
`rent/price ≤ 0.25` (the bad-rent signal). Everything excluded is routed to
`public.caprate_recompute_review` (with `reason` + a `bad_rent` tag for
implausible yield) and **not applied**. Real run snapshots every applied value to
`public.cap_recompute_backup` (reversible) first.

**Scoped before/after (2026-06-18):**

| DB  | auto-apply events / props | avg cap before → after | max \|Δ\| | → review (low/med-conf · out-of-band · bad_rent) |
|-----|--------------------------:|------------------------|----------:|--------------------------------------------------|
| gov | **538 / 396** | 10.29% → 7.82% (−2.47 pts) | 13.3 pts | **169** (103 · 47 · 19) |
| dia | **288 / 236** |  6.86% → 7.73% (+0.87 pts) |  8.8 pts | **244** (227 · 17 · 0) |

Apply-set max moves are legit corrections (e.g. 22.8% → 9.5% garbage-cap fixes,
all high-conf in-band); the 25–28 pt bad-rent outliers are now in **review**, not
applied. Still moves published CM numbers → **sign-off required.**

### To inspect the scoped diff (read-only, anytime)
```sql
SELECT public.gov_recompute_caps_backfill(true);   -- on gov DB — {apply, review_by_reason, sample_apply, sample_review}
SELECT public.dia_recompute_caps_backfill(true);   -- on dia DB
```

### To apply the scoped backfill (after sign-off)
```sql
SELECT public.gov_recompute_caps_backfill(false);  -- on gov DB → {run_tag, caps_applied, review_emitted}
SELECT public.dia_recompute_caps_backfill(false);  -- on dia DB → {run_tag, ledger_applied, sales_applied, review_emitted}
-- tune the band/yield via the params if needed, e.g. (false,0.005,0.04,0.12,0.25,NULL)
```

### Review list (suspect movers + bad rent) — Units 2 & 4
A real run populates `public.caprate_recompute_review` on each DB:
```sql
SELECT reason, tag, count(*) FROM public.caprate_recompute_review WHERE resolved_at IS NULL GROUP BY 1,2;
-- bad_rent rows are the implausible-rent (gross yield > 25%) leases the recompute
-- SURFACED — Unit 4: fix the underlying lease data at the source, don't auto-correct
-- rent here. Mark a row done by setting resolved_at + resolution.
```

### To revert a backfill run (per `run_tag`)
```sql
-- ledger (both DBs):
UPDATE public.cap_rate_history h SET cap_rate = b.old_value
FROM public.cap_recompute_backup b
WHERE b.run_tag = '<run_tag>' AND b.col='cap_rate' AND b.ref_id = h.id;
-- dia displayed fields:
UPDATE public.sales_transactions s SET calculated_cap_rate = b.old_value
FROM public.cap_recompute_backup b WHERE b.run_tag='<run_tag>' AND b.col='calculated_cap_rate' AND b.ref_id = s.sale_id;
UPDATE public.sales_transactions s SET rent_at_sale = b.old_value
FROM public.cap_recompute_backup b WHERE b.run_tag='<run_tag>' AND b.col='rent_at_sale' AND b.ref_id = s.sale_id;
```

## Note on the ongoing pass
Unit 1's nightly cron does the SAME recompute incrementally for the (small) set
of properties whose rent changed each day — so the ongoing volume is modest and
self-improving. Unit 2 only exists to clear the EXISTING ~20% stale backlog in
one reviewable pass; the gate is on that bulk change, not the daily upkeep.
