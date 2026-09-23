# RATINGS-CQM-CIRCUIT-BREAKER-3 — response (transcribed 2026-09-23)

> Recovered from Scott's own saved transcript (`"Ratings CQM circuit breakers 3 surface response.docx"`, untracked,
> `docs/claude-code/responses/`). **Repo: `Dialysis`/`DialysisProject`.**

## What CC reports

**Root cause found — the same defect class that broke `ratings` in round 2, now found in `clinic_quality_metrics`'s
new upsert code.** `get_supabase_client()` sets a client-wide `Prefer: return=minimal` header. In `postgrest` 2.31,
`.upsert()` builds its own `Prefer: ...,resolution=merge-duplicates`, but then the client-wide headers get copied
over it, replacing what `.upsert()` built. The request still carried `?on_conflict=medicare_id,snapshot_date`, but
PostgREST ignores that without a resolution preference telling it what to do on conflict — so it ran a plain
`INSERT`, which 23505s on every existing row. `safe_execute()` tries to restore the upsert header afterward but
looks for it on `builder.headers`; the object `.upsert()` actually returns keeps its header on
`builder.request.headers`, so that repair silently never ran. Confirmed via a mock transport: the live request goes
out as `Prefer: return=minimal` only.

**Live state confirmed by CC**: row `medicare_id=012501`/`snapshot_date=2023-12-31` has existed since 2026-03-11;
the newest `created_at` in the whole table is 2026-03-12 — every row this step touches already exists, so every
write has been colliding since the table was first populated.

**CC's own evaluation of the four hypotheses this round's prompt posed**: (1) partly right — the `on_conflict`
columns were correct, but the header that makes PostgREST honor them was missing; (2) no — `_direct_upsert_record`
is a genuine `ON CONFLICT` on the direct-DB path, but that path returns `None` on Railway (still unexplained why),
so every write falls through to the REST path; (3) no retry/race found; (4) no, the row is ordinary, it simply
already exists.

**Fix**: a new `_ensure_merge_duplicates_prefer` helper puts `resolution=merge-duplicates` back onto
`builder.request.headers` right after `.upsert()` builds the request, keeping whatever else is already on it.
Called only on the `clinic_quality_metrics` REST write. `ratings` and the `properties`/`facility_patient_counts`
paths are untouched. Round 1's comment claiming this write path "can never raise 23505" was corrected.

**Tests**: 5 new (`tests/test_ratings_cqm_circuit_breaker_3.py`), built against the real `postgrest` client and the
real `safe_execute()` against a fake server that returns `409`/`23505` for an existing key sent without
`resolution=merge-duplicates` — removing the fix call reproduces the exact production error. One test checks the
library behavior itself and is designed to fail if a future `postgrest` release stops letting the client-wide
header win (an early warning if the underlying assumption changes). Full suite: 3,363 passed, 2 failed — the same
2 pre-existing failures (`test_financial_propagation_logs_correction`, `test_preflight_missing_column`) reproduced
on unmodified `main` in CC's sandbox too, confirmed not caused by this change.

**Why round 1's 22 tests missed this entirely**: they stubbed both `safe_execute` and the client and only checked
that the call was *named* "upsert" — the header merge and PostgREST's actual handling of the request were never
exercised.

**The same defect is probably elsewhere — flagged, not fixed this round.** `src/` has 133 `.upsert(` call sites
across 63 files, all potentially affected by the same client-header-overwrite issue via `get_supabase_client()` +
`safe_execute()`. That includes `_ingest_payer_mix`/`_ingest_ownership_history` — the two paths round 1 called
"already-proven" and used as its fix template. They show no `23505`s in the last 3 days, but CC is explicit that
this only means they haven't yet collided with an existing key, not that they're immune. The root fix (making
`safe_execute()` write to `builder.request.headers` instead of `builder.headers`) would change every upsert call in
the repo at once, so CC filed it as its own round (`RATINGS-CQM-CB3-upsert-class`) rather than doing it inline.

**Secondary ask (tracker rows not closing) — also filed as its own round, not investigated further.** Every
`cms_ingestion` tracker row since 2026-09-22 has only ever been closed by the *next* run's reclaim; every one has
an empty `error_log` and `notes='{}'`, which CC reads as neither the error handler nor the shutdown handler having
run — consistent with a process that's hard-killed or exits without ever calling `finish_run()`. Separately, the
15:40 UTC run started without reclaiming the 06:03 row even though it was 9.6h old against the reclaim logic's 2h
threshold. Filed as `RATINGS-CQM-CB3-tracker-close`.

**Delivery**: `Dialysis` branch `claude/jolly-galileo-2a31j3`, **PR `sbriggssjc/Dialysis#7426`** (opened after the
fact — CC's response initially said "I didn't open a PR," then confirmed one exists tracking this branch). Contains
one commit: the header fix, 5 new tests, and a `CLAUDE.md` section documenting both open follow-up items. Scott
reports merged.

## Independent verification performed by this session

- **Mechanism is plausible and consistent with round 2's finding** (the same client-wide `Prefer: return=minimal`
  header defeating a different response-handling assumption) — this session did not re-derive the `postgrest` 2.31
  internals directly (no code access to `Dialysis` from this session), so the header-merge mechanism itself rests
  on CC's own wire-level test, same bar as prior rounds' code-level claims.
- **No live run has tested this fix yet.** Independently queried `ingestion_tracker`: the run in progress at the
  time of this check (`04153e0c…`, `cms_medicare_clinics`, started 2026-09-23 15:40:06 UTC) started before this PR
  could have merged (Scott's merge report arrived after that run was already running), so it predates the fix.
  `clinic_quality_metrics.updated_at` is still frozen at 2026-09-22 14:24:22 as of this check — unchanged.
  **`clinic_quality_metrics` closes to 🟡, pending live proof, not ✅.**
- **The tracker-never-closes claim independently confirmed, not accepted at face value**: queried the 06:03 pair's
  tracker rows (`a0353e28…`/`f8acb450…`) directly — still `run_status='started'`, `finished_at=null`, now 11h45m
  old. Genuinely not reclaimed by the 15:40 run, matching CC's claim exactly.
- **New anomaly noticed while verifying, not yet understood**: the in-progress 15:40 run has no paired
  `facility_patient_counts` tracker row (every prior trigger produced two rows seconds apart) and, over 2h08m, has
  touched only 3 of 11,844 `properties` rows and logged zero errors of any kind. Flagged for its own watch, not
  folded into either fix's evaluation since it isn't yet understood.

## Delivery

Code changes in `Dialysis`/`DialysisProject`. **PR `sbriggssjc/Dialysis#7426` (`claude/jolly-galileo-2a31j3`) —
Scott reports merged; no direct GitHub confirmation available from this session.** `clinic_quality_metrics` held at
🟡 pending live proof. Two new backlog rows filed for the follow-up items CC flagged but didn't fix:
`RATINGS-CQM-CB3-upsert-class` (repo-wide header risk, 133 call sites) and `RATINGS-CQM-CB3-tracker-close`
(tracker rows only ever closing via reclaim). Neither prompted yet.
