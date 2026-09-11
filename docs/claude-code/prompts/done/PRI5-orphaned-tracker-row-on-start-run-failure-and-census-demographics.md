# PRI5 — `ingestion_tracker` row orphaned whenever `start_run` fails, even on an otherwise-successful pipeline run; plus `census_demographics` still failing every run

**Repo: `Dialysis` (`sbriggssjc/dialysis`).** Filed here (`life-command-center`) per the established
convention for this arc. **This is genuinely good news mixed with one real, distinct gap — not another
crash.** Recommend sending, not urgent-blocking, but worth closing since it's an observability gap this
whole arc has been leaning on.

## 0. What happened — read this before assuming it's another `PRI4`

Scott reported this run as "crashed," but **the logs show no traceback, no unhandled exception, and no
hang** — the process ran for its full ~37 seconds, printed a complete, orderly final summary, and exited
normally. Two important pieces of good news first:

- **`ownership_linker`'s `PRI3` fix appears to be genuinely working in production for the first time**:
  `Properties → true_owners: {'from_recorded_chain': 1, 'from_tenant_match': 0, 'from_cms_chain': 6570}`
  and `Contacts → Salesforce: {'by_email': 0, 'by_name': 0, 'by_company': 19}` — real, non-zero linkage
  counts, a sharp contrast to the original `PRI3` crash where all 9 sub-steps failed with every counter
  at `0`. This is the first live evidence this arc has had that `PRI3`'s fix actually works end-to-end.
- The process did **not** hang after hitting trouble this time (contrast with `PRI4`'s confirmed 90+
  minute hang) — consistent with `PRI4`'s daemon-thread + `os._exit(2)` mitigation working, though this
  session cannot fully confirm that connection since this run may simply not have hit the same stuck
  code path.

**The one real, distinct gap**: `ingestion_tracker.start_run` failed after retries again
(`ERROR:src.ingestion_tracker:failed to start ingestion_tracker run for cms_medicare_clinics after
retries: None`) — same connection instability, still present, consistent with `PRI3`'s Section 2
conclusion that the root cause isn't determinable and retries are the practical mitigation, not a cure.
**But this time the pipeline continued anyway and completed successfully** (writing to a separate
`run_log` table, sending a staleness alert, printing a full summary) — **while the `ingestion_tracker`
row that failed `start_run` created is permanently orphaned**: confirmed live in Dialysis_DB, this run's
row (`id c817274e-fad2-421a-861d-ad8afb699f4d`, `started_at 2026-09-11 18:25:41.833673 UTC`) is still
`run_status='started'`, `finished_at=null`, 30+ minutes later. A live count confirms this isn't one-off:
**of all `cms_medicare_clinics` rows in `ingestion_tracker`, 118 are `success`, but 5 are permanently
stuck at `started`** — every one of them from this arc's problem runs (`13:14`, `13:14`, `13:46`,
`15:53`, and this one at `18:25`). This is a distinct code path from `PRI4`'s catalog: `PRI4` looked at
the *preflight-abort* exit path; this is the *pipeline continues and completes normally, but never
revisits or closes the tracker row `start_run` itself failed to open cleanly* path.

**Separately, still recurring**: `WARNING:root:Pipeline finished with 1 failed step(s): census_demographics`
— the exact same open item `PRI3`'s catalog (g) never got to the bottom of (confirmed vulnerable, but
this specific run's cause never determined). It has now failed again in an otherwise-successful run,
worth a real look this time rather than staying an open question indefinitely. The final summary also
again reported all-zero real counters with the "Core ingestion counters were not recorded" warning —
`PRI3`'s catalog (f) called this "two conflated but benign phenomena," but seeing the identical shape
recur is worth a second look to confirm that conclusion still holds, or to determine if it's actually a
consequence of `census_demographics`'s failure poisoning the summary path.

## 1. The catalog

**(a) Close the `ingestion_tracker` row when `start_run` itself fails, even if the pipeline proceeds
anyway.** Read the actual code path: what happens today when `start_run()` exhausts its retries and
fails — does the pipeline log the failure and continue using a fallback (`run_log`), or is this
unintentional? Either way, whatever code path continues past a failed `start_run()` should also either
(i) mark that orphaned tracker row `failed`/`aborted` with a clear reason, or (ii) not create the row at
all until `start_run()` actually succeeds. Prefer whichever is truer to the existing design intent — read
the code before picking. Confirm the fix live: trigger the actual failure path (or a close simulation)
and show the row closing out instead of staying stuck at `started`.

**(b) `census_demographics` — find and report the actual failure this time, not another "vulnerable but
undetermined."** This has now failed multiple times across this arc's rounds. Get the actual error for
this specific run (fuller logs, error detail table, whatever's available) and either fix it or report
plainly and specifically why it can't be determined this time either — a third "confirmed vulnerable, cause
unknown" is not an acceptable outcome if avoidable.

**(c) Re-confirm (f)'s "two conflated but benign phenomena" conclusion still holds.** `PRI3`'s response
concluded the all-zero summary + "not recorded" warning are benign and separate from real data loss. This
run shows the identical pattern again. Confirm plainly whether that conclusion still applies here, or
whether it's actually downstream of `census_demographics`'s failure (b) — don't just re-assert the
earlier conclusion without checking it against this specific run.

## Out of scope

- `ownership_linker`'s core linking logic and its retry wrapping — confirmed working live this round,
  don't touch.
- `oig_leie_ingestor`'s own retry logic — separately tracked, not part of this run's evidence either way.
- No retention/deletion of any rows in any table.
- No `life-command-center` code changes — entirely in `Dialysis`.

## Verify on

- (a): the actual code path quoted verbatim, the fix applied, and a live before/after — the specific
  orphaned row class (or a fresh reproduction) actually closing out, not just "should now close."
- (b): the actual root cause this time, or an honest, specific statement of why it still can't be
  determined (not a repeat of the same generic non-answer).
- (c): a plain yes/no, checked against this run's specifics, not just re-asserted from `PRI3`.
