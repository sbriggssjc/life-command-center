# HCRIS-TIMEOUT-cost-report-ingestion-times-out-every-run-facility-cost-reports-stale-182-days — response (transcribed 2026-09-14)

> Recovered from Scott's own saved transcript (`"HCRIS TIMEOUT surface response.docx"`, untracked,
> `docs/claude-code/responses/`) — same recovery method as the rest of this arc. **Repo: `Dialysis`. This
> session verified this against the transcript and an independent live query against `facility_cost_reports`
> and `ingestion_tracker` in Dialysis_DB.** All four catalog items answered with real root causes, and one
> unprompted finding is materially bigger than the prompt scoped.

## (a) Root cause — two distinct bugs, not one

`hcris_cost_reports` (`src/hcris_cost_report_ingestor.py::_download_and_extract`): used a bare
`requests.get(url, timeout=300, stream=True)`. A single float timeout only bounds each individual socket
read — a connection trickling a few bytes every ~299 seconds never trips it. This is the exact bug class
this repo's own CMS Ingestion Hang-Guard doctrine already documents as fixed elsewhere (`_safe_get`, used
by `ingest_medicare_clinics._download_csv`) — it was simply never applied to this module.

`hcris_propagation` (`src/hcris_propagator.py::propagate_hcris_to_properties`): called
`tracker.save_estimate(estimate)` once per CCN, each call doing 2–3 sequential Supabase REST round trips
(SELECT existing → optional demote UPDATE → INSERT/UPDATE). A textbook unbatched N+1 over the full,
unfiltered national HCRIS population — the same anti-pattern already fixed in `patient_count_ingestor.py`
but never ported to this module.

## (b) The fix

Bounded connect/read timeouts plus an explicit wall-clock deadline on the download (env-tunable). A new
`save_estimates_batch()` — one prefetch + chunked bulk writes, preserving the exact demote-then-insert
business rule; the existing `save_estimate()` and its 5 other callers left untouched. Sized per-step timeout
overrides (1800s each, env-tunable) so these two steps get the same treatment `medicare_ingestion` already
has.

## (c) `run_timeout` — not a third failed step, and a materially bigger finding than scoped

`_run_timeout` (default 5400s/90min) is checked before starting each step; once exceeded, the loop simply
breaks — **every remaining step is silently skipped, no exception raised, no log entry written**, and a
synthetic `summary["run_timeout"]` key (a string starting `"error:"`) gets swept into `"Failed steps"` so it
reads like an ordinary step failure rather than a budget cutoff.

**Confirmed, not guessed — yes, it was silently killing other steps too.** `hcris_cost_reports` and
`hcris_propagation` sit 9th/10th of 15+ steps, so their hang routinely burned the entire run budget, meaning
`financial_estimates`, `property_financials`, `trend_detection`, `target_flagging`, and other downstream
steps frequently never ran at all — a materially wider, previously invisible gap than the prompt scoped.

**Fix**: `run_timeout_skipped_steps` now names every step the clock dropped, not just the one it happened to
be checking when the budget ran out.

## (d) Staleness — confirmed, not a separate path

`hcris_cost_report_ingestor.py`'s `.upsert()` is the sole writer of `facility_cost_reports` anywhere in the
repo — `hcris_propagator.py` and `propagate_property_financials.py` only read it. If the ingest step never
reaches its upsert, the table cannot move. This fully explains the 182 days of staleness with nothing else
in play.

## Test results

26 new tests. Full suite: **3,262 passed, 9 skipped, 1 xfailed** — 1 pre-existing, unrelated failure
disclosed explicitly, confirmed to reproduce identically on unmodified `main`.

## Live re-check performed by this session before filing this review

The currently-running cycle (`ingestion_tracker` row `a9336aea…`, started 2026-09-14 06:03 UTC, now ~7h in)
predates this fix and is still running on old code — `facility_cost_reports` remains at its
`max(updated_at)` = 2026-03-16 (182+ days), exactly as expected since no post-fix cycle has completed yet.
**Not yet independently proven live** — the next full run cycle after this fix deploys is the real proof
point, same as most rounds in this arc at this stage.

## Delivery

Branch `claude/hcris-timeout-fix-01BWJTdN`, PR opened (`https://github.com/sbriggssjc/Dialysis/pull/new/claude/hcris-timeout-fix-01BWJTdN`
— note this is the PR-creation link, not necessarily a confirmed-numbered PR the way `PRI5`/`PRI6` opened
theirs; worth confirming the actual PR number once Scott has it). **Merge status unconfirmed** — same
recurring pattern as every round in this arc: asked Scott to confirm the `Dialysis`-side PR is merged
separately from any `life-command-center` documentation PR.
