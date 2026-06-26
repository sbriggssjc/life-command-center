# Claude Code (DialysisProject) — batch the patient_counts Pass-1 per-row UPSERT writes (next-period readiness)

## Why (the documented follow-up from the read-cache round, PR #7324)

The read side of `ingest_patient_counts` is now batched (the `_prime_clinic_row_cache`
/ `_prime_fpc_snapshot_cache` lazy-primed caches killed the per-row N+1 reads — 5h
→ minutes on a no-op re-run). But the **Pass-1 WRITE path still upserts
`facility_patient_counts` one row at a time** (`upsert_patient_count` /
`_rest_upsert_facility_counts`, per-record). That was deliberately left alone
because in steady state (no new CMS period) every row resolves to the
read-before-write "same count → skip" path, so 0 writes happen and per-row write
cost is irrelevant.

**It becomes relevant the moment CMS publishes a genuinely new reporting period**
(`snapshot_date`): then ~7,500 rows each need a fresh INSERT, and a per-row upsert
loop would re-introduce a multi-hour write phase — the same N+1 shape on the write
side that we just fixed on the read side. This round makes the writer bulk so the
next real CMS publication ingests fast. It is preparatory; it does NOT change
behavior on a no-op re-run (still 0 writes).

## Unit 1 — bulk-upsert the changed/new rows in Pass 1

In `patient_count_ingestor.py` / `ingest_patient_counts`:
- Keep the existing per-row decision logic intact: the read-cache `_get_snapshot_row`
  / `already_processed_snapshot` check still decides **which** rows actually need a
  write (new `(medicare_id, snapshot_date)` OR a changed count). Only those rows
  should be written — unchanged rows still skip (no behavior change on a no-op run).
- **Accumulate the rows that need writing into a buffer instead of upserting each
  one inline**, then flush via the EXISTING bulk path `_rest_upsert_facility_counts(
  rows, conflict=("medicare_id","snapshot_date"))` in **chunks of ~500** (PostgREST
  bulk-upsert is already used there; respect the cap-aware chunking and the
  shared-key-set requirement noted at `:740`). Flush at end-of-pass and on a
  size threshold so memory stays bounded.
- Preserve idempotency (ON CONFLICT merge-duplicates on the same key) and the
  pending/`needs_manual_review` path (the 23 missing-`total_patients` rows still
  route to `pending_updates`, not the bulk insert).
- Keep the counters honest: `writes_confirmed` must reflect rows actually upserted
  by the bulk flush (the CMS round documented that the old `[DATA] inserted: N`
  derivation counter was misleading — make sure the bulk path increments
  `attempted_writes` / `writes_confirmed` from the real response, not the derive
  count).
- Same `CMS_DISABLE_READ_CACHE=1`-style escape isn't needed here, but keep a
  graceful fallback: if a bulk chunk fails, fall back to per-row upsert for that
  chunk (so one bad row can't drop a whole 500-row batch) and log it.

## Unit 2 — prove it without waiting for CMS to publish

Since we can't summon a new CMS period on demand, prove the bulk path with a
controlled test:
- A unit/integration test that feeds a synthetic batch with a NEW `snapshot_date`
  (so every row is a real insert) through the Pass-1 writer and asserts: rows land
  via the bulk path (chunked), `writes_confirmed` == rows written, idempotent
  re-run writes 0, and a forced single-row failure falls back without dropping the
  chunk. Mirror the existing `test_patient_count_read_cache.py` style.
- Confirm a normal no-op `--force-run` is byte-identical to today (0 writes, fast)
  — the bulk change must not alter steady-state behavior.

## Boundaries / verify

- DialysisProject (Python), feature branch per its CLAUDE.md; end with merge +
  test commands.
- `python -c "import src.run_cms_ingestion; print('OK')"`;
  `python -m pytest tests/ -x -q` (pre-existing sandbox-cred failures unchanged).
- This is write-path-only; do NOT touch the read caches, the snapshot_date
  derivation, the reorder, or the run cap (all settled in prior rounds).

## Documentation

Update DialysisProject CLAUDE.md (CMS section): note the Pass-1 writer now
bulk-upserts changed/new `facility_patient_counts` rows in chunks (so a genuinely
new CMS period ingests fast), with per-row fallback on a chunk failure; steady-state
no-op runs are unchanged (0 writes).

## Bottom line

Steady-state runs are already fast (0 writes). This makes the WRITE side bulk so
the next real CMS publication — whenever it lands — inserts ~7,500 rows in chunked
batches instead of a per-row loop, closing the last N+1 in the patient-counts path.
Preparatory, behavior-neutral on a no-op run, proven by a synthetic new-period test.
