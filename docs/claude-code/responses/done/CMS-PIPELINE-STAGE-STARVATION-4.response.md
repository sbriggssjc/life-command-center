# CMS-PIPELINE-STAGE-STARVATION-4 — answered (CC), independently verified (Cowork) — and my own round-4 prompt was wrong

**Prompt:** `docs/claude-code/prompts/done/CMS-PIPELINE-STAGE-STARVATION-4-ownership-linkage-and-census.md`
**CC's raw response:** `docs/claude-code/responses/done/CMS PIPELINE STAGE STARVATION 4 surface response.docx`
**PR:** #7430, branch `claude/gracious-pasteur-dsysue` — open per CC, not independently verifiable (no direct GitHub access from this session). **Not merged, not deployed, no live run has tested it.**

## Correction, not silently fixed: round 4's premise was wrong

I filed `CMS-PIPELINE-STAGE-STARVATION-4` believing `ownership_linkage` was a new starvation bottleneck — that read came from `ingestion_tracker.notes.current_step` showing it as the run's last recorded step, without checking the `error_log` column. CC's investigation (and my own follow-up query) found `error_log` for that run read: `"Failed steps: financial_estimates, census_demographics; safe_execute errors: 4 total"`. `ownership_linkage` is simply the last step in the pipeline's step list — it's always what shows up when a run finishes normally, not evidence of a new bottleneck. My round-4 prompt's Question 1 was answered by CC pointing out the premise was wrong, which I'm recording plainly rather than glossing over.

## What was actually wrong, and independently verified

| Finding | CC's claim | Independently verified |
|---|---|---|
| **financial_estimates timeout** | CPU-bound loop: reads ~190k rows in 29s, then makes zero DB requests for 14.5 min before the 900s timeout; `clean_fields_for_table` costs ~5ms/row (~16 min total). Fixed by memoizing per distinct patient count. | `clinic_financial_estimates` hasn't gotten a new row since **2026-09-24 13:06:29** — consistent with this step failing on both the 09-25 and 09-26 runs. |
| **census_demographics** | Did run (started 07:10:08, before ownership_linkage). Census rejects the key as "Invalid Key" (not "missing") — likely unactivated or a copy-paste artifact. Code now strips stray whitespace/quotes; error reports key length + last 4 chars. | A `public_data_snapshots` row for `census_demographics` started `2026-09-26 07:10:08`, `run_status='started'` — confirms it ran and confirms the timing (before `ownership_linkage`). Cannot independently verify the "Invalid Key" HTTP response itself (no direct Census API access from this session) — taking CC's live test result as reported. |
| **public_data_snapshots id-loss (3rd instance of the `Prefer: return=minimal` bug)** | Rows never close — same class as round 1's `start_run()`. Fixed. | 5 of the last 10 `census_demographics` rows in `public_data_snapshots` show `run_status='started'`, `finished_at=null`, dating back to 2026-04-08 — matches exactly. |
| **bd_flags** | `bd_flags` is a view over `alerts_unified` missing `entity_type` (NOT NULL there) — every insert has always failed. Circuit breaker + hidden duplicate-check bug compounded it. Fixed at the source (`create_bd_flag`, `log_alert_unified`, `resolve_bd_flag`). | Confirmed `bd_flags`'s column list has no `entity_type`; `alerts_unified`'s `entity_type` is present. Confirmed `alerts_unified` has **zero** rows with `change_source='bd_flags'`, ever — no BD flag (including CMBS-distress signals) has ever actually been stored. |
| **recorded_owners** | Unchanged, same known duplicate-key row. | Not independently re-checked this round (no new claim to verify). |

## Corrections to this session's own prior documentation

**This round's own premise** (see above) — corrected explicitly in both `STATUS.md` and `PLANNED-BACKLOG.md`, not silently edited away.

## Documentation updates made

- `PLANNED-BACKLOG.md`: appended round-4 answer + self-correction to `CMS-PIPELINE-STAGE-STARVATION`'s row; updated its status cell.
- `STATUS.md`: appended a sentence to the CoStar/PRI open-threads row; new dated section `## 2026-09-26 — CMS-PIPELINE-STAGE-STARVATION-4 answered (CC): correcting my own wrong premise; ...`.

## Still open / not yet resolved

- **PR #7430 is not merged or deployed. No live run has tested any of round 4's fixes.**
- **`census_demographics` needs Scott's action**: check the Census signup email for an activation link, or re-paste the `CENSUS_API_KEY` on the Railway cms-ingestion service — the key currently set is being rejected as invalid, not missing.
- Tests reported by CC (16 new/rewritten, full suite 3,411 passed / 2 failed, both pre-existing on `main`) are not independently re-run from this session — no code execution access to the Dialysis repo.
- `recorded_owners`'s duplicate-key issue remains filed, not fixed (doesn't block anything).

## Verify on the next run after deploy

- Does the run close `success` (or `partial` naming only `census_demographics` if the key is still unactivated)?
- Does `financial_estimates` finish in seconds rather than timing out?
- Does the census row in `public_data_snapshots` close with a status and reason, or does `census_zcta_demographics` gain 2022-vintage rows?
- Does `alerts_unified` gain rows with `change_source='bd_flags'`, and does `ingestion_run_errors` show no `bd_flags` errors?
