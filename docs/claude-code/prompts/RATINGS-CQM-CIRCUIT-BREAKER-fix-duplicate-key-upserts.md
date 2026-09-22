# RATINGS-CQM-CIRCUIT-BREAKER — fix the duplicate-key inserts tripping the circuit breaker on `ratings` and `clinic_quality_metrics`

**Repo root: `Dialysis` / `DialysisProject`.**

## Context

Found 2026-09-22 during a full error/block catalog of the CMS ingestion pipeline (requested by Scott to get the
pipeline "completely unlocked and operating as designed"), separate from and much older than the `HCRIS-TIMEOUT`
arc. It has been visible in nearly every `HCRIS-TIMEOUT` round's evidence as "the usual 15-17 minute startup
burst" but has never itself been root-caused or fixed.

**What's happening, confirmed live against `ingestion_run_errors` and the two tables themselves:**

Every `cms-ingestion` run, within the first ~13-17 minutes, hits a burst of:

- `23505 duplicate key value violates unique constraint "ratings_medicare_id_uidx"` — 2,607 occurrences since
  2026-06-24.
- `23505 duplicate key value violates unique constraint "clinic_quality_metrics_medicare_snapshot_uidx"` — 743
  occurrences since 2026-09-12.

Each duplicate-key failure appears to trip a circuit breaker, after which **every further write to that table is
silently dropped for the rest of that run, every run**:

- `circuit_open:('insert', 'ratings')` — 218,684 rows, 2026-06-24 → today.
- `circuit_open:('insert', 'clinic_quality_metrics')` — 26,874 rows, 2026-09-12 → today.

That's 248,913 of the ~249,000 total rows in `ingestion_run_errors`, essentially the entire error table, and all
of them are still `review_status='new'` — never triaged as their own item.

**Confirmed impact**: `ratings` is stuck at exactly 7,013 rows total; `clinic_quality_metrics` at 7,555. Both are
frozen at today's startup-burst timestamp (14:24:27 / 14:24:22 UTC) with zero writes in the hours since. If this
pattern has held since 2026-06-24 (`ratings`) / 2026-09-12 (`clinic_quality_metrics`), these two tables have
likely never received more than their first ~13-17 minutes' worth of writes on any run in that entire window —
whatever the intended full dataset size is, these tables are probably a small, stale fraction of it.

## Likely root cause

The duplicate-key error text (`already exists` on the unique index, not a not-null or type error) strongly
suggests the writer is doing a plain `insert` for these two tables instead of an upsert with the right
`on_conflict` target — the exact same bug class this repo already fixed once for a different table
(`uq_hcad_stage_acct_year` in the `OWNERGAP2-harris` work: PostgREST infers the conflict arbiter from the
declared unique constraint only when `on_conflict=<columns>` is explicitly passed; without it, `Prefer:
resolution=merge-duplicates` alone isn't enough and the insert 23505s). Read that fix and its migration
(`uq_hcad_stage_acct_year`) for the pattern, then confirm (don't assume) it applies the same way here — the two
target constraints are `ratings_medicare_id_uidx` and `clinic_quality_metrics_medicare_snapshot_uidx`; find and
read both index definitions to get their exact column lists before writing the fix.

**Separately worth checking**: `RATINGS2`/`CQM1` (already merged, per `PLANNED-BACKLOG.md`) fixed a related-sounding
probe-count issue on these same two tables (844 probe calls/30s down to 36 in the first minute, then zero) —
confirm whether that fix's scope already touches this insert path or is a genuinely separate mechanism. Don't
assume they're the same fix just because they touch the same tables.

## What "done" looks like

- Both `ratings` and `clinic_quality_metrics` writes use a real upsert with the correct `on_conflict` column list
  matching each table's actual unique constraint — confirmed against the live constraint definition, not assumed
  from the index name.
- A live run shows `ratings`/`clinic_quality_metrics` writes continuing past the ~15-minute mark instead of
  stopping — row counts in both tables should climb well past today's frozen 7,013 / 7,555, and `updated_at` on
  existing rows should actually move when source data changes (not just new inserts).
- `circuit_open`/`23505 duplicate key` errors on these two tables stop appearing in `ingestion_run_errors` for
  future runs.
- New tests proving the on_conflict fix works, without requiring a multi-hour production run — a fast unit-level
  proof against a fake Supabase client is fine, per this repo's own established pattern for this class of fix.

## Explicitly not in scope for this round

Do not touch `HCRIS-TIMEOUT`'s own write paths (`update_row()`, `propagate_financials_to_properties()`) or the
compare-before-write logic `HCRIS-TIMEOUT-10` just added (PR #7423) — this is a different table, a different
error class (duplicate-key insert, not a swallowed timeout), and a different, much older bug. Keep this fix
scoped to `ratings` and `clinic_quality_metrics` only.

## Verify on

- Live constraint definitions for `ratings_medicare_id_uidx` and `clinic_quality_metrics_medicare_snapshot_uidx`
  (exact column lists), quoted directly rather than inferred from the name.
- A live run's `ratings`/`clinic_quality_metrics` write count past the 15-minute mark — should be nonzero and
  growing, not flat.
- Whether `RATINGS2`/`CQM1`'s already-merged fix overlaps this one, stated plainly either way.
