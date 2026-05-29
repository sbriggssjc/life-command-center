-- C5 (2026-05-27): structural integrity guards on dia.ownership_history.
--
-- Step 1 of 2 — landing now: CHECK constraints for date ordering on both
-- date-column pairs. Schema has historically used BOTH (start_date,
-- end_date) AND (ownership_start, ownership_end) because two writer
-- generations populate different pairs; both must be valid when populated.
-- 0 violations pre-flight.
--
-- Step 2 (deferred): EXCLUDE USING gist constraint preventing overlapping
-- daterange per property. Blocked on 746 residual historical overlaps
-- (different-owner chain-break situations needing analyst review, not
-- auto-resolution). See v_ownership_overlap_review_queue for the triage
-- surface.

ALTER TABLE public.ownership_history
  ADD CONSTRAINT chk_oh_start_end_order
  CHECK (
    (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
    AND (ownership_end IS NULL OR ownership_start IS NULL OR ownership_end >= ownership_start)
  );

COMMENT ON CONSTRAINT chk_oh_start_end_order ON public.ownership_history IS
  'C5 (2026-05-27): both date-column pairs must respect start <= end when both are populated. Pre-flight: 0 violations.';
