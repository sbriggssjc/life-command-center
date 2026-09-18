# HCRIS-TIMEOUT-8 — confirm whether `propagate_financials()`'s step is even armed with a timeout, and stop inferring the answer from silence

**Repo: `Dialysis` (`sbriggssjc/dialysis`).** Filed here (`life-command-center`) per the established
convention for this arc. Eighth round. `HCRIS-TIMEOUT-7` (PR #7418, branch
`claude/amazing-turing-y8nr4w`, commit `f865250`, confirmed merged) fixed three additional
`except Exception` swallows in the `propagate_financials()` write path (`utils_shared.update_row()` →
`utils_shared.safe_execute()` → `core_utils.safe_execute()`), plus a `ThreadPoolExecutor`
blocking-shutdown bug. **A live test of that fix shows it also did not solve the problem.** Full
evidence below.

## 0. What's now independently confirmed live, going into this round

- Scott manually triggered a fresh run 2026-09-17 19:07:07 UTC (`ingestion_tracker` row
  `3506e681-75e4-4189-9292-63766cb47ac7`), specifically to test PR #7418 quickly rather than waiting for
  the next scheduled run. No deploy-timing ambiguity this round — the run started well after Scott's own
  merge confirmation.
- Same opening pattern every round has shown: a ~17-minute startup burst (19:07:17–19:24:21 UTC, 7,013
  `ratings` + 1,777 `clinic_quality_metrics` circuit-breaker errors), then real sustained writes.
- **`properties.updated_at` for this run's window: continuous writes from 19:26:25 UTC (09-17) through
  11:04:49 UTC (09-18) — 15h38m, 9,986 distinct properties touched** — confirmed via log content
  (`src.propagation_utils` logging `"Propagating to properties: {'estimated_annual_revenue': ...}"`,
  the same `facility_patient_counts` schema-skip warnings as every prior round).
- **The run did not stop on its own — it was overwritten.** The last write landed at 11:04:49 UTC, six
  seconds before a second, independently-scheduled run (`c8116399…`) started at 11:04:55 UTC. Scott
  uploaded a log slice from just before that moment and read it as the run having "finished" — checked
  directly and that's not what the log shows: the slice's last line is an ordinary in-progress `properties`
  write, not a completion, exception, or exit signal. (One transient `RemoteProtocolError:
  ConnectionTerminated` appears mid-slice, handled by retry and followed immediately by normal writes —
  not a crash.)
- **Zero rows in `ingestion_run_errors` for the entire 15h38m beyond the initial startup burst.** No
  `StepTimeout`, no exception, nothing — despite running more than 60x past the documented 900s per-step
  budget, and despite two consecutive rounds (`HCRIS-TIMEOUT-6`, `HCRIS-TIMEOUT-7`) of fixes specifically
  targeting swallowed-timeout code paths.
- The run's tracker row (`3506e681…`) has still not been closed or reclaimed — `run_status='started'`,
  `finished_at=null` — even after being superseded by the next scheduled run. **This is new**: every prior
  round's stuck row got flipped to `failed` with `finished_at` set the moment the next run started
  (confirmed in rounds 5 through 7). This round's row didn't. Not yet understood why — flagged as a data
  point, not a diagnosis.
- `facility_cost_reports` is still frozen at `2026-03-16` (94,473 rows, unchanged) — the pipeline has never
  reached that step in any of this arc's eight rounds.
- **Two questions from `HCRIS-TIMEOUT-7`'s own prompt were never answered in that round's response, and
  are now two rounds overdue**: (1) reconciling Railway's "Stopping Container at 7:34:18" Deployments-tab
  event against the Supabase timeline; (2) confirming or correcting the read that round 6's
  SELECT-prefetch batching is actually working (this round's run shows the same ~2,600 writes/hour rate
  as before — roughly consistent with round 7's read, but not independently reconfirmed against code this
  round either).

## 1. What this round needs to answer

**(a) Stop inferring whether the timeout mechanism is armed for this step — go find out directly.**
Rounds 6 and 7 both fixed real swallow bugs *underneath* wherever the alarm/timeout would need to fire,
but neither round confirmed the one thing that would make all of this moot: **is
`propagate_financials()` (or the `patient_counts`/`facility_patient_counts` step that calls it) actually
wrapped in `run_with_timeout()` / does anything call `signal.alarm(900)` (or whatever mechanism enforces
the per-step budget) before this step runs at all?** `aux_cms_tables` had this wrapper, confirmed in
`HCRIS-TIMEOUT-4`/`-5`. It has never been directly confirmed for this later step, across three rounds of
fixes to code that would only matter if the alarm actually fires. Quote the actual call site (or its
absence) from the deployed code — don't describe what should be there.

**(b) If the wrapper genuinely is present and armed, why does `SIGALRM` still never seem to interrupt this
step** — even after `HCRIS-TIMEOUT-7`'s fix removed the swallow layers between the exception and the
per-row loop? Two consecutive rounds of live evidence (round 7: 9h20m/10,243 properties/zero timeouts;
this round: 15h38m/9,986 properties/zero timeouts) now rule out "it fires but gets swallowed one layer
further down" as the *sole* explanation, since round 7 closed every swallow site this session and CC could
find. Consider directly, with evidence rather than a plausible story: is the alarm simply never armed for
this step (answering (a) would settle this); is something re-arming/cancelling it mid-loop; or is Python's
GIL/signal-delivery timing such that a signal raised during certain C-extension calls (e.g. the Supabase
client's underlying HTTP library) genuinely cannot interrupt this specific loop the way it does elsewhere
in the codebase?

**(c) Reconcile Railway's "Stopping Container at 7:34:18" event against the Supabase timeline**, carried
over unanswered from `HCRIS-TIMEOUT-7`. State plainly if this is answerable from the app side at all, or
if it's a platform-level artifact outside the code's visibility.

**(d) Confirm or correct the round-6 batching read**, also carried over unanswered from `HCRIS-TIMEOUT-7`.
Is `prefetch_properties_for_financials()` actually being exercised on these runs, or is something falling
back to per-id lookups more often than expected?

**(e) Explain, if possible, why this run's tracker row was never auto-reclaimed** the way every prior
round's stuck row was when a new run started. If this is unrelated to the timeout investigation, say so
plainly rather than speculating a connection that isn't there.

**(f) Fix whatever (a)/(b) turn out to require.** If the answer to (a) is "this step was never wrapped in
the timeout mechanism at all," the fix is wiring it in for the first time, not another patch to the
exception-handling layers underneath it — two rounds of that approach have now been tried and both
produced identical live results (multi-hour silent runs, zero timeouts, run only ever stopped by external
interruption). If the answer is "SIGALRM can't interrupt this specific blocking call," consider whether a
watchdog-thread approach (checking elapsed wall-clock time between the discrete round trips this step
already makes, since it's not one giant blocking call but many small ones) is more reliable than another
signal-based attempt. Whatever the fix, use the same cheap-verification bar `HCRIS-TIMEOUT-7` set: a
targeted test that proves the mechanism works in seconds, not a claim that requires another multi-hour
production run to confirm.

## Out of scope

- Re-litigating whether `HCRIS-TIMEOUT-6`/`-7`'s code changes are deployed — they are, confirmed via
  Scott's merge reports and this round's own run timing.
- Re-doing the SELECT-prefetch batching unless (d) shows it isn't actually working.
- `HCRIS-QIP-DEFICIENCY-TIMEOUT-PATTERN`, `DEED1`/`DEED1-reconcile`/any Dialysis PR unrelated to this
  pipeline.
- No `life-command-center` code changes — entirely in `Dialysis`.
- No retention/deletion of any rows in any table.

## Verify on

- (a): a direct, quoted answer from the deployed code on whether this step is wrapped in the timeout
  mechanism at all — not an assumption either way.
- (b): a direct, evidenced answer for why `SIGALRM` (if armed) still doesn't interrupt this step, given
  two rounds of swallow-layer fixes have now failed to produce a single logged `StepTimeout`.
- (c): either a reconciliation of "7:34:18" against the Supabase timeline, or a plain statement that it
  can't be reconciled from the app side.
- (d): a direct confirmation or correction of the batching-is-working read.
- (e): an answer or an honest "not related to this investigation" on the tracker-reclaim wrinkle.
- (f): the actual fix (if one is needed), tests, and a cheap way to prove it works without another
  multi-hour production run.
