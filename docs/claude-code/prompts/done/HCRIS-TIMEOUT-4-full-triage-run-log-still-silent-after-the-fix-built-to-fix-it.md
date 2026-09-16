# HCRIS-TIMEOUT-4 — full triage: `run_log`/`ingestion_tracker.notes` are still silent two full run cycles after the fix built specifically to populate them, and HCRIS itself is still not landing a single row

**Repo: `Dialysis` (`sbriggssjc/dialysis`).** Filed here (`life-command-center`) per the established
convention for this arc. **Fourth round, and this one is deliberately exploratory rather than another
single-hypothesis fix** — three rounds of "find the one bug and fix it" have each turned out to be correct
on their own terms (PR #7410 fixed a real timeout bug, PR #7411/`HCRIS-TIMEOUT-3` fixed a real tracker-blindness
bug) and the symptom has not moved: `facility_cost_reports` has been frozen at 2026-03-16 through all of it,
and `public_data_snapshots` has zero HCRIS rows, ever. This round's job is to step back and triage the whole
picture — deploy state, runtime behavior, and every plausible failure point — rather than extend the same
narrow-hypothesis pattern a fourth time.

## 0. What's been independently live-verified, going into this round

- **`HCRIS-TIMEOUT-3` (PR #7411, commit `651c630`, branch `claude/lucid-wozniak-z996iw`) is confirmed merged.**
  Its fix routed `finish_run()` and `_write_step_heartbeat()` through `safe_execute()` with real retry budgets,
  and added a `step_errors` map to `_log_ingestion_row()` specifically so a stuck/failed run's cause would be
  visible in `run_log` without another manual SQL forensic pass.
- **Two full run cycles have completed since that merge, live-monitored from this side rather than waiting for
  another log upload:**
  - Run 1 (`593e1e75…`, started 2026-09-15 17:37:36 UTC) ran **~12h25m** before being reclaimed as
    `abandoned` at 2026-09-16 06:02:56 UTC — far past the 90-minute budget.
  - Run 2 (`64e34e14…`, the daily scheduled run, started 2026-09-16 06:03:24 UTC) was confirmed **genuinely
    live** (not stuck) via `properties.updated_at` moving in real time during the check.
  - Both runs show the identical shape every round of this arc has found: a burst of ~8,870–8,900
    `ingestion_run_errors` in the first ~12–15 minutes (unrelated `medicare_ingestion` writes), then total
    silence for the rest of the run.
- **The new, more basic finding this round exists to explain: `run_log` has not received a single write of
  any kind since 2026-09-15 07:33:40 UTC** — 28+ hours and two full run cycles ago, a timestamp that predates
  the `HCRIS-TIMEOUT-3` fix entirely. Neither post-fix run logged a startup summary, a step heartbeat, or the
  new `step_errors` detail. **`ingestion_tracker.notes` is also still blank (`'{}'`) on both runs, including
  the now fully-closed one** (`593e1e75…`, `run_status='abandoned'`, `finished_at` populated) — a finished,
  closed run with populated `notes` is exactly the case `HCRIS-TIMEOUT-3`'s fix was built to handle, and it
  didn't happen.
- This re-opens, without answering, the question `HCRIS-TIMEOUT-2` raised and never got a direct answer to:
  **is the Railway service genuinely running the merged commit?** Two consecutive runs producing zero
  diagnostic output from a fix specifically designed to produce that output is hard to explain any other way,
  but it hasn't been confirmed from this side — no Railway tool access, no way to check deploy history or the
  running container's actual commit SHA from Cowork.
- One correction on the record for this round: Scott separately reported "run 2 used PR #7412" — checked and
  that's not right. PR #7412 in `Dialysis` is the unrelated `DEED1-reconcile` deed/ownership migration; there
  is no further HCRIS/CMS-ingestion prompt or response queued beyond PR #7411. Treat both runs as running
  whatever #7411 actually deployed, and confirm that rather than assuming it.

## 1. The triage — work through all of these, don't stop at the first plausible one

**(a) Settle the deploy question directly, first.** Check Railway's deploy history for the `cms-ingestion`
service (or whatever it's called in that project) against commit `651c630`. Confirm: is that commit the one
actually running right now, and when did it last redeploy relative to run 1's start time (2026-09-15
17:37:36 UTC)? If there's any way to read the running container's actual commit SHA or build ID (a health
endpoint, a startup log line, an env var baked in at build time), use it — don't infer from "the PR shows
merged" alone, since that's exactly the gap that's been open since `HCRIS-TIMEOUT-2`.

**(b) If the deploy is confirmed current, explain why `_write_step_heartbeat()`/`finish_run()`'s own fix isn't
producing output.** Re-read the actual deployed code for `_write_step_heartbeat()`, `finish_run()`, and
`_log_ingestion_row()` as they exist in `651c630` — not from memory of the `HCRIS-TIMEOUT-3` response's
description of what the fix does. Specifically:
- Is `safe_execute()` actually being called on the code path both post-fix runs took, or is there a different
  call site / early-return / exception swallowed before it's reached?
- Does anything about **this** run's failure shape (the error burst in the first 15 minutes, then total
  silence) suggest the process is stuck somewhere that never reaches the heartbeat/finish code at all — e.g.
  blocked inside one call before any of the instrumented functions run?
- Is `run_log`/`ingestion_tracker` writable at all from this service right now — a permissions change, a
  connection pool exhaustion, an RLS policy change, anything that would silently no-op every write from this
  specific process while other tables (`properties`, `ingestion_run_errors`) are demonstrably still being
  written to successfully?

**(c) Re-triage the HCRIS step itself, independent of the tracker-blindness question.** With two more full run
cycles of data now available: does `hcris_cost_reports`/`hcris_propagation` actually start running in either
post-fix run (even without visibility into how it ends), or is it possible the step never gets reached at
all — e.g. an earlier step in the 15+-step pipeline now hangs or fails silently and the run simply never
progresses far enough to reach HCRIS? This arc has assumed HCRIS is the step that's hanging in every round;
confirm that's still true rather than re-asserting it, given `run_log` now shows nothing about *any* step,
not just HCRIS.

**(d) Widen the lens to the two adjacent, already-flagged-but-unbuilt candidates.** `HCRIS-QIP-DEFICIENCY-
TIMEOUT-PATTERN` (filed, not built) flagged that `qip_scores_ingestor.py`/`cms_deficiency_ingestor.py` still
carry the same bare `requests.get(csv_url, timeout=300, stream=True)` pattern the original `HCRIS-TIMEOUT` fix
already root-caused and fixed for HCRIS. If (c) finds the pipeline genuinely never reaches HCRIS, or reaches
it and moves past it, this becomes directly relevant rather than a side note — say plainly whether it's now
in scope for this round or still a separate future item, and why.

**(e) State a clear, evidenced conclusion — not another "should be fixed now."** After (a)-(d), give a direct
answer to the actual open question this arc has circled for four rounds: what, specifically, is preventing
`facility_cost_reports` from updating and `public_data_snapshots` from ever getting an HCRIS row? If the
honest answer is "still not fully isolated, here's what's ruled out and what's left," say that plainly rather
than presenting a partial finding as the resolution — this arc has done that before and it cost rounds.

## Out of scope

- Re-litigating `PRI1`–`PRI6`, `ownership_linker`, `census_demographics` — all separately closed, unaffected.
- `DEED1`/`DEED1-reconcile`/PR #7412 — entirely unrelated, different repo-ownership question, don't touch.
- No retention/deletion of any rows in any table.
- No `life-command-center` code changes — entirely in `Dialysis`.
- Don't make a fifth narrow single-hypothesis fix without doing the triage in (a)-(d) first — that's the
  specific pattern this round is trying to break out of.

## Verify on

- (a): a direct, evidenced answer on deploy currency — not "the PR shows merged," but something that actually
  confirms what's running right now.
- (b): the real reason (if the deploy is current) that the `HCRIS-TIMEOUT-3` instrumentation isn't producing
  any output, quoted from the actual deployed code or runtime behavior — not a re-description of what the fix
  was supposed to do.
- (c): a plain statement of whether the HCRIS step is even being reached in the two most recent runs.
- (d): a plain statement of whether the QIP/deficiency pattern is now in scope or still deferred, and why.
- (e): a direct, evidenced conclusion — including "not fully isolated yet, here's what's ruled out" as an
  acceptable honest answer, over a partial finding presented as resolution.
