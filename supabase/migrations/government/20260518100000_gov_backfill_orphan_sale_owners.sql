-- ============================================================================
-- Fresh audit A-1 (gov, 2026-05-18): backfill recorded_owner_id on the
-- most-recent orphan sale per property using properties.recorded_owner_id.
--
-- Verified safety counts (before):
--   safe_most_recent_orphan  3,466
--   unsafe_earlier_sales     3,399  (left untouched)
--   single_sale_only         1,987  (subset of safe)
--   already_set_and_disagreeing  64 (preserved — historical buyers)
--
-- Effect on NBA queue:
--   orphan_sale_owner: 2,373 → 1,029  (-1,344 closed, -414 excellent-band)
-- ============================================================================
-- Restrict to most-recent orphan sale per property. The property's
-- recorded_owner_id only safely attributes to the LATEST transaction;
-- earlier orphan sales had different buyers (the property has changed
-- hands since) and stay as legit orphan_sale_owner NBA gaps until they
-- can be resolved via ownership_history.
WITH ranked AS (
  SELECT s.sale_id,
         s.property_id,
         p.recorded_owner_id AS prop_owner,
         row_number() OVER (
           PARTITION BY s.property_id
           ORDER BY s.sale_date DESC NULLS LAST, s.sale_id DESC
         ) AS rn
    FROM public.sales_transactions s
    JOIN public.properties p ON p.property_id = s.property_id
   WHERE s.recorded_owner_id IS NULL
     AND p.recorded_owner_id IS NOT NULL
)
UPDATE public.sales_transactions s
   SET recorded_owner_id = r.prop_owner,
       updated_at = now()
  FROM ranked r
 WHERE r.rn = 1
   AND s.sale_id = r.sale_id;