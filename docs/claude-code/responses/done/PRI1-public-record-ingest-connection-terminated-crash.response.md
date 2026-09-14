# PRI1-public-record-ingest-connection-terminated-crash — response (transcribed 2026-09-11)

> Recovered from Scott's own saved transcript (`PR1 desktop response.docx`, untracked,
> `docs/claude-code/responses/`) — same recovery method as the rest of this arc. **Repo: `Dialysis`.
> This session verified this against the transcript only — `Dialysis` is not reachable from this
> session (no credentials).** Unlike CQM1's thin transcript, this one is thorough and directly
> answers every unit the prompt asked for — transcribed in full detail because of that.

## Unit 1 — the gap, and the reusable pattern already in the codebase

`fetch_properties_for_extraction()` called a bare `query.execute()` — no try, no retry — and
`run_batch()` calls it once, unguarded, before the per-property loop starts, so any exception there
aborts the whole batch with zero properties processed. Confirmed no other Supabase call in `run_batch()`
itself shares this gap, because every other Supabase call in the file lives inside `process_property()`,
inside the loop's own `try/except`, so a drop there degrades to one property counted as `errors += 1`
rather than crashing the batch — a real, separate, much lower-severity gap noted but not touched.

**Important finding, reused directly in the fix**: `supabase_execute_wrapper.py` (installed globally on
every Supabase client) only logs — no retry logic. But `src/core_utils.py::safe_execute()`, already used
at **113 other call sites** across the repo, retries `MAX_ATTEMPTS = 3` with linear backoff (0.5s, 1.0s)
and **already special-cases the exact failure string from this crash** — its final-attempt logic checks
`"connectionterminated" in str(exc).lower()` and treats it as transient. A dedicated test,
`tests/test_safe_execute_connection_retry.py`, already proves this. This is the pattern reused, not a
new one invented.

## Unit 2 — the fix

`fetch_properties_for_extraction()` now routes through `safe_execute(query, table_name="properties",
operation_type="select")` instead of a bare `.execute()`. On failure it raises rather than silently
returning an empty list — a deliberate choice, since this repo has a documented pattern of a failed
fetch being misreported as "processed: 0" success. Retry parameters: 3 attempts total, linear backoff
0.5s then 1.0s — not infinite. **Deliberately did not push retry into `supabase_execute_wrapper.py`
globally** — that wraps every `.execute()` call including writes, and blindly retrying a dropped
connection on a non-idempotent write is unsafe; `safe_execute()` already threads that needle correctly
for the calls it's used on, so reusing it at this specific vulnerable call site was judged the right
scope for this one crash, not a global change.

## Unit 3 — the RLS warning is the same root cause, confirmed

Yes. `get_supabase_client()` is a process-wide cached singleton — both call sites resolve to the same
client instance and the same underlying HTTP/2 connection pool. `verify_user_interactions_rls()` runs
unconditionally at module-import time, lining up with the ~2-second gap before the crash. The identical
`last_stream_id:3` in both messages is consistent with one HTTP/2 connection being torn down and both
call sites reporting the same event. **Not fixed here** (lower severity, fails soft today): the RLS
checker has the identical no-retry gap, flagged as a possible future follow-up if it gets noisy.

## Unit 4 — the 5-hour idle window: no code-level explanation found

Traced every `atexit` handler in the import chain — all local, synchronous, non-network. No signal
handlers, no background threads registered anywhere in this file's chain, and critically: the crash
happened at the very first Supabase call, before anything else (a thread pool, an OpenAI client) had even
been created. The shell wrapper runs `set -euo pipefail`, so the script should abort and exit non-zero
immediately. **Plain conclusion: nothing in this code explains a 5-hour hang** — this points at
something on Railway's side of the boundary (how it schedules/reaps job containers, what "Stopping
Container" actually denotes), not a defect in `public_record_ingest.py`. Asked Scott directly to check
whether there's a distinct "process exited with code 1" line near the original 07:03 crash time,
separate from "Stopping Container" at 12:27, to settle it definitively — no such confirmation obtained
yet.

## Unit 5 — regression test

`tests/test_pri1_public_record_ingest_connection_retry.py` (4 tests, all passing): uses the real
`httpx.RemoteProtocolError` with the exact message text from the Railway traceback (not a generic
exception stand-in); one drop → retries once, recovers; two consecutive drops (within the 3-attempt
budget) → recovers on the third try; persistent failure (every attempt drops) → raises after a bounded
number of attempts (`1 < calls <= 5`, neither giving up too early nor retrying forever); confirms
`run_batch()` still propagates a persistent failure rather than reporting a clean `processed: 0`. Full
existing `public_record_ingest` + `safe_execute` suites (64 tests total) still pass unchanged.

## Out-of-scope notes, answered anyway

The `"pending_updates is schema-light... this is OK"` line, as it exists on `main` today, is logged at
`logger.info(...)` — **could not find a second call site logging that exact message at `error`
severity**. If Railway's log viewer still tags it `ERROR`, that's almost certainly a log-aggregator
stream-classification artifact (the same pattern this arc has already seen elsewhere), not something in
this code — could not reproduce the severity mismatch in source. No table rows retained, deleted, or
touched anywhere in this change.

## Delivery

Branch `claude/exciting-lovelace-sct23s` pushed, commit `565a076`. **PR `sbriggssjc/Dialysis#7404`
confirmed merged** (per Scott). Merge instructions and full local test suite (64/64) reported in the
response.

## Note for the next round — this fix is proven correct, but a fresh crash arrived before it could be
## cross-checked live

A brand-new CMS ingestion crash (same day, after this PR merged) hit the identical `ConnectionTerminated`
error at several call sites **`fetch_properties_for_extraction()` does not touch** — `oig_leie_ingestor`,
`ownership_linker`, `utils_shared`'s `pending_updates` fetch, and `ingestion_tracker`'s run-start. This
doesn't call PRI1's fix into question — it confirms the diagnosis (transient connection drops are real
and ongoing) while showing the fix needs to be applied at more call sites than this one crash covered.
See the new `PRI3` catalog and prompt for the full inventory.
