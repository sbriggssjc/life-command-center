# PROPREV1-estimated-annual-revenue-propagation-still-dropped — response (transcribed 2026-09-10)

> Recovered from Scott's own saved transcript (`PROPREV1 surface response.docx`, untracked,
> `docs/claude-code/responses/`) — same recovery method as the rest of this arc. **Repo: `Dialysis`.
> This session verified this against the transcript only — `Dialysis` is not reachable from this
> session (no credentials), so nothing here is independently re-read against the actual diff.**

## Unit 1 — trace, as reported

`filter_fields_to_valid_schema_fields()` (`src/utils_shared.py:4406`) calls `column_exists()`
(`src/schema_guards.py:208`), from within `update_row()` (`utils_shared.py:652`), called by
`propagate_financials_to_properties()` (`src/propagation_utils.py:11069`).

## Unit 2 — root cause, as reported (confirms this session's hypothesis (b), reproduced in a test)

`column_exists(refresh=True)`'s first "live" recovery path called `utils_shared.get_columns()` →
`core_utils.get_table_columns()` → `schema_introspection.load_schema_map(..., force_refresh=False)` —
whose own first rule is **"prefer the on-disk cache always" whenever it's non-empty, ignoring the live
client entirely**, regardless of the `refresh=True` the caller passed. Since the cache for `properties`
is populated (just missing `estimated_annual_revenue`, the one column that matters here), it always
returned `False` before ever reaching a genuinely live probe (`_probe_supabase_columns`, an
`information_schema` RPC, or a direct select). Reported to have reproduced the exact production
warning (`live check kept: none`) in a test before fixing it.

## Unit 3 — CFE-RUNAWAY's original fix, as reported: present and correct, bug was one layer downstream

Directly answers this session's question: **CFE-RUNAWAY's client-threading fix was present in the
merged code, exactly as its own response described — it was correct but insufficient.** The real bug
was one layer further down, inside `column_exists()` itself, which never used the client it was given.
Fix: `column_exists()` now skips the cache-derived shortcut when `refresh=True`;
`propagate_financials_to_properties()` also now passes its client explicitly rather than relying on
`update_row()`'s `get_client()` fallback.

## Unit 4 — the test gap, as reported (confirms this session's hypothesis (c))

All 8 of CFE-RUNAWAY's new tests **stub `column_exists()`/`filter_fields_to_valid_schema_fields()` out
entirely** — they pin that the client is *passed*, never that the receiving function does anything
*live* with it. New `tests/test_proprev1_schema_guard_live_recovery.py` (4 tests) exercises the real
functions, proven RED before the fix (reproducing the exact `(live check kept: none)` warning) and
GREEN after.

## Unit 5 — live confirmation, as reported: NOT run against live Dialysis_DB

No egress from the CC sandbox. Verified instead via stub clients whose only path to a correct answer is
a genuine probe call (matching production's failure shape exactly), plus the full local suite green.
**This session has not independently confirmed a live write yet either** — worth a live Supabase check
once the fix is deployed, the same way CFE-RUNAWAY and RATINGS-INSERT-COLLISION were independently
confirmed via Postgres/edge logs.

## Tests, as reported

68/68 directly relevant tests pass. Full suite (`--ignore=tests/integration/`): **3,159 passed / 7
skipped / 1 xfailed / 0 failed** in 604.88s — consistent with the prior 3,153 baseline plus the 4 new
PROPREV1 tests (the small residual count drift between reports in this arc — 3,153 → 3,155 →
3,159 — tracks added tests across CFE-RUNAWAY, RATINGS-INSERT-COLLISION, and PROPREV1, not flakiness).

## Delivery — merge status not stated in the transcript

Committed (`6838714`) and pushed to `claude/trusting-dijkstra-rrztfz`. **PR opened:
`sbriggssjc/Dialysis#7400`.** The transcript ends acknowledging the PR exists and tests are green; it
does not say whether #7400 was merged. **Confirm merge state with Scott before treating this as
deployed**, same caveat as the two prior fixes in this arc.
