# RATINGS3-live-proven-upsert-fix — response (transcribed 2026-09-10)

> Recovered from Scott's own saved transcript (`Ratings 3 follow up surface response.docx`, untracked,
> `docs/claude-code/responses/`) — same recovery method as the rest of this arc. **Repo: `Dialysis`.
> This session verified this against the transcript only — `Dialysis` is not reachable from this
> session (no credentials), so nothing here is independently re-read against the actual diff.** Unlike
> RATINGS2, this response's central claim (live before/after proof) is exactly what this arc's prior two
> rounds were missing, so it is transcribed here in full rather than summarized past the point of
> checkability.

## Unit 1 — deployed code confirmed to match RATINGS2's own description, word for word

Read `_direct_upsert_record` and `_ingest_ratings()` as they exist on `main` post-RATINGS2-merge.
Confirmed: `conflict_where="medicare_id IS NOT NULL"` is passed exactly as RATINGS2 described, the REST
fallback is the explicit update-then-insert (not an `ON CONFLICT` clause), and both paths are reachable
from `_ingest_ratings()`. No mismatch between the deployed code and RATINGS2's own writeup — this round
did not find a "the PR description lied" problem.

## Unit 2 — the failure WAS reproduced live, and the reproduction revealed the real root cause

Using the reauthorized Supabase MCP, queried `postgres_logs` for the `ratings_medicare_id_uidx`
duplicate-key errors from the 2026-09-10 run cited in the prompt (18:00–18:59 UTC). Confirmed the errors
are real and match the counts in the prompt.

Went one step further than the prompt required: cross-referenced `ingestion_tracker` and found the run
**started at 17:23:08 UTC** — a full **69 minutes before RATINGS2 merged at 18:32:10 UTC**. Broke the
error rate down minute-by-minute across the whole run and found **no discontinuity at the merge
instant** — the duplicate-key rate was flat before and after 18:32:10, meaning the running container was
executing the pre-RATINGS2 code in memory for the entire run. **A code fix merged to `main` cannot repair
a process that is already running old code** — this is a "merged is not running" class problem, not a
defect in RATINGS2's fix itself. This reframes both RATINGS-INSERT-COLLISION's and RATINGS2's "still
broken" verdicts: the code may have been correct earlier than believed, but was never actually running
in the window used to judge it.

## Unit 3 — the fix proven live, against an actual row — the one non-negotiable requirement

Ran the actual upsert client (not a mock, not a test double) directly against Dialysis_DB, targeting
`id=1` / `medicare_id='012500'` (confirmed to exist first). Before: existing row present, no error.
After: **no `42P10`, no `23505`** — the write succeeded as a real UPDATE, not a duplicate-insert
collision. `ratings` row count held steady at **7,013** (correct — an update, not a new row).

**New defect found in the process of proving this**: `updated_at` did not change on the before/after
row, because **neither write path (`_direct_upsert_record` nor the REST fallback) has ever stamped
`ratings.updated_at`**, and the table has no update trigger to do it automatically. This means the exact
metric (`max(updated_at)` unchanged at 2026-03-12) used throughout this entire three-round arc to judge
success or failure was structurally blind to a successful write — a real fix could have looked identical
to a total failure by this measure alone. (The RATINGS2-era duplicate-key storm itself was independently
confirmed via `postgres_logs` counts, so that specific earlier failure was real and not just a
measurement artifact — but the blind spot compounds how hard it's been to trust any single round's
verdict.) Fixed by stamping `updated_at` explicitly in both write paths, gated on column existence (same
pattern as other optional-field handling in this codebase).

## Unit 4 — the 6 statement timeouts: correlated, not proven causal

Confirmed 6 genuine Postgres `canceling statement due to statement timeout` events within 18:00–18:59
UTC (13 total across the broader 17:22–19:22 UTC window). Could not attribute a specific cause — this log
level doesn't retain the actual `STATEMENT` text, so there's no way to confirm they were the
duplicate-key storm's lock contention versus something unrelated running concurrently. Stated plainly as
correlation, not causation, rather than assuming the more convenient answer.

## Unit 5 — real test coverage added; the prior test gap named explicitly

Confirmed RATINGS2's own tests used a **mocked cursor asserting a WHERE-clause substring**, never a real
Postgres partial index — which is exactly why two rounds of green tests coexisted with 100% live
failure; a mock can't fail the way a real partial unique index fails. Added two new regression tests
exercising the `updated_at` stamp on both write paths. Could not run `pytest` locally in the sandbox
(`ModuleNotFoundError: No module named 'pytest'`/`'dotenv'` — no PyPI egress); `py_compile` used as a
fallback sanity check on the changed files, with CI's `Run Tests` check named as the real gate for this
PR.

## Unit 6 — live proof obtained in full; no gap to disclose

Supabase MCP access stayed connected for the entire session this round (the reauthorization mentioned in
the prompt held). Live proof was obtained exactly as Unit 3 required — an actual before/after row, not
an assertion of "verified." The only incomplete piece is local test execution (no PyPI egress), which
does not weaken the live-database proof itself.

## Explicitly flagged: code fixed and proven ≠ production running it yet

Stated directly in the response: **the write path itself needs no further code change**, but the
**currently-running Railway ingestion process still needs to be redeployed/restarted onto the merged
commit** before `ratings` will actually start writing correctly in production — the same "merged is not
running" lesson this round's own Unit 2 uncovered applies going forward, not just retroactively.

## Delivery

Files changed: `cms_aux_ingestion.py` (+15/-0), `test_cms_aux_ingestion.py` (+58/-0). Merge instructions
given (`git checkout main; git pull origin main; git merge origin/claude/ratings3-verify-and-updated-at;
git push origin main`, or merge the PR directly). **PR: `sbriggssjc/Dialysis#7402`, confirmed merged —
`main` is up to date at commit `000eda1`.**

**Operator action still open, separate from the code merge:** confirm whether the Railway `cms-ingestion`
service has been redeployed/restarted onto `000eda1`, or whether auto-deploy-on-merge (previously
confirmed as Dialysis's standing behavior) has already handled it — do not assume either way before the
next test run, given this exact class of mistake is what this round's Unit 2 just uncovered.
