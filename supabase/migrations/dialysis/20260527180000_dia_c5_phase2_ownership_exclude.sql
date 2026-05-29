-- C5 Phase 2 final (2026-05-27): the EXCLUDE constraint that structurally
-- prevents overlapping ownership periods per property — the belt to the
-- A6a auto-close trigger's procedural suspenders.
--
-- A partial GIST EXCLUDE predicate can only reference a row's own columns,
-- not a subquery against the overlap-review queue. So the "currently part of
-- a residual historical overlap" state is materialized as a boolean column
-- (overlap_grandfathered), set true on the 617 rows in
-- v_ownership_overlap_review_queue, and exempted from the constraint. New
-- rows default false → fully constrained.
--
-- Pre-flight verified: 0 invalid coalesced ranges, 0 residual overlaps among
-- non-grandfathered rows. Live test confirmed exclusion_violation raises on
-- an overlapping insert.

ALTER TABLE public.ownership_history
  ADD COLUMN IF NOT EXISTS overlap_grandfathered boolean NOT NULL DEFAULT false;

WITH queue_rows AS (
  SELECT ownership_id_a AS oid FROM public.v_ownership_overlap_review_queue
  UNION
  SELECT ownership_id_b AS oid FROM public.v_ownership_overlap_review_queue
)
UPDATE public.ownership_history oh
   SET overlap_grandfathered = true
  FROM queue_rows q
 WHERE oh.ownership_id = q.oid
   AND oh.overlap_grandfathered = false;

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE public.ownership_history
  ADD CONSTRAINT excl_oh_no_overlap
  EXCLUDE USING gist (
    property_id WITH =,
    daterange(
      COALESCE(start_date, ownership_start),
      COALESCE(end_date, ownership_end, 'infinity'::date),
      '[)'
    ) WITH &&
  )
  WHERE (
    ownership_state = 'active'
    AND property_id IS NOT NULL
    AND overlap_grandfathered = false
    AND COALESCE(start_date, ownership_start) IS NOT NULL
  );

COMMENT ON CONSTRAINT excl_oh_no_overlap ON public.ownership_history IS
  'C5 Phase 2 (2026-05-27): no two active, non-grandfathered ownership rows on the same property may have overlapping [start, end) dateranges. Grandfathers the 617 rows in the residual overlap-review queue (different-owner chain breaks). New rows are fully constrained; the A6a trigger handles the common forward-close case procedurally.';
