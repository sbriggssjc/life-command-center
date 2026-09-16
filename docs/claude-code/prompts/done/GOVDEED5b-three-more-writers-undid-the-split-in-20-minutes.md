# GOVDEED5b — three sale propagators the split missed rewrote `latest_deed_date` on 3,310 properties twenty minutes after GOVDEED5 applied

**Filed:** 2026-09-16 (Cowork), measured live on gov (`scknotsqkcheojiaewwh`).
**Owner:** 👤 **government-lease** (`sql/` migration; PR #404's follow-up). ⛔ Nothing applied from LCC.
**Parent:** GOVDEED5 (`prompts/done/GOVDEED5-split-latest-deed-by-source.md`, gov PR #404).

## What happened

GOVDEED5 applied at **03:09:32 UTC** and reported, truthfully, `latest_deed_date` populated
2,401 → **43** and `latest_deed_grantee` 5,787 → 43. At **03:30 UTC** the pg_cron job
`gov-propagate-recompute-tick` ran `propagate_sales_recompute(48)`. Its candidate set is
`COALESCE(p.latest_deed_date, '1900-01-01') < lm.sale_date` — so every property GOVDEED5 had just
set to NULL qualified — and its write is `SET latest_deed_date = c.sale_date, …`. By 03:35:00
(the `updated_at` max) it had put a sale date back on **3,310** properties.

Live at 11:35 UTC, eight hours later:

| measurement | GOVDEED5 reported | live now |
|---|---:|---:|
| `latest_deed_date` populated | 43 | **3,340** (43 from a dated deed, **3,310** = a `sales_transactions.sale_date`) |
| `latest_deed_grantee` populated | 43 | **2,743** |
| `latest_transfer_*` populated | 5,373 (26 deed / 5,347 sale) | 5,373 — unchanged; the sale propagators do not write it |
| `v_owner_source_conflict` | 518 after GOVDEED-478 | **1,295** (view now reads `latest_transfer_*`; the re-planted grantees feed it) |

GOVDEED5 fixed three writers (`propagate_deed_to_property`, `gov_auto_resolve_intel`'s sale-sync
branch, `sync_properties_from_sources.py`). `pg_proc` shows **six** functions that write
`latest_deed_date`; the three it did not see:

| function | how it runs | writes |
|---|---|---|
| `propagate_sales_recompute(p_hours)` | pg_cron `gov-propagate-recompute-tick`, **03:30 UTC daily** | `latest_deed_date = sale_date`, `latest_sale_price`, `latest_sale_grantor`, grantee |
| `propagate_sale_to_property()` | **trigger** on `sales_transactions` | same shape, `NEW.sale_date >= COALESCE(latest_deed_date, '1900-01-01')` |
| `pse_propagate_sale_to_property()` | **trigger** on the PSE sales table | same shape |

Every one of them predates the split and treats `latest_deed_date` as "latest transfer date" —
which is precisely the semantic GOVDEED5 moved to `latest_transfer_*`.

## What to build

1. **Re-point the three** to the split: they write `latest_transfer_{date,party,source='sale',ref}`
   (newer-wins against the current `latest_transfer_date`, whatever its source) and **never**
   `latest_deed_*`. `latest_sale_price` / `latest_sale_grantor` semantics are theirs to keep.
2. **Re-run GOVDEED5's deed-only recompute** so `latest_deed_*` is again 43 / 43 (from dated,
   non-rejected bridged deeds only). Snapshot first, same table shape as
   `_gov_govdeed5_prior_latest_deed_20260916` with `reason='govdeed5b_recompute'`.
3. **Prove the cron cannot undo it:** run `propagate_sales_recompute(48)` by hand after step 2 and
   show `latest_deed_date` populated is still 43 and `latest_transfer_*` counts moved only if a
   newer sale exists. Then insert-and-roll-back a `sales_transactions` row in a transaction to fire
   the trigger and show the same.
4. **The writer inventory goes in the migration header**: all six functions, the cron job, both
   triggers, and the rule "only `propagate_deed_to_property` writes `latest_deed_*`". A test that
   greps `pg_proc` live (or the `sql/` tree) for `latest_deed_date\s*=` and fails on any function
   other than `propagate_deed_to_property` — positive control against the current state.
5. Re-measure `v_owner_source_conflict` after; report the count and the split by
   `latest_transfer_source`.

## Prohibitions

- ⛔ No value invented; no deed date derived from a sale.
- ⛔ Do not disable the cron or the triggers as the fix — sales must still propagate, to the right columns.
- ⛔ dia untouched; nothing applied from LCC.

## Reporting

The before/after table above with live numbers, the step 3 proof output, the writer inventory,
and the test's positive-control result. If any step was skipped, say so.
