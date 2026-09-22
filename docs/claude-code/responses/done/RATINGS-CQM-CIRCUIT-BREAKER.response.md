# RATINGS-CQM-CIRCUIT-BREAKER — response (transcribed 2026-09-22)

> Recovered from Scott's own saved transcript (`"RATINGS-CQM-CIRCUIT-BREAKER surface response.docx"`, untracked,
> `docs/claude-code/responses/`). **Repo: `Dialysis`/`DialysisProject`.**

## What CC reports

**Root cause found and fixed — for `clinic_quality_metrics` only, not `ratings`.** CC found
`clinic_quality_metrics_medicare_snapshot_uidx` is a plain, non-partial `UNIQUE (medicare_id, snapshot_date)`
index — confirmed against the live definition — a different shape from `ratings`' partial indexes. Concluded
`RATINGS2`'s partial-index predicate fix doesn't apply, and `CQM1` (merged 2026-09-11) is unrelated (it only
stamped `updated_at`, never touched the write path).

**The actual bug in `_ingest_quality_metrics`**: it routed its `medicare_id`-keyed write through
`_write_idempotent_record`'s legacy select-then-insert dance. When the direct-DB path was unavailable, it fell
back to a plain `.insert()` gated by a `record_exists` flag from a once-per-run prefetch
(`_load_existing_key_set`, `limit=20000`) — but PostgREST silently caps responses at ~1,000 rows regardless of
the requested limit. Once the table passed 1,000 rows, every row beyond the cap got a wrong `record_exists=False`,
triggered a real `23505` on insert, and tripped the `('insert', 'clinic_quality_metrics')` circuit breaker for 8s
at a time, dropping every other row in that window.

**Fix**: the `medicare_id`-keyed write now tries `_direct_upsert_record` first (no `conflict_where` needed since
the index isn't partial), falling back to a single native `.upsert(payload, on_conflict='medicare_id,snapshot_date')`
— mirroring the already-proven `_ingest_payer_mix`/`_ingest_ownership_history` pattern. No prefetch, no stale
cache, so a plain insert against an existing key is now structurally impossible. Dead prefetch removed. CCN-only
branch (no unique index backs it) untouched.

**Tests**: 22 tests in `tests/test_cms_aux_ingestion.py` (new regression tests for medicare_id-path
upsert-preferred behavior, CCN-only fallback staying on the old path, dead-prefetch removal), all reported
passing.

**Delivery**: `sbriggssjc/Dialysis` branch `claude/intelligent-wozniak-asc19w`, **PR
`sbriggssjc/Dialysis#7424`**. Pushed; no GitHub-tooling merge confirmation this round (unlike `HCRIS-TIMEOUT-10`'s
subscribe/watch/unsubscribe) — merge status rests on Scott's report only, same bar as most prior rounds.

## Independent verification performed by this session — and a real correction to CC's framing

- **`clinic_quality_metrics` half: plausible, mechanism matches the live PostgREST 1,000-row cap behavior**
  described, and 22 passing tests is a reasonable bar for this fix class. **Live proof not yet available**: the
  same two `ingestion_tracker` rows from the pre-merge test run (`0c7f36de…`/`8173f93e…`, started 14:10-14:11 UTC)
  are *still* `run_status='started'`, `finished_at=null` as of this check — no new run has started since PR #7424
  merged, so nothing has tested this fix live yet.
- **`ratings` half: CC's "already fixed, out of scope" framing does not hold up against the live evidence, and
  this session is not accepting it at face value.** CC reasoned that `RATINGS2`/`RATINGS-INSERT-COLLISION`
  (closed ✅ 2026-09-11 in `CURRENT-STATE.md`, confirmed live that day: all 7,013 `ratings` rows freshly written
  22:05-22:17 UTC, zero duplicate-key errors for the following 8 hours) already solved this for `ratings`.
  **Independently queried `ratings`' error history day-by-day, and the circuit breaker never actually stopped**:
  6,900-25,000+ `circuit_open:('insert','ratings')` errors *every single day* from 09-11 through today
  (09-22), including **7,013 fresh `23505 duplicate key … "ratings_medicare_id_uidx"` errors on real
  `medicare_id`s as recently as today at 14:23-14:24 UTC** — the same run this very fix round's evidence came
  from. Even more tellingly: on 2026-09-11 itself, the same day `RATINGS-INSERT-COLLISION` was confirmed clean
  for 8 hours (22:05-06:00 UTC the next morning), **7,013 more `ratings` errors fired that same evening,
  19:45-19:58 UTC** — the fix's clean window was real but did not hold past that one day.
  **Conclusion: `RATINGS-INSERT-COLLISION`'s fix did not durably solve `ratings`' duplicate-key problem — it
  looked fixed for under a day, then the same failure mode came back and has recurred on every run since,
  continuing right through today.** This is not the same shape CC's new fix targeted (a `20000`-row prefetch
  silently capped at 1,000), but it needs its own round rather than being written off as "RATINGS2 already
  covers this."

## Delivery

Code changes in `Dialysis`/`DialysisProject`. **PR `sbriggssjc/Dialysis#7424`
(`claude/intelligent-wozniak-asc19w`) — Scott reports merged; no direct GitHub confirmation available from this
session.** `RATINGS-CQM-CIRCUIT-BREAKER` **split into two halves going forward**: `clinic_quality_metrics` held
at 🟡 pending live proof (the fix is plausible and well-tested, same bar every prior round in this saga has had
to clear); `ratings` **reopened at 🔴** — genuinely unresolved, mischaracterized as already-fixed, and now has
its own follow-up prompt (`RATINGS-CQM-CIRCUIT-BREAKER-2-ratings-still-breaking.md`).
