# PRI6 — `ingestion_lock` rows survive a mid-run Railway redeploy for 17.9+ hours; `PRI5`'s 2-hour reclaim safety window assumes a wall-clock cap this run disproves

**Repo: `Dialysis` (`sbriggssjc/dialysis`).** Filed here (`life-command-center`) per the established
convention for this arc. **Not a crash and not a hang — the pipeline is confirmed live and productive right
now.** This is a gap in `PRI5`'s own stated safety assumption, found by checking a genuinely long-running
production run against it, not a new failure mode.

## 0. What happened — read this before assuming it's another hang

Scott reported a CMS ingestion run as roughly 10 hours in when a `Dialysis` redeploy interrupted it, and
the resumed run now roughly 7+ hours in on its own, asking if it's on track.

**Confirmed live, independent of the log excerpt (which was only a 19–22 second snippet each time)**:
`properties.estimated_annual_revenue` shows a newest `updated_at` essentially at "now" (under 1 second old
at query time) with **1,923 rows updated in the preceding 15 minutes**. The pipeline is genuinely alive and
writing real output right now. This is good news, not a new bug.

**The gap**: two `ingestion_lock` rows — one for `cms_medicare_clinics`, one for `facility_patient_counts`
— are still `run_status='started'`, `finished_at=null`, at **17.9 hours old**, both acquired at
`2026-09-11 19:45:55 UTC`. `PRI5`'s response justified its `reclaim_stale_started_runs()` 2-hour age
threshold by stating rows past that window are "well past the pipeline's own 90-minute wall-clock cap, so a
genuinely in-flight run's row can never be touched." **This run is direct evidence that assumption is
false**: it is genuinely in-flight (confirmed by live writes above) at nearly 18 hours, roughly 12× the
assumed 90-minute cap.

**A second, separate observation worth checking, not assuming**: no `ingestion_tracker` or `run_log` row of
any kind has a `started_at`/`created_at` newer than `2026-09-11 19:45:55 UTC` — the same instant the two
still-open lock rows were acquired — even though Scott reports a `Dialysis` redeploy happened in between
that stretch. If the redeploy restarted the process actually running this ingestion, a fresh `start_run()`
and/or `acquire_ingestion_lock()` call should have logged something new. It didn't. Two explanations are
consistent with what's visible from here, and this session cannot distinguish between them: (i) the
redeploy restarted a different Railway service than the one holding this lock and running this ingestion,
or (ii) the resumed process detected the lock/tracker row already existed and reused it rather than
re-acquiring/re-logging — which, if true, is itself worth knowing since it would mean a redeploy silently
continues holding a stale lock indefinitely rather than cleanly restarting the run.

## 1. The catalog

**(a) Decide what `reclaim_stale_started_runs()`'s safety window should actually be, now that a real run
disproves the "90-minute cap" assumption it was built on.** Read the actual code for what determines how
long a `cms_medicare_clinics`/`facility_patient_counts` run can legitimately take — is there truly a hard
cap enforced somewhere, or was the "90-minute" figure itself just an observation from past runs, not an
enforced limit? If there's no real cap, age alone cannot safely distinguish "orphaned" from "just a very
long run" — the fix needs some corroborating signal (e.g., checking for recent related writes, like this
session did manually against `properties.updated_at`, or a heartbeat-style touch on the lock row) rather
than pure age. Propose and implement whichever is truest to the existing design, and explain why.

**(b) Determine what actually happens to an `ingestion_lock` row across a Railway redeploy of the process
holding it.** Does the resumed process call `acquire_ingestion_lock()` again on startup? If so, what does
that call do when it finds an existing `started` row for the same `dataset_id` — deny, force-reclaim, or
silently proceed without updating it? Get the actual answer from the code, not a guess, and report which
of the two explanations in Section 0 (different service vs. reused stale lock) is actually happening.

**(c) If (b) finds that a redeploy can leave a lock silently un-released and un-reacquired, decide and
implement the right behavior.** Likely candidates, in order of how well they fit the existing design (read
the code before picking, same standing instruction as every prior round): release the lock explicitly as
part of graceful shutdown handling if the process has one; or acquire a *fresh* lock row on every process
start regardless of what's already there, and treat an old one crossing (a)'s revised safety threshold as
reclaimable by the mechanism from (a). Don't invent a third mechanism if one of these already fits.

## Out of scope

- The pipeline's actual ingestion logic, `ownership_linker`, `oig_leie_ingestor`, `census_demographics` —
  all confirmed unaffected and out of scope for this round.
- No retention/deletion of any rows in any table.
- No `life-command-center` code changes — entirely in `Dialysis`.
- Don't assume this run is unhealthy or try to kill/restart it — it is confirmed actively writing real
  data right now. This is about the lock/tracker bookkeeping and the reclaim safety assumption, not the
  run itself.

## Verify on

- (a): the actual current code determining (or not) a hard time cap, quoted verbatim; whatever new
  safety signal is chosen, explained and applied; live before/after against the two open lock rows
  described here (they should remain untouched if genuinely still in-flight, or close out correctly if
  they're not — state plainly which this session's check shows for these two specific rows).
- (b): a plain, direct answer on what `acquire_ingestion_lock()` does when called against an existing
  `started` row for the same `dataset_id` — not a general description of intended behavior, the actual
  code path.
- (c): the fix applied, and a clear statement of which of the two Section-0 explanations turned out to be
  correct for this specific incident, or an honest statement if it can't be determined from the code alone.
