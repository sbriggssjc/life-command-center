# PR12 — `field_provenance` silently drops any value containing a double quote: size the loss, then fix the hash

**Repo: `life-command-center`.** Target **LCC Opps `xengecqvemvfknjvbvrq`** (`field_provenance`,
`lcc_merge_field`, `provenance_event_log` / `lcc_flush_provenance_events`), with the JS side in
`api/_shared/` (`shouldWriteField` and every `lcc_merge_field` caller). **Measure first; the fix
is one column rewrite and one JS behaviour change, and both need sizing before they run.**

**Read first:** backlog row **PR12** (`docs/os/PLANNED-BACKLOG.md`), `public-records-source-lane.md`
§2 PR2 block (where it was found), `CLAUDE.md` § "Field-level data provenance" and the PR5 block
(**PR5c** — 33 LCC-internal rungs with zero rows — is a candidate VICTIM of this defect, so PR5c
is graded after you, not before).

## The defect, as found (verify in one query each)

- `field_provenance.value_text_hash` is `GENERATED ALWAYS AS encode(sha224((value)::text::bytea),'hex')`.
  `value` is jsonb; a jsonb **string** renders inner double quotes with backslashes, and
  `::bytea` rejects the escape → **22P02**, aborting the whole `lcc_merge_field` call.
- Found by PR2's backfill: dia parcel `145416`, zoning `"C" - Commercial` — the batch recorded
  **2,532 rows, not 2,533**.
- The live JS path **fails OPEN**: `shouldWriteField` catches the RPC error and proceeds, so the
  curated write lands and the provenance row never exists. No error surfaces anywhere.
- Confirm the mechanism with a rolled-back positive control: call `lcc_merge_field` with a quoted
  string value inside a transaction, capture the SQLSTATE, roll back. Then the same with the
  proposed hash expression — must succeed.

## Size the loss BEFORE fixing — this is the deliverable

1. **How many curated values on ladder-governed columns contain a `"`?** For every distinct
   `(target_table, field_name)` in `field_source_priority` that resolves to a real column (use
   PR5's `v_field_source_priority_triage` / the PR7 orphan markers to skip nonexistent ones),
   count rows on the domain DBs and LCC Opps where the text value contains `"`. Report per table;
   these are the writes whose provenance could never have been recorded.
2. **How many of THOSE have no `field_provenance` row at all?** That is the measured floor of the
   historical loss. State it as a floor — a value written and later overwritten leaves nothing to
   count.
3. **Is PR5c explained by this?** For the 33 LCC-internal rungs, check whether the values those
   call sites write typically contain quotes (entity names with `"` are rare; `metadata` jsonb
   fragments are not). Report: PR5c is / is not attributable to PR12, with the count.
4. **Does `provenance_event_log` (the async path) carry the same generated column or a different
   one?** If the async path has its own hash, check it independently — two writers, two hashes.
5. **Any OTHER `::bytea` cast over a jsonb-derived text in a generated column or trigger on the
   three projects?** Grep `pg_attrdef` / `pg_proc` for `::bytea` — the same shape elsewhere is the
   same silent loss.

## Fix

- **Hash:** `encode(sha224(convert_to(value::text, 'UTF8')), 'hex')` — `convert_to` produces
  bytea without parsing escapes. Rewriting a `GENERATED ALWAYS` column rewrites the whole table:
  **size `field_provenance` (rows, bytes) and the lock/time cost before applying**; `ALTER TABLE
  … DROP COLUMN` + `ADD COLUMN … GENERATED` takes ACCESS EXCLUSIVE and rewrites 1.26M+ rows. If it
  cannot fit a maintenance window, say so and propose the batched alternative (a plain column
  filled by trigger + backfill in chunks). Keep the hash **byte-identical for every value that
  has no quote** — prove it: before/after hash equality on a 10k-row sample, 0 mismatches,
  positive-controlled on one quoted value.
- **JS:** `shouldWriteField` must NOT fail open silently. Keep the write-proceeds behaviour (a
  provenance failure must not lose a curated value) but **record the failure** — a
  `lcc_health_alerts(alert_kind='provenance_write_failed')` deduped row, or a counter the tick
  reports (`provenance_failed`), with the SQLSTATE. Assert on the count going non-zero in a
  rolled-back control, then zero after the hash fix.
- **Deploy order:** the migration first (additive: the new hash accepts a superset), then the JS.
  The hash change is not a `CHECK` on writer output, so "constraint after writer" does not apply
  — state that explicitly rather than leaving the reader to work it out.

## Verify on

- Rolled-back control: quoted value → `lcc_merge_field` succeeds after the fix, 22P02 before.
- Hash equality on unquoted values: 0 mismatches over the sample.
- The measured loss floor (step 2) and whether PR5c is explained (step 3), both as numbers.
- `provenance_failed` / the alert: fires in the control, 0 in the 24 h after deploy.
- `v_field_provenance_unranked` before/after in one session (should be unchanged — this is not a
  registration change).

## What NOT to do

- Do not backfill lost provenance rows — the source and confidence of a historical write cannot be
  reconstructed; a fabricated provenance row is worse than a missing one (P180: unknown is not a
  value). Record the loss as a number and a date, in the audit and on the lane page.
- Do not widen this into PR5c's fix; report the attribution and stop.

## Report back

The per-table quote census · the loss floor · PR5c attribution · the bytea sweep (any other
instances) · table size + rewrite plan chosen and why · hash-equality proof · the JS failure
signal and its control · deploy sequence.
