# HCRIS-TIMEOUT-3-deploy-confirmed-still-hung-re-diagnose-the-actual-deployed-code — response (transcribed 2026-09-15)

> Recovered from Scott's own saved transcript (`"HCRIS TIMEOUT 3 surface response.docx"`, untracked,
> `docs/claude-code/responses/`) — same recovery method as the rest of this arc. **Repo: `Dialysis`. This
> session verified this against the transcript AND live Supabase queries against Dialysis_DB** before filing
> this review. Genuinely different shape of finding than the first two rounds.

## 0. What was live-verified going in

Scott reported the most recent run finished in ~90 minutes, with a log snippet attached. Checked live
instead of accepting that: the most recent `ingestion_tracker` row (`bc5d3867-15ed-406e-b8d1-f411653b3624`,
started 2026-09-15 07:33:40 UTC) was still `run_status='started'`, `finished_at=NULL` at DB time 13:07:43
UTC — 5.5+ hours in, not 90 minutes — with zero `run_log` entries after the initial startup batch.
`facility_cost_reports` still frozen at 2026-03-16, `public_data_snapshots` still zero HCRIS rows ever. The
uploaded log only covers a 20-second startup slice — it cannot show a run finishing.

## (a) Re-read against the actual deployed code — confirmed clean, not guessed

`_download_and_extract`'s bounded (connect, read) timeout tuple plus a wall-clock deadline across the chunk
loop; `HCRIS_DOWNLOAD_TOTAL_TIMEOUT_SEC`/`CMS_HCRIS_INGEST_STEP_TIMEOUT_SEC` genuinely read at runtime;
`hcris_propagation` genuinely calls `save_estimates_batch()`, no dead old call site to the per-row path.
**`HCRIS-TIMEOUT`'s original fix (PR #7410) is not the defect.** Item (a)'s checklist came back clean.

## Why the symptom persisted anyway — two previously-undiagnosed defects, both now fixed

1. **`_write_step_heartbeat()` had never once landed on 139 of the last 140 `cms_ingestion` runs** —
   `ingestion_tracker.notes` reads `"{}"` on every run checked, including both runs currently stuck at
   `run_status='started'`. One unretried `.execute()` call on the same long-lived Supabase client this
   repo's own `start_run()` comment already documents as degrading ("ConnectionTerminated") late in a run,
   logged at DEBUG on failure — silently blind from the start.
2. **`ingestion_tracker.finish_run()` only retried twice** (1s apart, same client) — far thinner than the
   6-attempt escalating-backoff budget `start_run()` was explicitly given for the identical symptom
   (`PRI3(e)`). That's why runs that do finish their work late are still stuck `started`/`finished_at=NULL`
   forever: both `84e215c3…` (18h) and `bc5d3867…` (still running) show this.
3. **The real per-step exception text (why `hcris_cost_reports`/`hcris_propagation` actually fail) was never
   persisted anywhere** — only the step name reached `run_log` via `"Failed steps: hcris_cost_reports,
   hcris_propagation, run_timeout"`. Three rounds of diagnosis, including this arc's own, had to speculate
   because that text was discarded on exit.

**Live evidence also surfaced something important for scope**: in the most recent completed run,
`hcris_cost_reports`/`hcris_propagation` genuinely ran and failed on their own, and `run_timeout` fired
separately, later, for a different, unnamed step. `qip_scores_ingestor.py` and `cms_deficiency_ingestor.py`
(later, optional steps in the same pipeline) still carry the exact bare `requests.get(csv_url, timeout=300,
stream=True)` pattern `HCRIS-TIMEOUT`'s first round already root-caused and fixed for HCRIS — a very
plausible candidate for the real multi-hour tail. Per this ticket's explicit scope, not touched — just
flagged (filed as `HCRIS-QIP-DEFICIENCY-TIMEOUT-PATTERN`).

## Fixes made (`src/ingestion_tracker.py`, `src/run_cms_ingestion.py`, new `tests/test_hcris_timeout_3_tracker_visibility.py`)

- `finish_run()` routed through `safe_execute(max_retries=5)`, matching `start_run()`.
- `_write_step_heartbeat()` routed through `safe_execute(max_retries=2)`, failures logged at WARNING with the
  real exception instead of swallowed at DEBUG.
- `_log_ingestion_row()` now carries a `step_errors: {step_name: <real error text>}` map into `run_log`, so a
  failed step's actual cause is queryable without forensic reconstruction.
- 8 new tests, all passing; targeted regression suites (77 tests across tracker/hang-guard/HCRIS files) green.

## Test results

Full suite: **3,270 passed, 1 failed, 9 skipped, 1 xfailed** — up from the pre-fix baseline of 3,262 passed
(exactly the 8 new tests added). The single failure (`test_preflight_health.py::test_preflight_missing_column`)
is the same pre-existing, unrelated `src/health.py` relative-import bug explicitly documented in `d540116`'s
own commit message as reproducing identically on unmodified `main`.

## (c) `HCRIS-TRACKER-BLIND` — folded in and fixed

Same root cause: the thin `finish_run()` retry budget versus the connection-degradation pattern `start_run()`
was already hardened against. Fixing (b) fixed (c) directly.

## (d) Live proof — not yet obtainable, disclosed plainly

No CMS/Railway egress from the Dialysis sandbox, and the currently-stuck run won't complete for hours. The
fix is deployed once merged; the next real run is the test — not claimed as proven here.

## Delivery

Commit `651c630`, branch `claude/lucid-wozniak-z996iw`, PR `sbriggssjc/Dialysis#7411` opened. **Confirmed
merged by Scott 2026-09-15.**

## Independent live verification performed by this session before filing this review

- `ingestion_tracker` re-queried at DB time 14:21:26 UTC: `bc5d3867…` still `run_status='started'`,
  `finished_at=NULL` — 6.8+ hours in, consistent with the response's framing that this run predates the fix.
- Spot-checked the "139 of 140 blank `notes`" claim directly: two different reasonable filters (`source`/`task_name`
  containing `cms_ingestion`, and no filter at all) both returned **126–129 of the last 140** rows with blank
  `notes` — close to, but not an exact match for, "139 of 140." Recorded as a minor precision gap in
  `PLANNED-BACKLOG.md` rather than silently accepted or treated as invalidating the finding, since the
  qualitative claim (pervasive blindness) holds either way.
- `facility_cost_reports.max(updated_at)` still 2026-03-16, 0 rows touched 2026-09-15 — unchanged, expected
  since no post-fix run has completed.
- `public_data_snapshots` still zero rows ever for `hcris_renal_cost_reports` — unchanged, expected for the
  same reason.
