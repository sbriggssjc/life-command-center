# CMS-PIPELINE-STAGE-STARVATION-4 — find what's gating ownership_linkage, confirm census_demographics actually runs, and clean up two new defects

**Repo root: `Dialysis` / `DialysisProject`.**

## Context

PR #7429 (branch `claude/beautiful-galileo-kme2el`) is merged and deployed. `CENSUS_API_KEY` is now set on the Railway cms-ingestion service. The first pipeline run since deploy (scheduled 06:05 UTC 2026-09-26, closed 07:26:50 UTC) is real, substantial progress:

- `ratings`, `clinic_quality_metrics`, and `qip_scores` all got fresh writes for the first time since 2026-09-24 — the `medicare_ingestion` retry-loop fix genuinely broke the starvation blocking them.
- `facility_cost_reports` grew from 94,473 to 101,619 rows (+7,146) — the corrected HCRIS URLs are pulling real data.
- `facility_deficiencies` correctly stayed untouched — it's disabled by design now, not a bug.
- `cms_medicare_clinics`'s nested run dropped from 1h44m to 31 minutes, matching your estimate.

But the run still closed `run_status='partial'` (81.8 minutes, down from 108 but still not a clean finish), and two things are still open.

## Question 1 — what's gating `ownership_linkage`?

`ingestion_tracker.notes.current_step` was `"ownership_linkage"` when this run closed `partial` — the *first time this exact step has ever been the run's closing step* in this table's history (it was always `medicare_ingestion` or unrecorded before). This looks like the same starvation shape this whole arc keeps finding, just relocated now that `medicare_ingestion` is fixed. Read the actual step order and whatever gates `ownership_linkage` (a step timeout? the same run-budget cap medicare_ingestion hit? something else?) and give a real, code-and-evidence-based answer — not a guess from the write pattern. If it's a genuine bug (an unbounded loop, an unpaged read, a swallowed timeout — the same shapes found in this arc before), fix it. If it's legitimately just a slow step that needs more budget, say so and size the fix.

## Question 2 — is `census_demographics` actually running, now that the API key is set?

No `census`-named row appeared anywhere in `ingestion_tracker` for this run, no error was logged for it in `ingestion_run_errors`, and the two tables that look like census's target (`property_demographics`, `census_zcta_demographics`) are both still frozen from March/April — meaning the run most likely never reached this step (it probably comes after `ownership_linkage` in the step order, which is where this run stopped). Confirm where `census_demographics` actually writes, confirm it's wired to run after `ownership_linkage` gets past its bottleneck, and — once Question 1's fix is in and a run can actually reach it — verify it writes real data with the new key. Setting the key alone doesn't prove the code path works; get real evidence.

## Also, two new/recurring defects found in this run — fix if quick, otherwise file and move on

- **New: `bd_flags` insert failures.** `alerts_unified.entity_type` violates a NOT NULL constraint when a `bd_flags` row is inserted, and subsequent inserts trip a `circuit_open` state. Example from this run's error log: a CMBS-distress flag insert (id 301) failed with `null value in column "entity_type" of relation "alerts_unified" violates not-null constraint`. This looks unrelated to the CMS pipeline itself — probably a trigger on `bd_flags` that populates `alerts_unified` without setting `entity_type`. Fix if it's a quick trigger fix; otherwise file it with enough detail to pick up later.
- **Recurring: `recorded_owners`'s duplicate-key CB3 defect.** Already logged (not fixed) in round 2 — recurred again this run (`duplicate key value violates unique constraint "recorded_owners_name_key"`, `V V Continental Llc`). No new work needed unless it's now blocking something new; just confirm it's still just this one known issue.

## Explicitly not in scope for this round

Don't re-touch `medicare_ingestion`'s retry-loop fix, the HCRIS URLs, or the `cms_deficiencies` dataset-mismatch resolution — all confirmed working live. Don't take on the full `RATINGS-CQM-CB3-upsert-class` census sweep unless it's directly relevant to the `bd_flags` finding above.

## What "done" looks like

- `ownership_linkage`'s bottleneck is understood and either fixed or explained with a concrete budget/sizing recommendation.
- `census_demographics` is confirmed either (a) still unreached because of Question 1, with a clear plan for how it gets tested once that's fixed, or (b) reached and either writing real data or failing with a specific, actionable error.
- The `bd_flags` NOT NULL defect is fixed or clearly filed.

## Verify on

- The next run after any fix: does it close without `run_timeout`/`partial`? Does `census_demographics`'s actual target table(s) get fresh writes?
- Whether `bd_flags` inserts succeed without tripping `circuit_open`.
