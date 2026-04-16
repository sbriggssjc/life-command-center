-- Migration: Backfill properties.anchor_rent/date/source from active leases
-- Applied to Dialysis_DB (zqzrriwuavgrquhisnoa) on 2026-04-16
--
-- Context: Before the sidebar-pipeline anchor-promotion step
-- (api/_handlers/sidebar-pipeline.js upsertDomainLeases), anchor_rent was only
-- populated when CoStar sidebar metadata explicitly carried anchor_rent. Many
-- properties have active lease rows (documented or estimated) whose annual_rent
-- is the authoritative figure, but properties.anchor_rent is still NULL — which
-- causes recalculateSaleCapRates (api/_shared/rent-projection.js) to no-op and
-- leaves historical sales with stated CoStar cap rates instead of recalculated
-- cap rates against the real rent.
--
-- This one-shot fill picks the best active lease per property:
--   (1) source_confidence = 'documented' (→ 'lease_confirmed')
--   (2) source_confidence = 'estimated'  (→ 'om_confirmed')
-- Tiebreak on higher annual_rent (primary tenant), then earliest lease_start.
--
-- After this migration runs, the cap-rate recalc will automatically re-stamp
-- calculated_cap_rate on prior sales for every backfilled property.

BEGIN;

WITH best_lease AS (
  SELECT DISTINCT ON (l.property_id)
    l.property_id,
    l.annual_rent,
    l.lease_start,
    CASE l.source_confidence
      WHEN 'documented' THEN 'lease_confirmed'
      WHEN 'estimated'  THEN 'om_confirmed'
    END AS anchor_source
  FROM leases l
  WHERE l.is_active = true
    AND l.annual_rent IS NOT NULL
    AND l.annual_rent > 0
    AND l.lease_start IS NOT NULL
    AND l.source_confidence IN ('documented','estimated')
  ORDER BY
    l.property_id,
    CASE l.source_confidence
      WHEN 'documented' THEN 0
      WHEN 'estimated'  THEN 1
      ELSE 2
    END,
    l.annual_rent DESC NULLS LAST,
    l.lease_start ASC NULLS LAST,
    l.lease_id ASC
)
UPDATE properties p SET
  anchor_rent        = best_lease.annual_rent,
  anchor_rent_date   = best_lease.lease_start,
  anchor_rent_source = best_lease.anchor_source
FROM best_lease
WHERE p.property_id = best_lease.property_id
  AND p.anchor_rent IS NULL;

COMMIT;
