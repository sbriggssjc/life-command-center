# PRI6-ingestion-lock-survives-redeploy-and-reclaim-safety-window — response (transcribed 2026-09-12)

> Recovered from Scott's own saved transcript (`"PRI6 surface response.docx"`, untracked,
> `docs/claude-code/responses/`) — same recovery method as the rest of this arc. **Repo: `Dialysis`. This
> session verified this against the transcript AND an independent live query against `ingestion_tracker`
> in Dialysis_DB.** Both of Section 0's hypotheses turned out wrong — the session found the real mechanism
> instead of picking between the two guesses, and it is a materially bigger finding than the prompt framed.

## (a) No real time cap exists — confirmed, not assumed

`CMS_ORPHAN_RECLAIM_HOURS` (2h, `PRI5`) and `DEFAULT_STALE_HOURS` (6h) both rested on the same "~90 minute"
observation of past runs, never an enforced limit — that budget is env-tunable for catch-up runs, and the
run-timeout check only blocks *launching* the next step, never preempts one already in flight. Live proof:
`medicare_ingestion` genuinely ran 17.9+ hours, actively writing to `properties` the whole time (confirmed
independently by this session too, via direct query, writes under 1 second old).

**Fix**: a new `probe_recent_activity()` — any reclaim, whether age-based or an explicit `force=True` call,
is now corroborated against a real recent write to the dataset's own table before the row is touched. Age
alone is no longer sufficient to distinguish "orphaned" from "genuinely still running."

## (b) The actual `acquire_ingestion_lock` behavior — the real root cause, not a guess

With `force` resolving true, the function unconditionally marks the existing `started` row `failed` and
opens a new one — no age check, no self-exclusion. The mechanism making `force` true on every call:
`ingest_medicare_clinics()` calls `acquire_ingestion_lock(force=force or force_refresh)`, and **the daily
production entry point hard-codes `force_refresh=True` on every single call** — so every day's scheduled
run force-reclaims the very row it just opened seconds earlier. Caught live: three
`"Reclaimed by ingestion_lock (force)"` events, including one row reclaiming itself **0.0 hours** after
creation.

## (c) Both root causes fixed — neither of Section 0's two hypotheses was correct

This was one continuous process the entire time (started 2026-09-11 19:45:43 UTC, ~18h runtime by the time
of this response) — its own startup self-reclaimed its own lock row via the `force_refresh` bug above, then
kept running completely unaffected by that reclaim. Separately, a second, distinct defect:
`facility_patient_counts`'s lock never closes on success because `release_ingestion_lock(status="success")`
sits in an unreachable `else:` clause after a `return` inside a `try` block (verified with a 3-line Python
repro) — confirmed live as a completed no-op (0 new rows in 18h), not a stall.

## The bigger picture, found by cross-referencing a parallel session's own live check

A parallel `life-command-center` documentation session, the same day, independently re-verified
`cms_ingestion` live (`B6d-cms-restart`, commit `2346713e`) and found it **failing 34 of 36 runs in the
last 30 days**, `last_success_at` frozen at **2026-04-04** — five months — with
`medicare_clinics.source_last_seen` stuck at 2026-08-31 (2.9% refreshed) for 12 days, and recent failures
reading exactly `"Reclaimed by ingestion_lock (force) after 0.0h in 'started'"`. That is this exact bug,
hitting the daily production schedule for months — not a one-off tied to this single long run. `PRI6`'s fix
is a materially bigger deal than either the prompt or this session initially framed it as.

## Test results

12 new tests (`test_pri6_lock_reclaim_safety.py`). **8 of 12 independently confirmed to go red against
pre-fix code** (mutation-style check, run before crediting the fix) — the other 4 are correctly-green
positive controls (`test_release_failed_still_runs_and_raises`, `test_explicit_force_still_reclaims`, and
two reclaim-without-corroboration tests), by design. Full suite: **3,131 passed, 0 failed**.

## Files changed

`ingestion_lock.py` (+116/-5), `run_cms_ingestion.py` (+28/-5), `ingest_medicare_clinics.py` (+12/-1),
`patient_count_ingestor.py` (+16/-5), `test_pri6_lock_reclaim_safety.py` (+406/-0).

## Live re-check performed by this session before filing this review

The two `ingestion_lock` rows this arc has been tracking (`8c9978b3…` `cms_medicare_clinics`,
`3093e28a…` `facility_patient_counts`) are still open at ~19 hours old — correct and expected, since the
fix has not yet reached this already-running process (no redeploy has happened) and this arc's discipline
never touches live rows without Scott's own trigger. `properties.estimated_annual_revenue` still shows real
recent writes (992 rows in the trailing 15 minutes at last check) — the run itself remains healthy,
unaffected by any of this.

## Delivery

Commit `6d70b84` (amended after a backtick-stripping shell issue on the first commit message attempt), PR
`sbriggssjc/Dialysis#7409` opened. **Merge status unconfirmed** — same recurring pattern as every prior
round: Scott's "This PR is merged" needs to be confirmed as covering this specific `Dialysis`-side PR, not
just the `life-command-center` documentation PR that filed this review.
