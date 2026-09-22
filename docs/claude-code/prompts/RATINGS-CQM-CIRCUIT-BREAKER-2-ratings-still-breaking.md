# RATINGS-CQM-CIRCUIT-BREAKER-2 — `ratings`' duplicate-key circuit breaker never actually stopped

**Repo root: `Dialysis` / `DialysisProject`.**

## Context

`RATINGS-CQM-CIRCUIT-BREAKER` (PR #7424, this session's prior round) found and fixed a real bug in
`clinic_quality_metrics`' write path (a `20000`-row existing-key prefetch silently capped at 1,000 by
PostgREST, causing wrong `record_exists=False` reads and real `23505` inserts past the cap). That round's
response reasoned `ratings` didn't need the same fix because `RATINGS2`/`RATINGS-INSERT-COLLISION` (closed ✅
2026-09-11 in `CURRENT-STATE.md`) already solved it there, with a different (partial-index) mechanism.

**That reasoning does not hold up against the live evidence, independently checked.** `ratings`' circuit
breaker (`circuit_open:('insert','ratings')`) has fired every single day from 2026-09-11 through today
(2026-09-22), 6,900-25,000+ times per day, with **fresh `23505 duplicate key value violates unique constraint
"ratings_medicare_id_uidx"` errors on real `medicare_id`s as recently as today, 14:23-14:24 UTC** — the exact
run whose evidence fed the CQM fix. Even on 2026-09-11 itself, the same day `RATINGS-INSERT-COLLISION` was
confirmed clean for an 8-hour window (22:05 UTC → next morning), **7,013 more `ratings` errors fired that same
evening, 19:45-19:58 UTC**. The fix's clean window was real but lasted under a day.

## What this means

`RATINGS-INSERT-COLLISION` fixed *something* real (the 8-hour clean window is genuine, independently confirmed
at the time) but did not durably fix `ratings`' duplicate-key problem — it has recurred on every run since,
continuously, for 11+ days. Whether that's because the original fix only covered part of the write path, a
regression reintroduced the old code path, or a second, different bug produces the identical symptom is not yet
known — **read the current deployed `ratings` write path fresh, don't assume the September fix's description
still matches the code.**

## What to do

1. **Read the current `ratings` write path end to end** (whatever function `_ingest_quality_metrics`'s sibling
   for `ratings` is — likely in the same `cms_aux_ingestion.py` module CQM's fix just touched, or wherever
   `RATINGS-INSERT-COLLISION`/`RATINGS2`/`RATINGS3` last left it). Confirm what upsert/insert mechanism it
   actually uses today, live, not from memory of what those prior rounds' responses described.
2. **Check for a prefetch-cap bug of the same shape CQM just had** — a `limit=N` existing-key prefetch that
   PostgREST silently truncates below `N`, causing false `record_exists=False` reads. `ratings` currently has
   7,013 rows (well past PostgREST's ~1,000-row default cap), so this is a strong first hypothesis given how
   closely it matches CQM's actual bug, but confirm it against the real code rather than assuming the same fix
   applies unchanged.
3. **Check whether a partial-index predicate mismatch (RATINGS2's original fix target) has resurfaced** — read
   the live `ratings_medicare_id_uidx` definition and confirm whether it's still partial, and whether whatever
   `conflict_where`/`on_conflict` clause the write path uses still matches it exactly.
4. **Also check**: is this pipeline's `ratings` writer even calling the same function `RATINGS-INSERT-COLLISION`
   fixed, or does a different code path (e.g. a batch/bulk variant, or a fallback branch) bypass that fix
   entirely under some condition? The 8-hour-clean-then-broken-again pattern is more consistent with "a second
   code path exists and gets used under some condition" than with "the fix was simply wrong."

## What "done" looks like

- `ratings` writes use a real upsert with the correct conflict target, confirmed against the live constraint
  definition, with no `limit=`-capped prefetch deciding insert-vs-update.
- A live run shows `ratings` row counts and `updated_at` timestamps moving well past the current frozen 7,013,
  with writes continuing past the ~15-minute startup-burst mark rather than stopping.
- `circuit_open:('insert','ratings')` / `23505 … ratings_medicare_id_uidx` errors stop appearing in
  `ingestion_run_errors` for future runs — and stay stopped for more than one day this time, unlike September's
  fix.
- New tests, plus an explicit note on why this recurred after `RATINGS-INSERT-COLLISION` was already confirmed
  live and closed — don't just re-fix and move on without explaining the gap, since the same "fixed, confirmed
  live, then broke again" pattern showing up twice on two different tables in the same pipeline is itself worth
  understanding.

## Verify on

- The actual current `ratings` write path, read fresh, not assumed from prior rounds' descriptions.
- Whether this is the same PostgREST-1000-row-cap bug CQM just had, the original partial-index issue
  resurfacing, a genuinely new third cause, or a second code path that bypasses the September fix.
- A live run's `ratings` write count past the 15-minute mark, and no `circuit_open`/`23505` errors on `ratings`
  for at least 48 hours post-fix (not just the first clean run) before calling this durably closed.
