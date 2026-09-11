# CQM1 — `clinic_quality_metrics.updated_at` never moves despite successful writes; same blind spot RATINGS3 fixed on `ratings`, recurring here

**Repo: `Dialysis` (`sbriggssjc/dialysis`).** Filed here (`life-command-center`) per the established
convention for this arc — the code lives in the other repo, this repo just tracks the ask and the
response.

## 0. Context — this is RATINGS3's own finding, on a second table RATINGS3 explicitly left untouched

RATINGS3 (`sbriggssjc/Dialysis#7402`, merged and confirmed live) found and fixed a real defect: neither
of `ratings`'s write paths ever stamped `ratings.updated_at`, so the exact metric this whole arc used to
judge success (`max(updated_at)`) was structurally blind to a genuinely successful write. RATINGS3's own
"Out of scope" section explicitly left `clinic_quality_metrics` untouched, since it wasn't implicated by
that round's evidence.

This session (`life-command-center`) independently checked `clinic_quality_metrics` live against the
same 2026-09-10 22:05–22:07 UTC production run already used to confirm the `ratings` fix, and found the
identical shape of blind spot on this second table:

- `clinic_quality_metrics.max(updated_at)` and `max(created_at)` are both still stuck at **2026-03-12**
  (the same March backfill date pattern seen throughout this arc).
- In that same run, **1,994 `PATCH .../clinic_quality_metrics?medicare_id=eq...` calls returned `204`**
  (PostgREST's success response for an update) — a large number of apparently-successful writes.
- Spot-checked one directly: `medicare_id='012500'`, `snapshot_date='2023-12-31'` — a row that received
  one of those 1,994 PATCHes — still shows `updated_at = 2026-03-11 14:55:26`, untouched by the run.
- Confirmed via `information_schema.triggers`: **no update trigger exists on `clinic_quality_metrics`**,
  same as `ratings` before RATINGS3's fix.

**Separately, good news to confirm rather than re-litigate**: `RATINGS2`'s probe-count fix on this same
table (`_build_quality_payload`'s `_has_column(..., refresh=True)` cache-bypass, ~30 calls/row) is
**confirmed working live** — only 36 `select=*&limit=1` probe calls fired in the run's first minute, then
zero after, consistent with the described once-per-run cache reset. That part does not need further
work; don't touch it.

## 1. What's actually unknown — two separate questions, don't conflate them

1. **Is `updated_at` simply never included in the write payload** (the exact RATINGS3 shape), or is
   something else going on — e.g., the PATCH's `WHERE` filter matching zero rows despite a `204`, or a
   `Prefer` header suppressing something meaningful? Read the actual write path first, verbatim, before
   assuming it's the same bug.
2. **Are the underlying column values actually changing** on those 1,994 successful PATCHes, or are they
   no-op writes (same values sent back)? This session has no pre-run snapshot to diff against, so this is
   genuinely unknown — don't assume either answer. If the payload legitimately hasn't changed for most
   rows in a given run (e.g., CMS quality data updates quarterly, not daily), a no-op PATCH would be
   expected behavior and the only defect is the missing `updated_at` stamp itself. If real values ARE
   changing but `updated_at` still doesn't move, that's the same finding, just worth being precise about.

## 2. Units

**Unit 1 — find and read the actual write path for `clinic_quality_metrics`, verbatim.** Identify the
function(s) that build and send the PATCH/upsert payload (likely near `_build_quality_payload`, the
function RATINGS2 already touched for the probe fix). Confirm whether `updated_at` is included in the
payload at all. State plainly whether this matches RATINGS3's `ratings` bug exactly, or differs.

**Unit 2 — reproduce and fix live.** Using Supabase MCP against Dialysis_DB directly, run the actual
write call (or as close as possible) against the same row this session spot-checked
(`medicare_id='012500'`, `snapshot_date='2023-12-31'`) or another convenient existing row. Confirm the
current behavior (whether `updated_at` moves or not) before changing anything. Then fix it — stamp
`updated_at` explicitly in the write path, gated on column existence (same pattern as RATINGS3's fix to
`ratings`) — and re-run the same call, pasting the actual before/after row into the response. This is the
same non-negotiable requirement RATINGS3 established: an actual row, not an assertion.

**Unit 3 — answer the no-op-vs-real-write question directly.** Pick a handful of rows from the 1,994
touched in the 2026-09-10 22:05–22:07 UTC run (medicare_ids visible in Railway/edge logs if still
available, or any convenient sample) and determine, as best you can from what's available, whether the
payload sent in that run's PATCH actually differed from the row's pre-existing values, or was identical.
If there's no way to determine this retroactively, say so plainly rather than guessing — this is a
secondary question to Unit 2's fix, not a blocker for it.

**Unit 4 — regression test.** Add a test exercising the `updated_at` stamp on `clinic_quality_metrics`'s
write path directly (not mocked past the point of meaning, per RATINGS3's own lesson about RATINGS2's
test gap). Note if local `pytest` still can't run in this sandbox (no PyPI egress last checked) — `py_compile`
as a fallback, CI as the real gate, same as every round in this arc.

## Out of scope

- The `clinic_quality_metrics` probe-count fix itself — confirmed working live this round, do not touch.
- `ratings` and `properties.estimated_annual_revenue` — both confirmed closed, do not touch.
- No retention/deletion of any rows in any table.
- No `life-command-center` code changes — entirely in `Dialysis`.

## Verify on

- Unit 1: the actual write path quoted verbatim, with a plain statement of whether it matches RATINGS3's
  `ratings` bug shape.
- Unit 2: **an actual before/after row from Dialysis_DB, `updated_at` changed, pasted into the
  response** — the same non-negotiable requirement as RATINGS3.
- Unit 3: a plain answer — real value changes confirmed, ruled out, or stated as undeterminable — not
  glossed over either way.
- Unit 4: real test coverage, with the local-test-execution gap named explicitly if it recurs.
