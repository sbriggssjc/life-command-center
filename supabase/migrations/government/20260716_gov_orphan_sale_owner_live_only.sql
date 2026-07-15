-- ============================================================================
-- gov v_gap_orphan_sale_owner — only a LIVE sale is a genuine orphan (2026-07-15)
--
-- The "Back-link sale to recorded_owner" next-action (gap_type='orphan_sale_owner'
-- in v_next_best_action) surfaced EVERY sale with a NULL recorded_owner_id — but
-- that includes the sales R37's dedup already marked transaction_state <>'live'
-- (duplicate_superseded). So a re-captured duplicate (e.g. gov 16500 carried FIVE
-- identical no-price 2022 "The Rainier Companies" sales, all superseded) produced
-- one phantom "backlink" action per duplicate — unworkable noise, and actioning
-- one would attribute a superseded phantom to the owner.
--
-- Fix: only consider transaction_state='live'. A superseded duplicate is already
-- handled by the dedup and must never be operator work. Live impact 2026-07-15:
-- gov orphan_sale_owner actions 2,359 → 274 (2,085 superseded-dup phantoms
-- removed, 88% noise; 705 → 237 distinct properties).
--
-- Additive predicate only (same columns) — CREATE OR REPLACE. Reversible by
-- re-creating the prior body without the transaction_state filter. Apply on gov.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_gap_orphan_sale_owner AS
 SELECT s.sale_id,
    s.property_id,
    p.recorded_owner_id AS property_recorded_owner_id,
    ro.name AS owner_name,
    s.sale_date,
    s.sold_price,
    p.estimated_value AS property_value
   FROM sales_transactions s
     JOIN properties p ON p.property_id = s.property_id
     LEFT JOIN recorded_owners ro ON ro.recorded_owner_id = p.recorded_owner_id
  WHERE s.recorded_owner_id IS NULL
    AND p.recorded_owner_id IS NOT NULL
    AND s.transaction_state = 'live'    -- only a live sale is a genuine orphan
    AND s.sale_date > (CURRENT_DATE - '5 years'::interval);
