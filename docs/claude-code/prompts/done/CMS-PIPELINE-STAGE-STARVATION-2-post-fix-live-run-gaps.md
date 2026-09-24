# CMS-PIPELINE-STAGE-STARVATION-2 — the first post-fix run mostly worked, but left five specific gaps

**Repo root: `Dialysis` / `DialysisProject`.**

## Context

PR #7427 (branch `claude/great-hawking-8yu0q2`) is deployed. Scott confirmed it directly and triggered a fresh
`cms-ingestion` run at 2026-09-24 13:55 UTC to test it live. That run finished on its own — `finish_run()` closed
its tracker rows, not the next day's reclaim sweep — in **1h14m**, versus the 15-24h every prior run has taken.
`facility_deficiencies` (+25,837 rows) and `qip_scores` both got their first fresh writes since 2026-05-16.
`ratings`/`clinic_quality_metrics` stayed clean. This is real, independently-verified progress on both problems
this arc set out to fix.

But five things in that same run's own evidence don't match what "fixed" should look like, and none of them were
addressed by #7427. Confirm each one is real (not a monitoring artifact — this session has misread this pipeline's
evidence twice already this arc) and fix what's fixable.

**Gap 1 — `facility_patient_counts`'s staged-intake queue did not move.** The table itself is still frozen at
2026-08-31. Its tracker row's `notes` show `staged_intake_status_counts: {queued: 994, processing: 0,
review_required: 0, ready_for_promotion: 0, promoted: 2, promotion_failed: 0}` — identical before and after the
run, `promoted` stuck at 2. The lock/tracker-close bug is fixed (the row closed `success` this time), but whatever
drains that staging queue into the real table isn't running, or isn't running far enough. Trace it.

**Gap 2 — `clinic_financial_estimates` had zero writes the entire run.** `backfill_financials` was supposed to go
from ~9h to minutes, not to zero activity. Confirm whether the compare-before-write fix correctly found nothing to
update (plausible — the pre-fix code had just finished an unconditional full rewrite hours earlier, so the data
may have genuinely been current) or whether the step is silently no-op'ing / not being reached at all. Don't
guess — read the code path and/or the run's own step log.

**Gap 3 — `medicare_ingestion` (CMS facility listing) is still not writing.** `medicare_clinics.source_last_seen`
is still frozen at 2026-08-31, unchanged by this run. This is the item CC's prior response flagged ("still
skipping, since about 2026-09-12, blocked by the pipeline's own open tracker row") and explicitly did not fix.
Fix it this round if it's the same lock-scoping issue `start_run()`'s fix should have already resolved — confirm
whether it's actually the same cause or something new.

**Gap 4 — the run closed `run_status='partial'`, not `'success'`.** Explain what condition produces `'partial'`
and whether that's the expected/correct outcome for this run (e.g. because of gaps 1-3 above) or itself a bug.

**Gap 5 — the `notes` field looked cross-contaminated between tracker rows.** The `facility_patient_counts` row
and the `cms_medicare_clinics` row for this same run both showed the exact same `staged_intake_status_counts` JSON
in their `notes` column. Confirm whether `notes` is being written to the correct row per dataset, or whether
there's a shared/global object being serialized into both rows regardless of which dataset it actually describes.

## Also confirm, lower priority

**`investment_targets` tripped the CB3 circuit-breaker class.** 542 `circuit_open:('upsert', 'investment_targets')`
errors landed in a single ~12ms burst at 14:31:34 UTC during this run, then stopped — the same
`Prefer: return=minimal`-overrides-`resolution=merge-duplicates` defect already fixed on six other tables
this arc (`ratings`, `clinic_quality_metrics`, `qip_scores`, `facility_deficiencies`, `facility_cost_reports`,
`facility_economics`), now confirmed live on a seventh table nobody had looked at. This is exactly the risk
`RATINGS-CQM-CB3-upsert-class` was filed for (133 call sites repo-wide, never fixed as a class). Fix
`investment_targets` specifically this round using the same `postgrest_prefer.py` helper; whether to finally do
the class-wide fix is your call to make and justify either way.

**Two small, likely-unrelated errors also appeared mid-run**: a `23502` null-constraint violation on `bd_flags`
inserting into `alerts_unified` (`entity_type` null) at 15:03:57 UTC, and a `23505` duplicate-key collision on
`recorded_owners.recorded_owners_name_key` at 15:04:45 UTC. These table names don't match anything else in this
CMS-ingestion arc — confirm whether they're actually part of this pipeline or a different scheduled job that
happened to run in the same window. If they're unrelated, say so and leave them for a separate prompt; don't
spend real time on them this round.

## Explicitly not in scope for this round

Don't re-touch `ratings`/`clinic_quality_metrics`/`facility_deficiencies`/`qip_scores`'s write logic — all four are
confirmed working live in this exact run. Don't re-litigate `backfill_financials`'s compare-before-write design
(Gap 2 is about confirming it behaved correctly this run, not redesigning it) unless you find it's actually
broken. Don't take on `RATINGS-CQM-CB3-upsert-class`'s full 133-call-site sweep unless you judge it's now worth
doing — that's a real scope decision, not an assumed yes.

## What "done" looks like

- Each of Gaps 1-5 has a concrete, evidence-based answer — traced through code and/or live data, not inferred
  from a single run's numbers alone.
- `facility_patient_counts`'s staging queue either has a fix in hand, or a clear explanation of what's blocking
  promotion and why it's out of scope this round.
- `medicare_ingestion` is fixed if it's the same root cause already addressed elsewhere; documented plainly if
  it's genuinely something new.
- `investment_targets` is fixed the same way the other six tables were.
- A second live run (the next scheduled or a manually triggered one) is the actual test — note in the response
  whether one happened during this round and what it showed.

## Verify on

- `facility_patient_counts`'s and `medicare_clinics`'s actual row/timestamp movement after any fix, not just
  tracker `run_status`.
- Whether `clinic_financial_estimates` writes on the *next* run (this run's zero-write result alone doesn't prove
  either theory in Gap 2).
- Whether `ingestion_run_errors` shows any further `circuit_open` on `investment_targets` after the fix.
