# HCRIS-TIMEOUT-10 — add compare-before-write to the two unpatched write paths

**Repo root: `Dialysis` / `DialysisProject`** (this is Python write logic in the CMS ingestion pipeline, not a
`life-command-center` schema change — `life-command-center` owns Dialysis_DB's schema objects; this repo owns the
Python that writes rows into it).

> Renumbered from `HCRIS-TIMEOUT-9` to `HCRIS-TIMEOUT-10` — a different round-9 prompt (based on a since-corrected
> hypothesis that this arc and `DIA-PROPAGATOR1` were the same process) was sent and answered first. That response
> is reconciled in `docs/claude-code/responses/done/HCRIS-TIMEOUT-9-wrong-function-hypothesis-and-dia-propagator1-merge.response.md`
> — it fixed a real but different, already-mostly-resolved problem (a defense-in-depth watchdog on `DIA-PROPAGATOR1`'s
> already-fixed weekly job) and does not touch this arc's actual symptom. This prompt is unchanged from its original
> drafting except for this note and the added day-of-week evidence below.

## Context

`HCRIS-TIMEOUT` has been chased for nine rounds as a hang / silently-swallowed-`StepTimeout` problem. Rounds 1-8
found and fixed several real bugs of that shape — and every fix was correct — but the pipeline still runs 16-24+
hours every day, colliding with the next day's cron trigger (`ingestion_tracker` confirms `cms_medicare_clinics`
runs for 09-19 and 09-20 both closed out as `run_status: failed`, reclaimed after running the full ~24h without
finishing on their own; 09-21 has two overlapping runs; 09-22 shows a fresh run already 6+ hours in as of this
writing).

**Confirmed independently, day-by-day**: the 16-25h/zero-`StepTimeout` pattern has now occurred on Tuesday,
Wednesday, Thursday, Friday, Saturday, Sunday, and Monday — every day of the week, across 8+ consecutive days.
This rules out any theory pinned to a weekly-only trigger and confirms the pipeline itself (the Railway daily cron,
not a separate weekly job) is where the real problem lives.

The actual root cause, found 2026-09-21 by reading the code directly: **neither of this pipeline's two write paths
has any compare-before-write logic.** Every daily run rewrites the entire dataset unconditionally, whether or not
any value actually changed. That is real, unthrottled work — not a hang — which is why no `StepTimeout` has ever
fired and never will while this stays unfixed.

## The two write paths that need it

1. **`src/propagate_property_financials.py`, `propagate_financials_to_properties()`** — the write loop (~line 605)
   calls `supa.table("properties").update(update).eq("property_id", pid).execute()` for every property in
   `all_updates`, unconditionally, every run.
2. **`src/utils_shared.py`, `update_row()`** — used by `ingest_medicare_clinics.py` for `properties` /
   `facility_patient_counts` writes. It already special-cases `leases` and `sales_transactions` with an
   existing-row fetch, but every other table (`properties` included) skips straight to `_exec_update()` with no
   comparison at all.

## The fix already exists — reuse it

`DIA-PROPAGATOR1`'s fix (PR #7421, already merged in this repo) built and tested `src/compare_before_write.py` for
exactly this problem, for a different pipeline (`full_data_propagator.py` / `database_updater.py` /
`financial_estimate_tracker.py`). Read that module and its tests
(`tests/test_dia_propagator1_compare_before_write.py`) first. Wire the same comparison logic into:

- `propagate_financials_to_properties()`'s write loop — skip the `.update()` call (and don't count it toward
  `properties_updated`) when the computed `update` payload has no field that actually differs from the current row.
- `utils_shared.update_row()` — for `properties` (and ideally any other table beyond `leases`/`sales_transactions`
  that doesn't already have a domain-specific reason to skip this), fetch the existing row and drop fields from
  `filtered_updates` that already match, short-circuiting to a no-op result when nothing is left — mirroring what
  `sales_transactions`' `changed_sale_fields` check already does structurally, but actually skipping the write
  instead of just tracking which fields changed for trigger purposes.

## What "done" looks like

- A run against real data writes only to properties whose derived fields actually changed, not the whole fleet.
- `properties_updated` for a `propagate_financials_to_properties()` run should be small on a normal day (only the
  properties with a genuinely new HCRIS/CMS value), not close to the full property count.
- The daily `cms-ingestion` run should finish in well under the 2-hour `reclaim_stale_started_runs` window on a
  typical day (first run after deploy may still be larger while it establishes a baseline — that's expected and fine).
- Existing HCRIS-TIMEOUT regression tests (340+ from rounds 6-8) should still pass; add tests asserting a no-op
  write is actually skipped for both paths.

## Explicitly not in scope for this round

Do not touch the `StepTimeout`/exception-handling machinery rounds 6-8 built — it is correct and should stay. Do
not touch `src/long_run_watchdog.py` or `run_full_data_propagation()` — that's `DIA-PROPAGATOR1`'s already-fixed
job, unrelated to this pipeline (confirmed by round 47's code trace). This round is additive: stop doing
unnecessary writes in `HCRIS-TIMEOUT`'s own two write paths, not change how failures are reported.

## Verify on

- A live run's `properties_updated` count for a typical day, well below the full property count.
- The run finishing inside the 2-hour reclaim window (first post-deploy run may run longer while establishing
  baseline — note that plainly rather than treating it as a failure).
- `facility_cost_reports` finally advancing past `2026-03-16` once the pipeline has headroom to reach that step.
- New tests proving the no-op skip for both write paths, cheaply, without requiring a multi-hour production run.
