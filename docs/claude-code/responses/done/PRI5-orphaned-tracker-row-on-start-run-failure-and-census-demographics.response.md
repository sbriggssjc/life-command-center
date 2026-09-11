# PRI5-orphaned-tracker-row-on-start-run-failure-and-census-demographics — response (transcribed 2026-09-11)

> Recovered from Scott's own saved transcript (`PR15 surface response.docx`, untracked,
> `docs/claude-code/responses/`) — same recovery method as the rest of this arc. **Repo: `Dialysis`.
> This session verified this against the transcript only — `Dialysis` is not reachable from this
> session (no credentials).** This is a strong, thorough response — all three items answered directly,
> with actual root causes found rather than repeated "undetermined," and this session's own live checks
> from filing the prompt are directly addressed and confirmed.

## (a) The `ingestion_tracker` orphaned-row gap — root cause found, fixed, and proven live

**Code path, quoted from the response**: `ingestion_tracker.start_run()` inserts via `safe_execute`
(6-attempt budget, `PRI3`'s own hardening) and returns `None` on exhaustion — logging but never raising.
Its only caller, `run_cms_ingestion()`, does `_CURRENT_RUN_ID = ingestion_tracker.start_run(...)` with no
check on the result — if `None`, the pipeline just proceeds with `_CURRENT_RUN_ID = None` for the rest of
the run, and nothing ever revisits that call.

**Why the row exists at all, explained precisely**: the exact row this session flagged live
(`c817274e-fad2-421a-861d-ad8afb699f4d`, `started_at 18:25:41`) is this mechanism exactly — the insert
reached Supabase and committed, but the connection dropped before the client got the acknowledgment, so
`start_run()` correctly reported failure (it has no way to know the insert landed) and returned `None`.

**A second, distinct orphan class found while reading the code, not asked for but caught anyway**:
`ingest_medicare_clinics()`'s sub-step separately calls `ingestion_lock.acquire_ingestion_lock()` on the
same `dataset_id` (`source='ingestion_lock'`), and that lock row can also be left `started` if
`release_ingestion_lock()` is never reached. Confirmed live: a second orphan (`06fe4f24-…`,
`source=ingestion_lock`) exists the same way. 6 orphans total existed at investigation time, across both
sources — a broader problem than this session's own live count of 5 caught (it only checked one source).

**The fix**: a new `ingestion_tracker.reclaim_stale_started_runs()`, wired at the top of
`run_cms_ingestion()` before a new tracker row is created. **Deliberately not a lock** — it never denies
or blocks, and only touches rows older than 2 hours (well past the pipeline's own 90-minute wall-clock
cap, so a genuinely in-flight run's row can never be touched). The response explains a real alternative
considered and rejected: reusing `acquire_ingestion_lock` for the outer row would collide with the inner
sub-step's own lock query on the same `dataset_id`, either denying the sub-step every run or force-
reclaiming the outer row mid-flight. The bounded age-sweep avoids that collision while closing both
orphan classes (no `source` filter).

**Live before/after, the non-negotiable this arc requires**: the response applied the identical `UPDATE`
the new function issues and confirmed it closed 2 of the 6 known orphans (the ones already past the
2-hour window); the other 4 (including the exact row `c817274e…` this session flagged, at 1.1h old) were
correctly left untouched, still inside the safety window — they'll close automatically on the next
scheduled run via the same mechanism. This directly answers and resolves the gap this session caught
live before filing the prompt.

## (b) `census_demographics` — the actual root cause found this time, not another "undetermined"

**Found, not guessed, and confirmed against live data.** `ingest_census_demographics()` calls
`_fetch_acs_data()` — a bare, unguarded `requests.get()` to `api.census.gov` (a completely different host
than Supabase, unrelated to this arc's connection-instability story), with `resp.raise_for_status()` and
no retry. `CENSUS_API_KEY` is never set anywhere in the repo's config, so every call runs against
Census's unauthenticated, more rate-limited tier. Any timeout/429/5xx there raises straight out of
`ingest_census_demographics()` and becomes the observed "Pipeline finished with 1 failed step(s):
census_demographics."

**The tell that this is the right mechanism, not a guess**: `oig_leie_ingestor`'s equivalent external
fetch (`_download_leie_csv`, the same host-class risk) already wraps its call in a
try/except → `record_snapshot_finish(..., run_status="failure", ...)` pattern.
`census_demographics_ingestor.py`'s own comment claims it was fixed "alongside" the LEIE ingestor in an
earlier round, but that fix only copied LEIE's upsert-loop hardening (`safe_execute`), never the
fetch-call guard — this is the missing half.

**Confirmed against live data, not just code reasoning**: `public_data_snapshots` for
`census_demographics` has zero rows for 2026-09-11 (the crash happened before any snapshot could be
logged), and three PRIOR rows (2026-04-08, 2026-05-16, 2026-06-13) are still `run_status='started'`,
`finished_at=null` months later — the identical unguarded-fetch-exception pattern, recurring for months
before this arc caught it.

**Fix**: wrapped the fetch call to mirror `oig_leie` exactly — catch, `record_snapshot_finish(...,
run_status="failure", failure_reason=str(exc)[:2000])`, return `{"error": str(exc)}` instead of letting
the exception escape. **A related gap found and fixed in the same pass**: returning a clean `{"error":
...}` dict instead of raising would have made the step loop silently read it as success (nothing checked
the returned dict's shape except a `medicare_ingestion`-specific special case) — generalized that check
to every step, so `census_demographics` (and `oig_leie_exclusions`, which had the same latent gap) still
honestly reports as a failed step in the summary rather than disappearing.

**Recommended as a config action, separate from the code fix**: setting `CENSUS_API_KEY` in Railway's
environment would meaningfully reduce how often this fails in the first place (the authenticated tier is
far less rate-limited) — not required by the code fix, but worth doing.

## (c) The all-zero-counters "benign" conclusion — re-checked against this run's mechanism, not re-asserted

**Actually checked, not repeated from `PRI3`.** The response traced which modules populate
`RUN_METRICS`/`increment_summary` (what `print_run_summary()` reads):
`email_processor.py, file_processor.py, ai_scrubber.py, database_updater.py,
facility_patient_counts_ingest.py, patient_count_ingestor.py, supabase_helpers.py, utils_shared.py,
main.py` — **neither `run_cms_ingestion.py` nor `census_demographics_ingestor.py` appears in that list**.
Structurally, `census_demographics` cannot move this counter whether it succeeds or fails; they're
separate code paths by construction, answering this session's (c) question directly rather than
re-asserting the earlier finding.

For this specific run, confirmed against the DB: `facility_patient_counts` (the one sub-step that does
feed the counter) has its newest row created 2026-08-31 — zero rows created on this run's date, matching
this repo's documented cadence (CMS publishes roughly annually; a re-run against an unchanged period is
an expected idempotent no-op). Combined with the real, non-zero `ownership_linker`/Salesforce numbers
reported later in the same run (independent evidence the pipeline ran to completion), `PRI3`'s "benign"
conclusion holds for this run specifically, verified rather than assumed.

## Test results

7 new tests in `test_pri5_orphaned_tracker_and_census_fetch.py`, all passing. Full adjacent surface
(`ingestion_tracker`/`run_cms_ingestion`/`census`/`PRI3`/`PRI4`, 286 tests): **285 pass, 1 pre-existing
unrelated failure that reproduces identically on unmodified `main`** — an honest, specific disclosure
rather than a blanket "all green."

## Files changed

`ingestion_tracker.py` (+124/-0), `run_cms_ingestion.py` (+21/-0), `census_demographics_ingestor.py`
(+27/-1), `test_pri5_orphaned_tracker_and_census_fetch.py` (+385/-22).

## Delivery

Branch `claude/pri5-orphaned-tracker-census-fetch-01GxMxwCW2SAzRsdcWBFNViM`, pushed. **PR
`sbriggssjc/Dialysis#7408` was actually opened this round** (unlike `PRI3`/`PRI4`, which only referenced
a tracking PR number without confirming it was opened) — **merge status still unconfirmed**, same open
item as every prior round: Scott's "This PR is merged" message needs to be confirmed as covering this
specific `Dialysis`-side PR, not just the `life-command-center` documentation PR that filed this review.
