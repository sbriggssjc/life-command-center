-- C5 (2026-05-27): triage view for residual ownership-overlap pairs.
-- These are different-true_owner overlaps on the same property — genuine
-- chain-break situations that need analyst review (e.g. who actually held
-- title between dates X and Y?). C5 EXCLUDE Phase 2 lands once this queue
-- is drained.

CREATE OR REPLACE VIEW public.v_ownership_overlap_review_queue AS
WITH ranges AS (
  SELECT
    oh.ownership_id, oh.property_id, oh.true_owner_id, oh.recorded_owner_id,
    oh.sale_id, oh.ownership_source,
    COALESCE(oh.start_date, oh.ownership_start) AS eff_start,
    COALESCE(oh.end_date, oh.ownership_end, 'infinity'::date) AS eff_end,
    oh.end_date IS NULL AND oh.ownership_end IS NULL AS is_open,
    daterange(
      COALESCE(oh.start_date, oh.ownership_start),
      COALESCE(oh.end_date, oh.ownership_end, 'infinity'::date), '[)'
    ) AS r
  FROM public.ownership_history oh
  WHERE oh.ownership_state = 'active' AND oh.property_id IS NOT NULL
    AND COALESCE(oh.start_date, oh.ownership_start) IS NOT NULL
)
SELECT
  r1.property_id,
  r1.ownership_id AS ownership_id_a, r2.ownership_id AS ownership_id_b,
  r1.is_open AS is_open_a, r2.is_open AS is_open_b,
  r1.eff_start AS start_a, r1.eff_end AS end_a,
  r2.eff_start AS start_b, r2.eff_end AS end_b,
  r1.true_owner_id AS true_owner_id_a, r2.true_owner_id AS true_owner_id_b,
  r1.recorded_owner_id AS recorded_owner_id_a, r2.recorded_owner_id AS recorded_owner_id_b,
  r1.sale_id AS sale_id_a, r2.sale_id AS sale_id_b,
  r1.ownership_source AS source_a, r2.ownership_source AS source_b,
  CASE
    WHEN r1.is_open OR r2.is_open THEN 'open_overlap'
    ELSE 'both_closed_overlap'
  END AS overlap_kind,
  CASE
    WHEN r1.true_owner_id IS NULL OR r2.true_owner_id IS NULL THEN 'missing_owner_data'
    WHEN r1.true_owner_id = r2.true_owner_id THEN 'same_owner_residual_should_not_appear'
    ELSE 'different_owners_chain_break'
  END AS hint
FROM ranges r1
JOIN ranges r2
  ON r1.property_id = r2.property_id
 AND r1.ownership_id < r2.ownership_id
 AND r1.r && r2.r;

COMMENT ON VIEW public.v_ownership_overlap_review_queue IS
  'C5 (2026-05-27): residual ownership_history overlap pairs awaiting analyst review. Most are different-true_owner chain-break situations. Drain this queue to 0, then C5 Phase 2 lands the EXCLUDE USING gist constraint.';
