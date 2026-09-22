# HCRIS-TIMEOUT-9 (wrong-function-hypothesis / DIA-PROPAGATOR1 merge) — response (transcribed 2026-09-22)

> Recovered from Scott's own saved transcript (`"HCRIS timeout round 9 surface response.docx"`, untracked,
> `docs/claude-code/responses/`). **Repo: `Dialysis`/`DialysisProject`.**
>
> **Important reconciliation note, added by this session, not CC's**: this prompt was built on this session's
> own 2026-09-21 hypothesis that `HCRIS-TIMEOUT` and `DIA-PROPAGATOR1` were the same process (based on an edge-log
> IP-org match). A **parallel Cowork session (round 47, same day) independently traced the actual code and found
> they are two separate write paths** — see `PLANNED-BACKLOG.md`'s `HCRIS-TIMEOUT` row and STATUS.md's round 47
> entry. Round 47's read is better evidenced (direct code trace, not network inference) and is independently
> confirmed by this session's own day-of-week check: the 16–25h/zero-timeout pattern recurs on **every day of the
> week** (Tue through Mon, 8 consecutive days checked), not just Sundays — which is inconsistent with this
> response's root cause (a weekly Sunday-only job) being the *primary* explanation for `HCRIS-TIMEOUT`'s daily
> pattern. This response's fix is real and worth keeping, but it fixes a different, already-mostly-resolved
> problem (see below), not `HCRIS-TIMEOUT` itself.

## What CC reports

**Branch:** `claude/hcris-timeout-9-watchdog` (pushed, no PR opened — CC gave manual merge instructions instead).

**(a) Real entry point found**: confirms `propagate_financials_to_properties()` is correctly `SIGALRM`-wrapped
(settling round 8's question), but reports it's "structurally incapable of writing a clinic-less property" and
that 2,793 of 10,140 properties written since 07:00 UTC that day had no linked `medicare_clinics` row — read as
evidence of a different, full-fleet pass. Names the actual long-running culprit as `run_scheduler.ps1` →
`schedule_tasks()` → **Sunday 02:45** → `run_full_data_propagation()` → `run_with_retries(propagate_all_existing_data)`
— no timeout of any kind, running on a background thread where `SIGALRM` can't fire, with `run_with_retries`
defaulting to `retries=3` (silently restarting a failing pass from scratch up to 3×, offered as the explanation for
observed runtimes clustering at 16–25h ≈ 3 × 8–11h).

**This is very likely describing the same job `DIA-PROPAGATOR1` already fixed** (round 48, PR #7421, confirmed
merged and live, cadence changed to `schedule.every().sunday.at("02:45")` — matching this response's "Sunday 02:45"
exactly) rather than a newly-discovered problem.

**(b) Fix applied**: new `src/long_run_watchdog.py` — real `SIGALRM` on the main thread, falling back to a
`threading.Timer` + async-exception injection off the main thread, since the propagation job runs on a daemon
thread where a bare `run_with_timeout()` would have been silently inert (caught by CC before shipping). Wired into
`run_full_data_propagation` with a 12h budget, retries dropped to 1 for that path. 12 new tests, mutation-verified.
A reasonable defense-in-depth addition on top of round 48's already-merged compare-before-write fix — not harmful,
but not solving an open problem, since compare-before-write should already keep this job's runtime short.

**(c) Concurrency**: `acquire_ingestion_lock()` confirmed genuinely racy (SELECT-then-INSERT, no atomicity, fails
open). The specific 06:04:50/06:04:55 tracker-row pair this session flagged turned out to be one invocation writing
two rows under different `dataset_id`s (not a race) — but true same-`dataset_id` races were found elsewhere,
4.9–12s apart, and the lock's 30-minute TTL against an 8–11h job means concurrent full-fleet passes remain possible
today. **Not fixed, correctly flagged.**

**(d) `learning_logs`**: confirms directly what this session had already independently found — the schema-miss
logging was moved from `learning_logs` into aggregated `ingestion_run_errors` rows by `DIA-PROPAGATOR1`'s own fix,
cutover exactly matching `max(created_at) = 2026-09-19 13:07:08`. Volume moved, not vanished — `ingestion_run_errors`
took ~124k rows in 10 days.

**(e) Standing recommendation**: confirms all three of `DIA-PROPAGATOR1`'s round-45 recommendations are already
shipped and live — compare-before-write (1–18 rows/day now vs 10,150 unthrottled), capped schema-miss logging,
`true_owner_id` already dropped from this writer's output. Nothing further needed there — corroborates round 48's
independent closure of `DIA-PROPAGATOR1`.

**Open items CC disclosed rather than hid**: which OS process is running right now is unproven from DB data alone
(the fixed job is weekly-Sunday; the check was run on a Tuesday); the step heartbeat still isn't landing despite an
earlier round claiming to fix it; `acquire_ingestion_lock()` is still racy (out of scope this round, documented).
Full test suite: 3,326 passed / 9 failed, confirmed pre-existing on `origin/main` in isolation (neutral change).

## Independent verification performed by this session

- **Corroborates, rather than conflicts with, round 48's `DIA-PROPAGATOR1` closure**: the "Sunday 02:45" cadence and
  the "compare-before-write already live, 1–18 rows/day" finding both independently match round 48's own
  code-read and live-Supabase verification. Good cross-confirmation between two unrelated Claude Code sessions.
- **Does not explain `HCRIS-TIMEOUT`'s actual symptom.** Queried `ingestion_tracker` directly for every run since
  2026-09-15 with its day-of-week: the 16–25h/zero-`StepTimeout` pattern this arc exists to fix occurred on **Tue,
  Wed, Thu, Fri, Sat, Sun, and Mon** — literally every day, including a run in progress again as of this check
  (started Tue 2026-09-22 06:04:34 UTC, ~6h in). A job that only fires weekly on Sunday cannot be the primary cause
  of a pattern recurring on all seven days. `facility_cost_reports` remains frozen at `2026-03-16` (94,473 rows,
  unchanged) and a direct count against `ingestion_run_errors` since 09-18 still shows zero timeout-related errors
  out of 44,108 total. **The core symptom this ten-round arc exists to fix is unchanged by this response's fix.**
- **Round 47 (parallel session, same day) independently traced the actual code** and found the real cause: neither
  of `HCRIS-TIMEOUT`'s own two write paths (`ingest_medicare_clinics.py`'s `update_row()`, and
  `propagate_financials_to_properties()`) has compare-before-write logic — a full, unthrottled rewrite of the whole
  dataset every single day, which matches the every-day-of-the-week pattern exactly. A prompt for this was already
  drafted (`prompts/HCRIS-TIMEOUT-9-compare-before-write.md`) but not yet sent to CC — renamed and queued as
  `HCRIS-TIMEOUT-10` to avoid colliding with this round's own "9" label.

## Delivery

Code changes in `Dialysis`/`DialysisProject`, branch `claude/hcris-timeout-9-watchdog` (pushed, no PR — Scott
reports it merged via the manual instructions CC provided). Worth keeping as defense-in-depth on the already-fixed
`DIA-PROPAGATOR1` job. **`HCRIS-TIMEOUT` stays 🔴, unaffected by this fix** — the real next round is
`HCRIS-TIMEOUT-10` (compare-before-write on `HCRIS-TIMEOUT`'s own two write paths), already drafted by round 47.
