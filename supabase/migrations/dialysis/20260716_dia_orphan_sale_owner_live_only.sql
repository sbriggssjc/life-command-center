-- ============================================================================
-- dia v_gap_orphan_sale_owner — only a LIVE sale is a genuine orphan (2026-07-15)
--
-- Parallel to the gov fix. The "Back-link sale to recorded_owner" next-action
-- (gap_type='orphan_sale_owner') surfaced every sale with a NULL recorded_owner_id,
-- including the ones R37's dedup already marked transaction_state<>'live'
-- (duplicate_superseded) — phantom "backlink" noise. Only a LIVE sale is a
-- genuine orphan. Live impact 2026-07-15: dia orphan_sale_owner actions
-- 454 → 370 (84 superseded-dup phantoms removed).
--
-- Additive predicate only (same columns) — CREATE OR REPLACE. Reversible by
-- re-creating the prior body without the transaction_state filter. Apply on dia.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_gap_orphan_sale_owner AS
 SELECT s.sale_id,
    s.property_id,
    p.recorded_owner_id AS property_recorded_owner_id,
    ro.name AS owner_name,
    s.sale_date,
    s.sold_price,
    p.current_value_estimate AS property_value
   FROM sales_transactions s
     JOIN properties p ON p.property_id = s.property_id
     LEFT JOIN recorded_owners ro ON ro.recorded_owner_id = p.recorded_owner_id
  WHERE s.recorded_owner_id IS NULL
    AND p.recorded_owner_id IS NOT NULL
    AND s.transaction_state = 'live'    -- only a live sale is a genuine orphan
    AND s.sale_date > (CURRENT_DATE - '5 years'::interval);
