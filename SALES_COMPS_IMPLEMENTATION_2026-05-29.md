# Sales Comps — Implementation Log (2026-05-29)

Implements the sales-comps decisions after the categorization review. Companion
to `SALES_AND_AVAILABLE_COMPS_DEFINITION_AUDIT_2026-05-29.md` and
`ON_MARKET_AVAILABILITY_IMPLEMENTATION_2026-05-29.md`. **No rows deleted; every
change reversible.**

## Categorization conclusion (reviewed before any change)

`transaction_state` and `exclude_from_market_metrics` are **distinct, legitimate
concepts** and are kept separate:
- `transaction_state` = is this a *unique real* transaction? (`live` /
  `duplicate_superseded` / `ownership_stub` / `needs_review`).
- `exclude_from_market_metrics` = is this real transaction *clean enough for
  market statistics*? Confirmed: all 607 dia / 1,031 gov `live`+excluded rows are
  real priced sales (implausible cap, portfolio allocation, parser-error price).

`duplicate_superseded` rows spot-checked = genuine duplicates (same property/
price, days apart, `dedup_group_id` → survivor). Merging the two flags was
rejected — it would re-pollute cap stats.

## The bug & the fix

**Bug:** every comp/metric consumer gated only on `exclude_from_market_metrics`,
never on `transaction_state`, so duplicates/stubs/needs-review (which lack the
exclude flag) leaked into comp counts + TTM volume + the CM report.

**Decision (user):** comp gate = `transaction_state='live' AND
exclude_from_market_metrics IS NOT TRUE` (option A).

**Fix (minimal blast radius):** enforce the universally-correct invariant
**non-live ⇒ excluded from market metrics**, instead of editing 22+ views. A
duplicate / price-less stub / needs-review row must never be in market stats, so
backfilling `exclude_from_market_metrics=true` on every non-live row makes the
existing `exclude_from_market_metrics IS NOT TRUE` gate in every view, in gov
`v_sales_comps`, and in `detail.js` equal option A automatically. Live rows'
exclude flag is never touched — the cap-quality concept is preserved.

### Migrations
- `supabase/migrations/dialysis/20260529170000_dia_sales_comps_nonlive_excluded_invariant.sql`
- `supabase/migrations/government/20260529170000_gov_sales_comps_nonlive_excluded_invariant.sql`

Each: snapshot (`sales_nonlive_exclude_backfill_20260529`) → backfill the
invariant → `BEFORE INSERT OR UPDATE` trigger
(`enforce_nonlive_excluded_from_metrics`) to keep it true forever (e.g. when the
dedup tick stamps `duplicate_superseded`, the row is auto-excluded).

Validated (read-only, pre-apply): dia backfills **626** leak rows (option-A set
= 2,899; the 607 live-excluded preserved); gov backfills **1,005** (option-A =
2,458; the 1,031 live-excluded preserved). No live row's flag changed.

### Frontend
- `dialysis.js` `loadDiaSalesCompsFromTxns` — added
  `filter: 'exclude_from_market_metrics=not.is.true'` (was raw, all states). TTM
  transactions card: ~201 → ~170; volume no longer double-counts superseded
  dupes. (gov dashboard reads `v_sales_comps`, detail.js gov fetch already
  filters the flag, and all `cm_*` views already gate on it — all auto-corrected
  by the invariant, no edits needed.)

### Auto-corrected by the invariant (no edits)
gov `v_sales_comps`; `cm_dialysis_*` and `cm_gov_*` market/turnover/ttm/cap/
volume views (22+ each); `detail.js` comp tables + gov sales fetch.

## Coverage / verify
```sql
-- both DBs: expect 0
SELECT count(*) FROM sales_transactions
 WHERE transaction_state <> 'live' AND exclude_from_market_metrics IS NOT TRUE;
```

## Known follow-ups (NOT in this change)
1. **TTM window unification (rolling-12).** Decision: rolling-12 everywhere. The
   app dashboards already compute rolling-12 and are now correct. The capital-
   markets PDF/Excel is a **quarterly** time-series report (`cm_*_ttm_q` bounded
   by `cm_last_completed_quarter_end()`); converting it to rolling-12 is a
   focused rewrite of ~7 quarterly views + the PDF composer and is scoped
   separately to avoid bundling a chart-structure change into this batch.
2. **Dedup false-negatives.** A few genuinely-duplicate rows remain both `live`
   (e.g. property 28549: two $3.2M rows one day apart) — the dedup tick's
   `(property, price±$1k, month)` key missed them. Residual; tighten the dedup
   tick separately.
3. **Dedup false-positive risk (low).** The same key *could* merge two real
   same-month same-price sales on one property — rare in this asset class, and
   reversible (losers retained).
