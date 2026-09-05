# MERGE1 — property merge FOLD-on-collision (2026-09-05)

**Both domains.** dia is live and has already run 585 merges (206 collisions, 205 on a CASCADE
table). gov has run zero merges but every one of its 397 review-lane groups would collide.

## The defect, per domain

Both merge functions carry a generic loop over every FK to `properties`, repointing `drop_id →
keep_id`. On a `unique_violation` the two domains failed differently:

| | gov `gov_merge_property_apply` | dia `dia_merge_property` |
|---|---|---|
| collision arm | `WHEN unique_violation THEN DELETE FROM %s WHERE %I = $1` | left the row pointing at `drop_id`, recorded `<tbl>.<col>_error` |
| how the row died | explicit DELETE, immediately | `ON DELETE CASCADE` fired when `properties WHERE property_id = drop_id` was deleted a few lines later |
| ledger said | `*_deleted_on_collision` (a count) | `*_error` (an error message) |

Neither leaves the backup (`{dia,gov}_property_merge_backup`) able to recover the row — the
snapshotted child id points at nothing, so `*_unmerge_property` reports it "restored" or honestly
"`_lost`" while the data is gone either way.

## Measured collision population (2026-09-05, live)

**dia** — `dia_property_merge_backup`, 585 merges:

| batch_tag | merges | with a collision |
|---|---:|---:|
| `twin_merge_20260814_151532` | 240 | 41 |
| `twin_merge_20260814_151456` | 200 | 55 |
| `dc_twin_verdict` (live Decision Center lane) | 116 | 90 (78%) |
| `twin_merge_20260814_150807` | 26 | 19 |
| `addr1a_20260904` | 1 | 1 |
| `addr1_costar_contacts_bleed_20260903` | 1 | 0 |
| `twin_retest` | 1 | 0 |
| **total** | **585** | **206** |

By table (count of merges hitting each table's `_error` key):

| table | merges affected | unique constraint | class |
|---|---:|---|---|
| `property_embeddings` | 198 | `UNIQUE(property_id)` (PK) | re-derivable |
| `cap_rate_history` | 23 | `UNIQUE(property_id, event_type, event_date)` (a plain unique **index**, not a `pg_constraint` row — missed by a constraint-only census) | substantive |
| `property_metadata_backfill_queue` | 11 | `UNIQUE(property_id)` | queue state |
| `pending_updates` | 1 | `pending_updates_unique_prop`, a **partial** unique index `WHERE status='pending_review' AND property_id IS NOT NULL` | queue state |

**gov** — `gov_property_merge_backup` is **0 rows** (no merges run). Measured against
`v_gov_property_duplicate_review` (397 groups):

| table | unique constraint | groups colliding | rows |
|---|---|---:|---:|
| `investment_scores` | `UNIQUE(property_id)` alone | 397 of 397 | 400 |
| `property_embeddings` | `PK(property_id)` | 334 | 336 |
| `property_financials` | `UNIQUE(property_id, fiscal_year)` | 316 | 585 |

## The fix

Migrations (applied live to both databases 2026-09-05):
- `supabase/migrations/dialysis/20260905120000_dia_merge1_fold_on_collision.sql`
- `supabase/migrations/government/20260905120000_gov_merge1_fold_on_collision.sql`

Each domain gets a `{dia,gov}_merge_child_policy` table (`table_name`, `policy`, `pk_col`,
`conflict_cols`, `resolve_column`/`resolve_value`, `notes`) and two new functions:

- `_{dia,gov}_merge_fold_one_row(table, fk_col, pk_col, conflict_cols, keep_id, drop_pk)` —
  locates the keep-side row via the FK column (not the table's own PK, which may be an unrelated
  surrogate id — e.g. `cap_rate_history.id` vs `property_id`), `COALESCE`s every column that is
  NULL on the keep row from the drop row (never overwrites an existing keep-side value), then
  deletes the drop row.
- `{dia,gov}_merge_fold_table(table, fk_col, keep_id, drop_id)` — the per-table dispatcher, called
  by the merge function ONLY on `unique_violation`. Walks every drop-side row individually (a bulk
  UPDATE can partially collide) and applies its policy:
  - **`re_derivable`** — delete the drop row directly; the value is recomputed by an existing
    worker (an embedding refresh; `investment_scorer.py`'s next scoring pass), so this is a
    deliberate, recorded discard, not a loss.
  - **`resolve_status`** — flip the drop row's status column out of a partial unique index's scope
    (e.g. `pending_updates.status` off `'pending_review'`), then repoint it. The row **survives
    whole**, never deleted.
  - **`fold_fill_blanks`** — the substantive case: fold via the one-row folder above.
  - **no policy row** — an unclassified table defaults to `fold_fill_blanks` off its own
    single-column PK rather than falling back to the old blind delete/leave-dangling behaviour.

Policy seeded from the measured population:

| domain | table | policy | why |
|---|---|---|---|
| dia | `property_embeddings` | re_derivable | embedding is derived; refresh worker recomputes it |
| dia | `cap_rate_history` | fold_fill_blanks | substantive point-in-time value/expense-anchor history |
| dia | `property_metadata_backfill_queue` | fold_fill_blanks | queue state (missing_fields/attempts/last_attempt_at/last_error) |
| dia | `pending_updates` | resolve_status | partial unique index scoped to `status='pending_review'`; flipping status preserves the row whole |
| gov | `investment_scores` | re_derivable | fully computed from properties/leases/loans; no independent history (checked — no history table reads it) |
| gov | `property_embeddings` | re_derivable | embedding is derived; refresh worker recomputes it |
| gov | `property_financials` | fold_fill_blanks | substantive annual rent/expense/NOI history |

`dia_merge_property` and `gov_merge_property_apply` are otherwise byte-identical to their prior
bodies (sales-transactions dedup, the final property DELETE) — only the properties-FK loop's
`unique_violation` arm changed, from `_error`-and-leave / blind-DELETE to a call into the fold
dispatcher.

## Known, stated gap: `resolve_status` reversibility

`dia_unmerge_property`'s generic child-repoint logic snapshots child ids **before** `apply` runs,
so on unmerge it repoints a `resolve_status`-folded `pending_updates` row back to `drop_id`
successfully (the row was never deleted) — but it does **not** restore the row's original
`status` (e.g. `'pending_review'`), which was overwritten to `'superseded_by_merge'` during the
merge. The row is not lost, but the reversal is not byte-perfect. Stated here rather than solved,
per MERGE1's scope (fix the loss; do not rebuild the unmerge report format).

## Verification (rolled-back positive controls, 2026-09-05)

**dia** — synthetic pair, real DB, single transaction, rolled back:
- `cap_rate_history`: keep-side row (`notes IS NULL`) collided with a drop-side row on the same
  `(property_id, event_type, event_date)` carrying `notes = 'drop-side note MERGE1 test'`. After
  `dia_merge_fold_table`: **one row remains**, carrying the drop-side note — folded, not lost.
- `property_embeddings`: both sides present → **one row remains** (re_derivable discard).
- `property_metadata_backfill_queue`: keep had `attempts=0` (not null, so preserved) and
  `missing_fields=['year_built']` (preserved); drop's `attempts=3`/`['lot_sf']` correctly
  discarded because keep already had non-null values — fill-blanks-only confirmed.

**gov** — same shape: `investment_scores` kept the keep-side score (re_derivable discard of the
drop side); `property_financials` filled `noi` from the drop row because the keep row's `noi` was
NULL (fold); `property_embeddings` collapsed to one row.

Both runs executed inside `BEGIN; ... ROLLBACK;` — **no data was mutated on either live database**
by this verification.

## Guard

`test/merge1-fold-on-collision.test.mjs` (8 tests, all pass) — reads both migrations' source
(comments stripped), asserts: every measured-colliding table carries a policy row on both domains;
the properties-FK loop in each merge function routes `unique_violation` through the fold
dispatcher (and gov's old `_deleted_on_collision` shape is gone); the fold engine `COALESCE`s
keep-before-drop and never overwrites; an unclassified table defaults to `fold_fill_blanks`, never
a blind delete; `re_derivable` deletes directly while `fold_fill_blanks` and the `resolve_status`
fallback both route through the single one-row folder (not a second copy).

## 🚨 MERGE1-sec — the four new fold helpers shipped ANON-EXECUTABLE (found + fixed 2026-09-05, Cowork)

**Both `_{dia,gov}_merge_fold_one_row` and `{dia,gov}_merge_fold_table` were created SECURITY
DEFINER and were reachable by `anon` and `authenticated` on both databases.** Measured immediately
after this migration applied:

```
proacl = {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
has_function_privilege('anon', oid, 'EXECUTE') = TRUE     -- all four
```

These are **destructive and take a TABLE NAME as a parameter** — `*_merge_fold_table` runs dynamic
`UPDATE`/`DELETE` against whatever table the caller names — so this was a strictly worse hole than
the one **SEC1-property closed on `*_merge_property_reversible` three days earlier.** The callers
(`dia_merge_property`, `gov_merge_property_apply`) were already locked; **the helpers they gained
were not.**

- **The durable rule, already in `CLAUDE.md` and paid for again here: a new SECURITY DEFINER
  function is anon-executable BY DEFAULT.** Postgres grants EXECUTE to `PUBLIC` on any new function,
  and Supabase's `ALTER DEFAULT PRIVILEGES` additionally grants it to `anon` and `authenticated`
  **explicitly** — so `REVOKE ... FROM public` alone is a no-op for exactly the two roles that
  matter. Revoke from **all three**, then **assert with `has_function_privilege()`**, never by
  reading the REVOKE you just wrote.
- **This is the third instance of the class in one week** (B6d `compute_feed_cadence`, OCR2
  `<dom>_merge_document_extracted_data`, ADDR1b `gov_merge_property_apply`) and the first where the
  *same PR* that fixed a data-loss defect opened a privilege one. **A migration that CREATEs a
  definer function needs a privilege stanza in the same file**, not a follow-up.

**Fixed live on both domains + committed** as
`supabase/migrations/{dialysis,government}/20260905130000_*_merge1_fold_function_privileges.sql`,
each carrying a positive-controlled assertion block that fails loudly if either role can still
reach either function **and** if `service_role` cannot (which would break the merge path silently).
After: `proacl = {postgres=X/postgres,service_role=X/postgres}`, anon/auth **false**, service_role
**true**, all four.

## Verification of the lockdown — behavioural, on both domains (2026-09-05, Cowork)

Reading the ACL is not proof the caller still works (SEC1-property's lesson). Both merge paths were
re-run **after** the revoke, inside `BEGIN … ROLLBACK`, on synthetic pairs:

| domain | policy exercised | result |
|---|---|---|
| dia | `property_embeddings` → `re_derivable` | merge ran; **1 row remains on the keep side**; ledger `{"policy":"re_derivable","discarded_re_derivable":1,"folded":0}` |
| gov | `property_financials` → `fold_fill_blanks` | merge ran; **1 row remains**, and the keep row's NULL `noi` was **filled from the drop row (987654.32)** — the value the old code destroyed |

Both stamped `merge_function_version = {dia,gov}_merge1_fold_on_collision_2026_09_05`. ✅ **The new
`rewired` ledger reports `folded` / `repointed` / `resolved_in_place` / `discarded_re_derivable`
separately per table** — so a deliberate discard and a loss no longer read the same, which was the
substantive complaint against the old `_error` / `_deleted_on_collision` shapes.

Post-probe state confirmed clean: `gov_property_merge_backup` **0**, `MERGE1SEC%` probe rows **0**
on both domains, `v_gov_property_duplicate_review` still **397**.

## Out of scope (per the filing ticket)

- No backfill of the 205 historical dia losses — they are gone; recorded here as a number and a
  date (the PR12 rule for lost provenance).
- No change to `*_unmerge_property`'s reporting — both already report `_lost`/discard reasons
  honestly.
- No new merge entry point, no FK/`ON DELETE` changes.
- No merges were executed by this change on either domain. `gov_property_merge_backup` remains 0
  rows.
