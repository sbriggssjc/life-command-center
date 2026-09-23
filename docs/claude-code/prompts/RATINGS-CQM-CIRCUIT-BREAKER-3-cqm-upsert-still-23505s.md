# RATINGS-CQM-CIRCUIT-BREAKER-3 — `clinic_quality_metrics`'s own new `.upsert()` call still 23505s on the first row of every run

**Repo root: `Dialysis` / `DialysisProject`.**

## Context

Round 1 of this saga (`RATINGS-CQM-CIRCUIT-BREAKER`, PR #7424, merged) replaced `clinic_quality_metrics`'s old
select-then-insert path (defeated by a PostgREST 1,000-row prefetch cap) with a direct-upsert-first pattern:
`_direct_upsert_record` first, falling back to a native `.upsert(payload, on_conflict='medicare_id,snapshot_date')`.
22 new/updated tests passed. Round 2 (`RATINGS-CQM-CIRCUIT-BREAKER-2`, PR #7425, merged) fixed `ratings`' real bug
(a shared client header silently defeating UPDATE-response checks) — confirmed live, `ratings` is genuinely clean
for the first time in this entire saga on 2026-09-23's post-merge run.

**But `clinic_quality_metrics` is still completely broken, on its own new code.** The first run after all three
merges (`ingestion_tracker` rows started 06:03:32/06:03:42 UTC 2026-09-23) shows:

- **955 `clinic_quality_metrics` errors, all in the first 13 minutes** (06:03:46–06:16:29 UTC): 897
  `circuit_open:('upsert', 'clinic_quality_metrics')` and 58 `23505 duplicate key value violates unique constraint
  "clinic_quality_metrics_medicare_snapshot_uidx"`. Note the operation name is `'upsert'`, not the old `'insert'`
  — this confirms PR #7424's new code is what's actually deployed and running.
- **The very first row processed** (`medicare_id=012501`, `snapshot_date=2023-12-31`, first error at 06:03:46 UTC,
  seconds after the run started) throws a real `23505` **through the new `.upsert()` call itself**, which then
  trips the circuit breaker and drops every subsequent row for the rest of that 13-minute window (and the pattern
  repeats until the breaker gives up entirely).
- `clinic_quality_metrics.updated_at` has not moved at all since 2026-09-22 14:24:22 — **zero writes have landed
  in this table since before round 1 even merged.**

**Why this is surprising and needs real investigation, not another patch guess**: a `.upsert(payload,
on_conflict='medicare_id,snapshot_date')` call against a table whose actual unique constraint is on exactly
`(medicare_id, snapshot_date)` (confirmed live in round 1 against `clinic_quality_metrics_medicare_snapshot_uidx`)
should not throw `23505` — that's the entire point of `on_conflict`. A genuine duplicate-key error out of an
upsert call means one of several things, and this round needs to find out which:

1. The `on_conflict` column list PostgREST actually receives at runtime doesn't match what's in the code (a typo,
   a stale deploy, a different column order, or a second index/constraint on the table that also covers
   `medicare_id`/`snapshot_date` in a way that conflicts).
2. `_direct_upsert_record` (tried first, per round 1's own description) is not actually a true upsert on the
   direct-DB path — e.g. it does its own insert without `ON CONFLICT`, or the fallback logic that's supposed to
   route to the native `.upsert()` on failure is instead running both paths for the same row.
3. A race or retry is issuing the same row twice within the same request window (e.g. a retry-on-timeout wrapper
   re-sending a request whose first attempt actually succeeded, so the retry's own upsert now duplicate-keys
   against the row the first attempt just wrote — this exact shape bit `ratings` in a different way in round 2).
4. The very first row in the run's processing order genuinely already exists in the table (from a prior partial
   run) and something about *that specific row's* data is malformed in a way that makes the upsert's conflict
   target not match (e.g. a null or differently-typed `snapshot_date` failing the composite match).

**Don't guess — read the actual code path that ran** (`_direct_upsert_record`, the native `.upsert()` fallback,
and whatever decides between them) and reproduce the failure directly against row `medicare_id=012501`,
`snapshot_date=2023-12-31` — check whether that exact row already exists in `clinic_quality_metrics` right now,
and if so, what about it doesn't match cleanly.

## What "done" looks like

- The actual mechanism producing a `23505` out of an `.upsert()` call with a correct `on_conflict` target is
  found and explained, not assumed.
- A live run shows `clinic_quality_metrics.updated_at` moving and row writes continuing past the ~15-minute mark
  instead of stopping at zero.
- `circuit_open`/`23505` errors on `clinic_quality_metrics` stop appearing in `ingestion_run_errors` for future
  runs.
- New tests that would have caught this specific failure mode (not just re-running round 1's 22 tests, which all
  passed while this bug shipped) — ideally something that exercises the actual upsert call against a fake client
  configured to already contain the conflicting row, proving the conflict resolves instead of erroring.

## Secondary ask, same round — not required to block on, but flag plainly either way

**`ingestion_tracker` rows are not reliably closing even when Railway shows a run as "completed."** The
2026-09-23 06:03 run's tracker rows (`run_status='started'`, `finished_at=null`) were still open when Scott
reported Railway showing it complete, and a third run had already started (15:40:06 UTC) before the second run's
rows ever closed. This is consistent with the Railway container/process exiting without the application code
ever reaching its `finish_run()` call — same defect class as the dropped-connection-ack comment already in
`start_run()` (see the `PRI5` comment referenced in earlier rounds of this saga), just not yet confirmed as the
same root cause. If it's a quick, confident finding, note it; if it needs its own investigation, say so plainly
and it can be its own round — don't let it block or dilute the `clinic_quality_metrics` fix above, which is the
priority.

## Explicitly not in scope for this round

Don't touch `ratings`' write path (PR #7425 is confirmed clean live) or `HCRIS-TIMEOUT-10`'s `properties`/
`facility_patient_counts` write paths (PR #7423 looking good so far, ~90% of fleet touched this run) — this round
is `clinic_quality_metrics` only, plus the optional secondary ask above.

## Verify on

- The exact state of `clinic_quality_metrics` row `medicare_id=012501`, `snapshot_date=2023-12-31` right now —
  does it already exist, and if so what does that reveal.
- A live run's `clinic_quality_metrics` write count and `updated_at` past the 15-minute mark — should be nonzero
  and growing, not flat.
- Whether the new tests would actually have caught this failure mode before it shipped (they didn't — say why).
