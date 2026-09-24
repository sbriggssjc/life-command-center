# CMS-PIPELINE-STAGE-STARVATION — facility_patient_counts appears inert, and properties starves every downstream table

**Repo root: `Dialysis` / `DialysisProject`.**

## Context

The `RATINGS-CQM-CIRCUIT-BREAKER` saga (three rounds, PRs #7424/#7425/#7426) is now confirmed live: `ratings` and
`clinic_quality_metrics` have each held zero errors across two consecutive daily runs. `HCRIS-TIMEOUT-10`'s
`properties` compare-before-write (PR #7423) is also error-free, but a full error catalog across the whole
`cms-ingestion` pipeline (requested by Scott, run 2026-09-24) surfaced two separate problems that are **not**
about errors — nothing is throwing, nothing is circuit-breaking. They're about scope and scheduling, and they
explain why several tables in this pipeline have been stale for months despite the pipeline "running" every day.

**Problem 1 — `facility_patient_counts` looks completely inert.** Every daily trigger creates two `ingestion_tracker`
rows seconds apart: one for `dataset_id='cms_medicare_clinics'` and one for `dataset_id='facility_patient_counts'`.
The `cms_medicare_clinics` row is the one doing all the visible work (ratings, clinic_quality_metrics, properties).
The `facility_patient_counts` row also shows `run_status='started'` every single day — but the `facility_patient_counts`
table itself has not been written to since **2026-08-31**, over three weeks ago as of this writing, across every run
since. Confirm directly whether that dataset's ingestion code path is actually being invoked at all, and if so, find
where it's silently doing nothing (returning early, failing a precondition check without logging, awaiting something
that never resolves, etc.) — don't assume it's "just slow" the way `properties` is, since three-plus weeks of zero
writes with zero errors logged is a different shape than a slow burn.

**Problem 2 — `properties` monopolizes the entire run, starving everything scheduled after it.** Live-monitored across
a full run (2026-09-23 18:06 UTC → reclaimed 15h26m later): `properties` writes decelerated steadily throughout the
run (~1,500 rows/hour early on, down to ~30-55/hour by the end) without ever erroring, and the run's tracker rows were
never closed by the application itself — it took the next day's scheduled reclaim to end it. A second run (2026-09-24
06:02 UTC) moved faster but still hadn't reached 100% after several hours. Whatever runs after `properties` in this
pipeline — confirmed via direct table checks — has not been reached by any run in a long time:

- `facility_cost_reports`: frozen since **2026-03-16** (this is the original data `HCRIS-TIMEOUT` was trying to get
  written — six-plus rounds of exception-handling fixes never actually got the pipeline far enough to test whether
  those fixes even matter, because `properties` alone eats the whole run).
- `facility_deficiencies` and `qip_scores`: both frozen since **2026-05-16**, same day — almost certainly the same
  downstream step, never reached since.
- `facility_payer_mix`: **zero rows, ever** — confirm whether this is dead/unused code or a genuine gap that was
  never wired up.

Read the actual pipeline orchestration code (whatever decides the order of `properties` → cost reports → deficiencies
→ QIP → payer mix, and how/whether each stage is gated on the prior one finishing) before proposing a fix. Don't
assume the current serial ordering is a bug to blindly break apart — there may be a real dependency reason `properties`
has to go first (e.g., downstream steps need a `property_id`/`medicare_id` link that `properties` establishes). Confirm
that dependency exists, or confirm it doesn't, rather than assuming either way.

## What "done" looks like

- `facility_patient_counts`'s actual code path traced and explained: is it running at all, and if so, why hasn't it
  written anything in three-plus weeks? Fixed if it's a real bug; documented plainly if it turns out to be intentional
  (e.g., a feature flag, an upstream source that's gone stale) — either way, stop leaving Scott with a tracker row that
  implies work is happening when it isn't.
- A concrete, evidence-based answer for why `properties` decelerates over the course of a run (batching behavior,
  per-row round-trip cost, growing lookup tables, rate limiting, connection pool exhaustion — whatever it actually is,
  confirmed by reading the code and/or profiling, not guessed from the write-rate curve alone).
- A real proposal (not necessarily implemented this round if it's large) for how `facility_cost_reports`,
  `facility_deficiencies`, and `qip_scores` can get regular fresh runs even while `properties` takes many hours —
  whether that's running them as independent, differently-scheduled jobs, giving `properties` a time budget so later
  stages always get a turn, or something else. If a real dependency blocks decoupling them, say so and propose the
  next-best mitigation instead.
- If time allows: confirm whether `facility_payer_mix` is meant to be populated by this pipeline at all, and if so,
  why it never has been.

## Explicitly not in scope for this round

Don't touch the `ratings`/`clinic_quality_metrics` write logic (PRs #7424/#7425/#7426 are confirmed working live) or
re-litigate `properties`'s compare-before-write correctness (PR #7423 is error-free so far) — this round is about
*scheduling and reach*, not correctness of the writes that do happen. Also don't fix `RATINGS-CQM-CB3-tracker-close`
(the finish_run()-never-called gap) as part of this round unless it turns out to be the same root cause as the
`properties` starvation problem — if it is, say so explicitly; if it's genuinely separate, leave it filed as its own
item.

## Verify on

- `facility_patient_counts`'s actual invocation: does the run actually call into that dataset's ingestion function,
  and what happens inside it.
- A live run's `properties` write-rate curve compared against whatever the code suggests should be happening
  (batch sizes, sleep/backoff calls, connection reuse).
- Whichever proposal you land on for downstream-stage scheduling: does it actually get `facility_cost_reports`,
  `facility_deficiencies`, or `qip_scores` fresh writes on the next run, or does it just move the starvation
  somewhere else.
