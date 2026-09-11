# PRI1 — `public_record_ingest.py` crashes the whole batch on a single dropped Supabase connection

**Repo: `Dialysis` (`sbriggssjc/dialysis`).** Filed here (`life-command-center`) per the established
convention for this arc — the code lives in the other repo, this repo just tracks the ask and the
response. **This one is queued, not urgent** — Scott asked to add it to the to-do list rather than fix
it immediately; send whenever convenient.

## 0. What was found, and how

Scott was reviewing Railway logs for an unrelated CMS ingestion run and noticed a separate service
(`public_record_ingest.py`, batch `batch=800 chain_canonical_only=true force=false`, started 2026-09-11
07:03:04 UTC) had crashed. Full traceback:

```
File "/app/src/public_record_ingest.py", line 1284, in <module>
  main()
File "/app/src/public_record_ingest.py", line 1275, in main
  summary = run_batch(...)
File "/app/src/public_record_ingest.py", line 1194, in run_batch
  properties = fetch_properties_for_extraction(...)
File "/app/src/public_record_ingest.py", line 1177, in fetch_properties_for_extraction
  result = query.execute()
...
httpx.RemoteProtocolError: <ConnectionTerminated error_code:0, last_stream_id:3, additional_data:None>
```

This is an **unhandled exception** — it propagates all the way up through `run_batch()` and `main()`
uncaught, crashing the batch before a single property was processed. Two seconds earlier, a related
warning fired on what looks like the same connection: `WARNING:src.user_interaction_logger:
user_interactions RLS check failed: <ConnectionTerminated error_code:0, last_stream_id:3,
additional_data:None>` — same error shape (`ConnectionTerminated`, same `last_stream_id:3`), different
call site. This looks like one HTTP/2 connection getting cut (a network blip between Railway and
Supabase, a load-balancer connection recycle, or a server-side GOAWAY), not two independent bugs — but
confirm that read rather than assume it.

**Separately observed, worth a quick answer but not the main fix**: the container stayed running for
over 5 hours after the crash (07:03 crash → 12:27 `Stopping Container`) before it was stopped. Confirm
whether that's expected behavior (e.g. a supervisor process waiting idle, a scheduled restart window) or
itself a symptom — a process that should exit non-zero on an unhandled top-level exception staying alive
for 5+ hours doing nothing is worth a sentence of explanation either way.

## 1. Units

**Unit 1 — read `fetch_properties_for_extraction()` and `run_batch()` verbatim.** Confirm there is
genuinely no retry/backoff around the Supabase query call today, and confirm whether other Supabase calls
in this same file (or elsewhere in this codebase) already use a retry pattern that could be reused here
rather than inventing a new one — this arc has repeatedly found value in reusing an existing pattern over
building a new one.

**Unit 2 — add retry-with-backoff around the vulnerable call(s).** A transient `httpx.RemoteProtocolError`
/ `ConnectionTerminated` (and, if reasonable, other transient network exceptions from the same family)
should trigger a small number of retries with backoff before giving up — not an infinite retry, and not
silently swallowing a genuinely persistent failure. If `run_batch()` calls other Supabase queries besides
`fetch_properties_for_extraction()`, confirm whether they have the same gap and, if so, whether the fix
belongs at a shared call site (e.g. inside `supabase_execute_wrapper.py`, which this file already routes
through) rather than duplicated per call site.

**Unit 3 — confirm the RLS-check warning is the same root cause, not a second bug.** State plainly
whether `user_interactions RLS check failed` and the fatal crash share a cause (the same dropped
connection) or are unrelated. If unrelated, treat as a separate finding rather than assuming they're
connected just because they're adjacent in the log.

**Unit 4 — the 5-hour idle window.** State plainly whether the container remaining "Starting" for 5+
hours after an unhandled top-level exception is expected (and why) or itself worth a small fix (e.g. the
process should exit non-zero immediately so Railway's own restart policy can react).

**Unit 5 — regression test.** A test that simulates the connection-drop exception on the Supabase call
and confirms the retry logic engages and eventually succeeds (or fails cleanly after exhausting retries),
per this arc's now-standard discipline of testing the actual failure shape, not a proxy for it.

## Out of scope

- `ratings`, `clinic_quality_metrics`, `properties.estimated_annual_revenue` — all separately tracked,
  don't touch.
- The cosmetic log-severity issue (`"pending_updates is schema-light... this is OK"` logged at `error`
  severity despite saying it's fine) — worth a one-line note in the response if convenient, not worth a
  dedicated fix in this prompt.
- No retention/deletion of any rows in any table.
- No `life-command-center` code changes — entirely in `Dialysis`.

## Verify on

- Unit 1: the actual code quoted verbatim, confirming the gap and any existing retry pattern to reuse.
- Unit 2: the fix described plainly, with retry/backoff parameters stated (attempt count, delay), not
  just "added retries."
- Unit 3: a plain statement of whether the RLS warning and the crash share a cause.
- Unit 4: a plain statement of whether the 5-hour idle window is expected or a separate small fix.
- Unit 5: real test coverage exercising the actual exception type, not a generic mock.
