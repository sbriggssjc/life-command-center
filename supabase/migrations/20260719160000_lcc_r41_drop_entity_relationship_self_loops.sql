-- ============================================================================
-- R41 — drop entity_relationships self-loops + enforce at the DB
-- (2026-06-16, LCC Opps only)
--
-- Surfaced by R40: after the merge-orphan reconcile (0 dangling edges on
-- tombstones), the only remaining entity_relationships hygiene wart is the
-- self-loops — rows where from_entity_id = to_entity_id (an entity related to
-- ITSELF). They come from old capture/merge logic (a sale where buyer == seller,
-- or a self-reference), all on LIVE entities (0 on tombstones, so not an R40
-- artifact). Low impact (a graph traversal shows an entity as its own neighbor)
-- but noise in the "accurate connected picture" and trivially fixable.
--
-- Characterized live 2026-06-16 (100 rows / 33 entities; none meaningful):
--   purchases 47 | associated_with 21 | owns 19 | sells 13
-- No legitimate self-edge type exists, so the DB CHECK below is safe.
--
-- Unit 1 (the writer guard) ships in JS: every entity_relationships writer now
-- routes through `insertEntityRelationship()` (api/_shared/ops-db.js), which
-- skips a self-loop before the DB call. This migration is Unit 2: clean the
-- existing rows (reversibly) and add the CHECK so neither a future JS path nor
-- any SQL writer can recreate one. The R40 reconcile helper already pre-deletes
-- self-loop-producing edges before repointing, so the merge path is compatible
-- with the constraint.
--
-- Reversible (snapshot before delete), idempotent (re-run finds 0 self-loops).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Reversible backup ledger (mirror R40's r40_merge_reconcile_backup pattern).
-- Drop this table to reverse: re-INSERT old_row back into entity_relationships.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.r41_self_loop_backup (
  id            bigserial PRIMARY KEY,
  removed_at    timestamptz NOT NULL DEFAULT now(),
  record_pk     text,
  old_row       jsonb NOT NULL
);

-- Snapshot every current self-loop. On a re-run there are none (already deleted)
-- so this is a no-op — idempotent.
INSERT INTO public.r41_self_loop_backup (record_pk, old_row)
SELECT r.id::text, to_jsonb(r.*)
FROM   public.entity_relationships r
WHERE  r.from_entity_id = r.to_entity_id;

-- Delete the self-loops.
DELETE FROM public.entity_relationships
WHERE from_entity_id = to_entity_id;

-- ---------------------------------------------------------------------------
-- Enforce at the DB. After the DELETE 0 rows violate, so the validating ADD
-- CONSTRAINT succeeds. Guarded so a replay/re-apply is idempotent.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.entity_relationships'::regclass
      AND conname  = 'chk_entity_relationships_no_self_loop'
  ) THEN
    ALTER TABLE public.entity_relationships
      ADD CONSTRAINT chk_entity_relationships_no_self_loop
      CHECK (from_entity_id <> to_entity_id);
  END IF;
END$$;

COMMIT;
