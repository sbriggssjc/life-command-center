# PRI4 — CMS ingestion hangs indefinitely after a clean "preflight abort" print; plus one uncovered retry call site

**Repo: `Dialysis` (`sbriggssjc/dialysis`).** Filed here (`life-command-center`) per the established
convention for this arc — the code lives in the other repo, this repo just tracks the ask and the
response. **Confirmed, reproducible, and currently occupying a live Railway deployment slot** — not
theoretical. Recommend sending promptly; Scott may need to manually stop/redeploy the stuck instance
regardless of when this gets fixed.

## 0. What happened, and why this is different from `PRI1`/`PRI3`

`PRI3`'s fix (merged, confirmed deployed live) hardened `oig_leie_ingestor`, `ownership_linker`,
`utils_shared`'s `pending_updates` fetch, and `ingestion_tracker`'s `start_run` against
`ConnectionTerminated` failures. Scott triggered a fresh CMS ingestion run specifically to prove that fix
live. The run never reached any of those fixed call sites — it failed during **preflight**, a distinct,
earlier code path `PRI3` didn't touch. That part is a straightforward new gap (Section 1a below).

**The more serious finding**: after the preflight failure, the process printed a complete, orderly
`=== CMS ingestion (preflight abort) run summary ===` (every counter zero, `elapsed: 1.01s`) — clear
evidence its own code intentionally reached an abort/summary branch, not an unhandled crash. But **no
log line has been emitted since**, and as of this writing the run has been alive for **over 50 minutes**
(confirmed both via Railway's dashboard, which shows the deployment still actively "Running," not
"Crashed" or "Success," and via a live query against `ingestion_tracker` in Dialysis_DB, where this run's
row — `started_at 2026-09-11 15:53:15.083884 UTC` — is still `run_status='started'`, `finished_at=null`,
with no change in over 50 minutes). **The process reached its own printed conclusion and then never
exited.** This is the same shape of mystery `PRI1`'s Unit 4 raised (an unexplained idle gap before
"Stopping Container") but now caught live, confirmed hung rather than merely suspected, and blocking a
real deployment slot right now.

## 1. The catalog

**(a) `facility_patient_counts`'s preflight check has no retry.** Log evidence: immediately after
`INFO:src.preflight_checks:RPC execute_sql probe succeeded`, the very next Supabase call fails outright —
`INFO:src.supabase_execute_wrapper:supabase.execute ... error=RemoteProtocolError: Server disconnected`
— followed immediately by `ERROR:__main__:Preflight step 1 FAILED: facility_patient_counts: Server
disconnected`. No retry attempt is visible between the failure and the "FAILED" line. Read the actual
preflight-check code for this step and apply `safe_execute()` (or the documented equivalent), the same
pattern already proven at `PRI1`'s and `PRI3`'s call sites.

**(b) The `ingestion_tracker` row for a preflight-aborted run is never closed out.** Confirmed live: this
run's row is still `run_status='started'`, `finished_at=null` more than 50 minutes after the process
printed its own "preflight abort" summary. Whatever code path runs on preflight abort does not call back
into `ingestion_tracker` to mark the run `failed` or `aborted`. Find that exit path and fix it — a clean
abort should still close its own tracker row, independent of whatever is causing (c) below.

**(c) The actual hang — the process does not exit after printing its abort summary.** This is the
priority item. Trace the code from the `=== CMS ingestion (preflight abort) run summary ===` print
statement forward: what runs after that print, and why would it block indefinitely rather than returning
or calling `sys.exit()`? Specific things worth checking, without assuming any of them: a thread or
connection-pool cleanup call that itself blocks on a dropped connection with no timeout; an `atexit`
handler doing network I/O; a context manager (`with` block) whose `__exit__` never returns because it's
waiting on the same degraded connection that caused the original failure; or a retry/backoff loop
somewhere in the abort/cleanup path itself that has no upper bound. **This is confirmed live and
reproducible right now** — if it's still possible to attach to or inspect the running process (Railway
shell access, a thread dump, `py-spy dump`, or similar) before Scott has to kill it, that would settle
this far more precisely than static code reading alone; note in the response whether that was possible.

**(d) Practical recommendation for Scott, independent of the code fix.** This deployment has now been
occupying a Railway instance for 50+ minutes doing nothing, per its own logs and the database. Confirm
whether it's safe to manually stop/redeploy this specific deployment without side effects (the tracker
row it created will remain open regardless, per (b), until that's separately fixed) — Scott may want to
do this before or independent of waiting on the code fix, just to reclaim the instance.

## Out of scope

- `oig_leie_ingestor`, `ownership_linker`, `utils_shared`'s `pending_updates`, `ingestion_tracker.start_run`'s
  own retry logic — all already fixed and confirmed deployed in `PRI3`, don't touch. This run never
  reached any of them; that remains unverified and is NOT this prompt's job — a clean run that gets past
  preflight is still needed to prove those live, separately from this hang investigation.
- `ratings`, `clinic_quality_metrics`, `properties.estimated_annual_revenue` — all separately tracked,
  don't touch.
- No retention/deletion of any rows in any table.
- No `life-command-center` code changes — entirely in `Dialysis`.

## Verify on

- (a): the actual preflight-check code quoted verbatim, the fix applied, and an actual before/after
  proof where practical.
- (b): a plain statement of the actual exit path today, the fix applied, and confirmation (live query or
  equivalent) that a fresh preflight-aborted run now closes its tracker row.
- (c): the actual root cause if it can be found (not just "added a timeout to be safe") — if it truly
  can't be determined from static code reading, say so explicitly, same as `PRI3`'s honest handling of
  its own unresolved item (h), and propose a concrete mitigation regardless (e.g., a hard timeout wrapping
  the entire abort/cleanup path) rather than leaving the hang possible indefinitely.
- (d): a plain yes/no on whether it's safe for Scott to manually stop the specific hung deployment.
