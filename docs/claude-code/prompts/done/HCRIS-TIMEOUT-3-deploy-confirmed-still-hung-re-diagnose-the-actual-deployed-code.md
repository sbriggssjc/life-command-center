# HCRIS-TIMEOUT-3 — deploy is confirmed, the symptom still hasn't changed; re-diagnose the actual deployed code, don't re-describe the fix

**Repo: `Dialysis` (`sbriggssjc/dialysis`).** Filed here (`life-command-center`) per the established
convention. **Third round on this defect.** `HCRIS-TIMEOUT`'s original fix (PR #7410, branch
`claude/hcris-timeout-fix-01BWJTdN`) is now **confirmed deployed on Railway** (Scott verified this
directly). That resolves `HCRIS-TIMEOUT-2`'s open question (a) — the code that's running is genuinely the
merged fix, not a stale deploy. **The symptom is unchanged anyway.** This round is `HCRIS-TIMEOUT-2`'s
catalog item (b): find out why the deployed fix doesn't behave as its own description says it should.

## 0. What was live-verified after deploy was confirmed

Scott reported the most recent run finished in ~90 minutes, with a log snippet attached. Checked live
instead of accepting that: the most recent `ingestion_tracker` row (`bc5d3867-15ed-406e-b8d1-f411653b3624`,
`started_at` **2026-09-15 07:33:40 UTC**) was still `run_status='started'`, `finished_at=NULL` at DB time
**13:07:43 UTC — 5.5+ hours in, not 90 minutes** — with **zero `run_log` entries of any kind** after the
initial startup batch (07:33:37–07:41 UTC). `facility_cost_reports.updated_at` is still frozen at
**2026-03-16** (0 rows touched that day), and `public_data_snapshots` still has **zero rows, ever**, for
`hcris_renal_cost_reports`. The uploaded log file itself only covers a 20-second slice at the run's startup
(07:34:06–07:34:26 UTC) — it does not, and cannot, show the run finishing. Whatever Scott observed as "~90
minutes" isn't corroborated by the database; worth asking him directly what he was looking at (Railway's
dashboard, a process/container restart, something else) since it may itself be a clue (e.g., a container
restart that looks like completion but is actually a crash-and-retry).

## 1. The catalog

**(a) Re-read the actual deployed code as it exists in the merged commit — not from memory of the previous
round's description of the fix.** Confirm, don't assume, each of these against the real source:

- `_download_and_extract`: is the bounded connect/read timeout actually wired to the `requests` call this
  function makes in production, or does a different code path (a retry wrapper, a session object built
  elsewhere, an old call site left in place alongside the new one) still make the unbounded call?
- Is `HCRIS_DOWNLOAD_TOTAL_TIMEOUT_SEC` (should bound each URL attempt to 300s) actually read at runtime in
  the deployed environment, or does it fall back to a default that's effectively unbounded? Same question
  for `CMS_HCRIS_INGEST_STEP_TIMEOUT_SEC` (should cap the whole step at 1800s).
- `hcris_propagation`: does it actually call the new `save_estimates_batch()`, or is there still a code path
  (an older call site, a conditional that doesn't trigger under real data) that falls through to the old
  per-row `save_estimate()` loop?
- Is there a plausible reason the step could still consume the *entire* run rather than being cut off at its
  own 1800s cap — e.g., the wall-clock deadline check happening only between retries of one URL rather than
  bounding the retry loop itself, or the deadline being computed from the wrong start time?

**(b) Once the actual mechanism is found, fix it — and this time, add something that makes the *next* review
not require a forensic SQL cross-check to tell whether it worked.** At minimum: a `run_log` heartbeat entry
(or equivalent) written *during* the HCRIS step, not just at the overall run's start/end, so a stuck run is
visible without waiting for the run to finish or inferring from silence.

**(c) `HCRIS-TRACKER-BLIND`, filed separately in `PLANNED-BACKLOG.md`, is a candidate to fold in here.** Two
consecutive runs' `ingestion_tracker` rows (`84e215c3…` and `bc5d3867…`) both show `run_status='started'`,
`finished_at=NULL` long after they must have either completed or failed. If root-causing this is cheap once
you're already in this code path (e.g., the heartbeat/`finish_run()` call swallowing an exception), fix it
alongside (b); if it's a separate, unrelated mechanism, leave it filed as its own item and say so plainly
rather than guessing.

**(d) Get real live proof — not test-suite green, not "should be fixed now."** The bar this arc has held
throughout, now for a third round: a subsequent live run's `run_log` either completes
`hcris_cost_reports`/`hcris_propagation` cleanly or fails distinctly faster/differently than an 18-hour (or
5.5+-hour-and-still-running) hang, and `facility_cost_reports.updated_at` actually advances past 2026-03-16.
Trigger or wait for a real run and report the actual result.

## Out of scope

- Re-litigating whether the deploy is current — it's confirmed, not in question this round.
- Any other pipeline step, `PRI` arc mechanics, `ownership_linker`, `census_demographics` — all unaffected.
- No retention/deletion of any rows in any table.
- No `life-command-center` code changes — entirely in `Dialysis`.

## Verify on

- (a): the real reason the symptom persists, quoted from the actual deployed code — not a repeat of the
  first round's description of what the fix was supposed to do.
- (b): the fix, plus a way to see step-level progress in a future review without a manual SQL cross-check.
- (c): either folded in and fixed, or explicitly left separate with a reason.
- (d): live proof from an actual subsequent run.
