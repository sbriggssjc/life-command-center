# CMS-PIPELINE-STAGE-STARVATION-3 — answered (CC), independently verified (Cowork)

**Prompt:** `docs/claude-code/prompts/done/CMS-PIPELINE-STAGE-STARVATION-3-order-of-ops-and-remaining-blockers.md`
**CC's raw response:** `docs/claude-code/responses/done/CMS PIPELINE STAGE STARVATION 3 surface response.docx`
**PR:** #7429, branch `claude/beautiful-galileo-kme2el` — **open, not merged, not deployed, no live run has tested it yet.**

## Question 1 — is the ratings/CQM/qip/deficiencies staleness benign or a new starvation shift?

**CC's answer: a real bug, not benign.** Both the 09-24 18:30 and 09-25 06:05 runs failed with a `run_timeout`, stuck on `medicare_ingestion`'s heartbeat. The mechanism: `medicare_ingestion`'s `retry_missing_records()` checks "does this clinic already exist" with an unpaged Supabase read, which PostgREST caps at 1,000 rows — so ~7,500 of 8,547 real clinics looked missing every run, and every one of the ~14,000 resulting re-saves came back HTTP 400 and never landed. The step's own 45-minute timeout fired around 06:53 both times but was caught as a routine failure and the loop kept going; the run's 90-minute step-budget cap then stopped the whole run at 108 minutes, before `aux_cms_tables` — so `ratings`/`clinic_quality_metrics`/`qip_scores`/`facility_deficiencies` were never reached.

**Independently verified, live (Supabase, project `zqzrriwuavgrquhisnoa`):**
- `ingestion_tracker`: both parent `cms_medicare_clinics` rows (started 2026-09-24 18:30:24 and 2026-09-25 06:05:35) show `run_status='partial'` with `notes.current_step = "medicare_ingestion"` and an early `heartbeat_at` (18:33:45 / 06:08:47) — confirms the heartbeat never advanced past that step, exactly as CC described, not taken on their word.
- `clinic_history_unified`: exactly **10,523** rows created since 2026-09-24 18:00 — matches CC's "10,523 noise rows" figure exactly.
- `ingestion_run_errors`: most recent row is `2026-09-24 15:04:45`, zero since — matches CC's claim of a logging gap exactly, even though ~14,000 saves were rejected across the two later runs. CC didn't find why the helper swallows this error; flagged, not fixed (deprioritized since the retry-pass fix should stop touching existing clinics at all).

**Fix:** the existence-check read now pages through all rows; the retry pass skips itself rather than re-running against every clinic if it can't finish; the step timeout now actually ends the step. Expected to bring `medicare_ingestion` down to roughly 17 minutes.

## Question 2 — the three known blockers

| Item | CC's finding | Independently verified | Resolution |
|---|---|---|---|
| **HCRIS cost reports (`hcris_cost_reports`, actually `facility_cost_reports`)** | All four previously-guessed URLs 404. Real files: `RNL11-ALL-YEARS.zip` and `RNL11-REPORTS.zip`, found by reading CMS's page through the database's own outbound web access (the coding sandbox can't reach `cms.gov`). | `facility_cost_reports`: 94,473 rows, `max(updated_at) = 2026-03-16` — matches CC's row count exactly. | **Fixed, not yet deployed/tested.** |
| **cms_deficiencies (900s timeout)** | The CMS dataset (`r5ix-sfxw`) is nursing-home deficiencies, not dialysis. 0 of 463,058 rows match a dialysis clinic. The "25,837 rows" figure from round 2 was wrong; 250,600 rows were rewritten on 09-24. | `facility_deficiencies`: 463,058 total rows, `max(updated_at) = 2026-09-24 14:31:52` — matches exactly. 0 matching `medicare_id` against `medicare_clinics` — confirmed independently. | **Resolved as "wrong dataset," turned off by default** (`CMS_ENABLE_NURSING_HOME_DEFICIENCIES=1` to re-enable). `facility_deficiencies` stays stale by design — CMS doesn't publish a dialysis-specific deficiency dataset here. |
| **census_demographics (non-JSON response)** | `api.census.gov` returns an HTML "Missing Key" page with a 200 status when no key is provided. `CENSUS_API_KEY` isn't set anywhere. Its upsert also had the CB3 header-defect (plain INSERT, not `merge-duplicates`). | Can't verify Railway env vars from Supabase; taking CC's claim as-is pending Scott's confirmation. | **Needs Scott:** get a free key at https://api.census.gov/data/key_signup.html and set `CENSUS_API_KEY` on the Railway cms-ingestion service. Upsert defect fixed in this round regardless. |

## The recorded/watermark tracker states — explained

Not new instrumentation, as suspected last round — both go back to 2026-03-24. `watermark` is the data-version stamp written when the medicare ingest completes. `recorded` is a redundant second stamp with no code path that ever closes it. **Independently verified:** all 27 `run_status='recorded'` rows (including `8622dc69…` and `8f615de8…`, the ones flagged last round as sitting open for 5+ hours) now show `started_at = finished_at` — 0 remain open. CC closed them in the database (reversible); new ones are now written already closed.

## Corrections to this session's own prior documentation

None needed this round — round 3's independent verification matched CC's figures exactly on every load-bearing number checked (heartbeat/current_step, the 10,523 noise-row count, the ingestion_run_errors cutoff timestamp, the facility_cost_reports row count, and the facility_deficiencies row count/CCN-match count). Also confirmed: the table this arc has called "`hcris_cost_reports`" in documentation shorthand for ten-plus rounds does not exist as an actual table name — the real table is `facility_cost_reports`. Noted for clarity going forward, not a correction of a prior claim (the shorthand was never presented as the literal table name).

## Documentation updates made

- `PLANNED-BACKLOG.md`: appended round-3 answer to `CMS-PIPELINE-STAGE-STARVATION` (🟢, PR #7429 open/undeployed), `HCRIS-TIMEOUT` (🟡→🟡 with real URLs found), and `RATINGS-CQM-CB3-upsert-class` (🟡, 9th instance fixed by name).
- `STATUS.md`: appended a sentence to the CoStar/PRI open-threads row; new dated section `## 2026-09-25 — CMS-PIPELINE-STAGE-STARVATION-3 answered (CC): ...`.

## Still open / not yet resolved

- **PR #7429 is not merged or deployed.** No live run has tested any of round 3's fixes. The very next run after deploy is what actually answers whether `ratings`/`clinic_quality_metrics`/`qip_scores` move once `medicare_ingestion` stops eating the run budget — that's the real verification, not this write-up.
- **`census_demographics` needs Scott's action** (Railway env var) before it can be verified at all.
- **The `ingestion_run_errors` logging gap** (swallowed 400s since 09-24 15:04) is unresolved at the root-cause level, just deprioritized.
- **`clinic_history_unified`'s 10,523 junk rows and the matching `learning_logs` rows are not deleted** — flagged for cleanup, not yet done.
- **The class-wide `RATINGS-CQM-CB3-upsert-class` sweep (~133 call sites) still hasn't been started or prompted** — CC again recommended a dedicated round.

## Verify on the next run after deploy

- Does the run close without `run_timeout`/`partial`, past `medicare_ingestion`?
- Do `ratings`, `clinic_quality_metrics`, and `qip_scores` show new `updated_at` times?
- Does `facility_cost_reports` finally get real writes from the corrected URLs?
- Does `clinic_history_unified` grow by a realistic number of actual address changes, not ~7,000?
