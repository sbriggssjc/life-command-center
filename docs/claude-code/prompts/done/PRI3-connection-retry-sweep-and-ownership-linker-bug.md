# PRI3 — connection-retry sweep across the CMS ingestion pipeline, plus a real `ownership_linker` code bug

**Repo: `Dialysis` (`sbriggssjc/dialysis`).** Filed here (`life-command-center`) per the established
convention for this arc — the code lives in the other repo, this repo just tracks the ask and the
response. **Unlike `PRI1`, this one is NOT queued** — the evidence below is confirmed, ongoing data loss
in a live production pipeline, not a rare or theoretical blip. Recommend sending this promptly.

## 0. What happened, and why this is more urgent than `PRI1`/`PRI2`

`PRI1` fixed one crash site (`public_record_ingest.py`) by routing its vulnerable Supabase call through
`src/core_utils.py::safe_execute()` — the codebase's own existing retry helper, already used at 113
call sites, already special-casing `ConnectionTerminated` as transient (3 attempts, linear backoff 0.5s
then 1.0s). That fix is confirmed correct and merged (`sbriggssjc/Dialysis#7404`).

The same day, a fresh CMS ingestion run crashed (Railway sent a "Deploy Crashed" email for `cms-ingestion`
in `handsome-luck`). Its logs show the **identical error** — `httpx.RemoteProtocolError:
<ConnectionTerminated error_code:0, last_stream_id:3, additional_data:None>` — hitting several call
sites `PRI1`'s fix does not touch, and unlike `PRI1`'s single crash-on-first-query, **these sites have
no retry at all and are silently losing real data on every occurrence, run after run**, not just one bad
query at start-of-batch.

## 1. The full catalog — treat each as its own fix, verify each independently

**(a) `oig_leie_ingestor` — LEIE upserts, ~50% permanent loss per run.** Log evidence:
`INFO:src.oig_leie_ingestor:OIG LEIE: fetched=84001 upserted=42000 errored=42001 matched=0 active=84001`
plus 291 distinct `ERROR:src.oig_leie_ingestor:LEIE upsert batch N failed: <ConnectionTerminated ...>`
lines in a single ~30-second window. Roughly half of every LEIE (federal exclusion list) ingestion run is
being silently dropped, with no retry per batch. Read the actual upsert call site and apply
`safe_execute()` (or confirm why it can't be used here and propose the equivalent), the same way `PRI1`
did.

**(b) `ownership_linker` — all 9 sub-steps failed, zero retry, zero records linked.** Every one of these
failed with the identical error in the same run: history backfill, assessed-owner matching, sales-
transaction linking, ownership-history-notes linking, recorded-chain linking, recorded→true-owner
matching, tenant matching, CMS chain linking, true-owners→Salesforce matching, contacts→Salesforce
matching. Every counter in the run's `Ownership linkage complete` summary was `0`. Apply `safe_execute()`
(or the equivalent) to each of these call sites — read the actual code first to confirm they're all
independent calls that can each be wrapped, rather than one shared call failing 9 times downstream.

**(c) A real, separate code defect — not a connection error.** In the same cascade:
`ERROR:src.ownership_linker:Address matching failed: cannot access local variable 'owners' where it is
not associated with a value`. This is a Python `UnboundLocalError`, almost certainly because the
preceding step (`Assessed owner matching`) failed before assigning a local variable named `owners` that
the `Address matching` step then references unconditionally. **Fix this directly, independent of the
retry work** — the address-matching step should handle the case where the prior step failed (empty list,
explicit guard, or its own independent fetch) rather than assuming a variable from an unrelated failed
step is always set. This would still be a bug even after (b) is fixed, if some other transient failure
ever hits the same code path.

**(d) `utils_shared` — `pending_updates` fetch, no retry evident.**
`ERROR:utils_shared:Failed to fetch pending_updates: <ConnectionTerminated ...>` (also logged via a
second, differently-formatted line at the same timestamp — check whether that's two log handlers on one
logger, itself worth a one-line note if so). Apply the same retry pattern.

**(e) `ingestion_tracker` — retries twice, still fails.**
`ERROR:src.ingestion_tracker:failed to start ingestion_tracker run for cms_medicare_clinics after 2
attempts: <ConnectionTerminated ...>` followed immediately by a bare `NoneType: None` line (looks like a
`logger.exception()` call with no active exception context — a benign logging artifact, but confirm
rather than assume). This one already retries but with too few attempts or too short a backoff for
whatever's degrading the connection at this point in the run. **This matters beyond just this one
failure**: if `ingestion_tracker`'s row for this run was never created, this run is invisible to every
future live-verification query this arc has relied on (`select ... from ingestion_tracker where
started_at > ...`). Confirm whether this run in fact has no `ingestion_tracker` row, and whether that's
recoverable after the fact or just a gap for this one run.

**(f) The final run summary reported all zeros, with an explicit "not recorded" warning.** `Total clinics
in CMS file: 0`, every counter `0`, and `⚠️ Core ingestion counters were not recorded; summary reflects
diagnostic counters only`. Determine plainly: did the CMS-clinics fetch/processing phase of this run
(earlier than what this session's log excerpt captured) also hit zero real clinics due to the same
connection issue, or does the counters/summary mechanism itself silently fall back to zeros whenever an
upstream step errors, regardless of how much real work actually happened? These have very different
implications and shouldn't be conflated.

**(g) `Pipeline finished with 1 failed step(s): census_demographics`.** The actual failure detail for
this step isn't visible in the log window this session had — find and report what specifically failed
here (same connection issue, or something unrelated).

**(h) The actual crash Railway's email refers to isn't visible in the available log excerpt.** The log
window available to this session ends on what reads as an orderly (if all-zero) summary print, not a raw
unhandled traceback. Either the true crash trigger is just past that excerpt's cutoff, or the process
deliberately exited non-zero after printing that summary (e.g., because of (f) or (g) above). Determine
which, from whatever fuller log access exists in your session, and report the actual final exit reason
plainly.

## 2. The bigger question `PRI2` raised — worth a real answer, not just more patches

The identical `ConnectionTerminated` error is now confirmed across at least 4 different services/modules
(`public_record_ingest.py`, `cms_aux_ingestion`, `oig_leie_ingestor`, `ownership_linker`, plus
`utils_shared` and `ingestion_tracker`). Before or alongside patching each call site with
`safe_execute()`: is there a way to determine WHY these connections are being dropped in the first place?
Candidates worth checking, without assuming any of them: a recent httpx/supabase-py/postgrest-py version
bump; a Supabase-side connection-pooling or PgBouncer configuration change; a Railway-side network/proxy
change; or this being a long-standing, low-level-but-always-present condition that simply was never
visible until this arc started pulling this level of Supabase log detail. A confirmed root cause might
mean a single fix (e.g., a client config change, a keep-alive setting) makes most of `safe_execute()`'s
retry usage unnecessary going forward, rather than every call site needing its own retry wrapper forever.

## Out of scope

- `ratings`, `clinic_quality_metrics`, `properties.estimated_annual_revenue` — all separately tracked,
  don't touch.
- `public_record_ingest.py`'s `fetch_properties_for_extraction()` — already fixed in `PRI1`, don't touch.
- No retention/deletion of any rows in any table.
- No `life-command-center` code changes — entirely in `Dialysis`.

## Verify on

- (a)-(e): each call site's actual code quoted verbatim, the fix applied, and — per this arc's
  standing discipline — an actual before/after live proof where practical (a real batch/call that used to
  fail now succeeding), not just "added retries."
- (c): a plain statement of the actual root cause of the `UnboundLocalError` and the fix applied.
- (f), (g), (h): plain answers, not assumptions — if something can't be determined from available logs,
  say so explicitly rather than guessing.
- Section 2: a plain answer on whether an actual root cause was found, or whether it remains unknown and
  the call-site-by-call-site retry approach is the practical path forward for now.
