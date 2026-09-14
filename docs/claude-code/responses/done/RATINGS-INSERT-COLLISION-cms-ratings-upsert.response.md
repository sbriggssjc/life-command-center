# RATINGS-INSERT-COLLISION-cms-ratings-upsert — response (transcribed 2026-09-10)

> Recovered from Scott's own saved transcript (`ratings insert collision bug surface response.docx`,
> untracked, `docs/claude-code/responses/`) — same recovery method as `CFE-RUNAWAY` and
> `RAILWAY-PA-SECRET-log`. **Repo: `Dialysis`. This session verified this against the transcript only
> — `Dialysis` is not reachable from this session (no credentials), so nothing here is independently
> re-read against the actual diff.**

## The prompt's hypothesis was wrong on one point — corrected here, not just fixed in code

The prompt guessed `_ingest_ratings()` did a plain `INSERT` with no upsert path. **As reported, that
was not quite right:** a fallback (insert → on-conflict → update) already existed. The real defect was
that the fallback still required a genuine `INSERT` to fail first — and for the 3 medicare_ids already
present from the March backfill, that predictable failure tripped a **table-wide** circuit breaker that
then collaterally blocked *unrelated* `ratings` rows too, which is what produced the 349
`circuit_open` warnings and 174 pointless retries measured live. Correcting the record here rather than
treating the original hypothesis as confirmed.

## Unit 1 — call sites, as reported

- Write path: `_ingest_ratings()`, `cms_aux_ingestion.py:638`.
- The `count=7013` probe: a separate once-per-run prefetch, `_load_existing_key_set()` — **not** the
  CFE-RUNAWAY per-record pattern, a distinct bug. It read the whole `ratings` table twice per run
  (once via an unbounded direct SQL `SELECT`, once via a REST fallback).

## Unit 2 — fix, as reported

`_ingest_ratings()` now does a native `.upsert(..., on_conflict=...)`, matching the pattern already
used by `_ingest_payer_mix()`/`_ingest_ownership_history()` in the same file. Reported to be unable to
raise duplicate-key going forward.

## Unit 3 — second probe, as reported

The `_load_existing_key_set()` existence prefetch removed entirely (no longer needed once the write
path is a real upsert).

## Unit 4 — circuit breaker, as reported

Self-resets after an 8-second cooldown; no process restart needed. **Found but explicitly left
unfixed, flagged as a separate defect:** `circuit_open` was being misclassified internally as a
transport error, which is what drove the "retry with a fresh client" churn (174×) on top of the
breaker already being open — retrying doesn't help a breaker-open state, and the misclassification is
why the code kept trying anyway.

## Unit 5 — cascade check, as reported (corrects the prompt's own assumption)

The prompt assumed the `clinic_quality_metrics` skips were a cascade off the `ratings` failures.
**Reported as NOT the case:** those skips are driven by an independent `medicare_clinics` lookup with
its own separate breaker key, and the 210 skipped rows genuinely have no parent yet — a real, distinct
gap, not a side effect of the ratings bug. Do not assume Unit 2 alone clears this count.

## Noted, correctly left out of scope

`_ingest_quality_metrics` uses the same underlying `_write_idempotent_record` helper and is
theoretically exposed to the same breaker-cascade shape as `_ingest_ratings` was — but it wasn't
reported failing in the measured logs, so it was left untouched rather than "fixed" speculatively.

## Tests, as reported

3,155 passed / 7 skipped / 1 xfailed / 0 failed — up from a stated baseline of 3,147/3,139 (both
figures given in the transcript; not reconciled further here), including two new tests pinning
upsert-not-insert behavior for `_ingest_ratings()`.

## Delivery — NOT MERGED, action needed on Scott's side

Branch `claude/ratings-insert-collision-01TdbTHbDZpAy42HfAvZAA8E`, **pushed to `origin`, no PR
opened** (explicitly requested that way in the transcript). Merge instructions as given:

```
git checkout main
git pull origin main
git merge origin/claude/ratings-insert-collision-01TdbTHbDZpAy42HfAvZAA8E
git push origin main
```

This session cannot confirm merge state (no `Dialysis` access) — **treat this fix as un-merged until
Scott confirms the merge above ran.**
