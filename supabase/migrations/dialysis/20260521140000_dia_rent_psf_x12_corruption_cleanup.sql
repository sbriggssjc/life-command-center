-- ============================================================================
-- Data-quality cleanup (2026-05-21): correct the ×12 rent corruption found
-- during the deal-value reconciliation audit.
--
-- Symptom: ~84 dia properties showed last_known_rent at $200-$1,200 per SF —
-- 5-30× a realistic dialysis lease ($15-$60/SF/yr). After the NBA-value fix,
-- the corrupted rent still drove rev_value into the $40-50M range for what
-- are typically $2-6M clinics.
--
-- Diagnosis: A subset of historical captures (data_source=NULL legacy import,
-- never re-touched by the current sidebar-pipeline writers) stored annual
-- rent multiplied by 12 — almost certainly an early ingestor that read
-- "Annual Rent: $843,299" and stored it as `monthly × 12 squared`. The
-- ×12 fingerprint is clean:
--
--   50 N La Cienega Blvd: properties.last_known_rent  = $10,119,586
--                         lease.annual_rent           = $843,299
--                         $843,299 × 12 = $10,119,588  ← exact match
--
--   1030 N Kings Hwy:     properties.last_known_rent  = $3,733,200
--                         lease.annual_rent           = $311,100
--                         $311,100 × 12 = $3,733,200   ← exact match
--
-- For 43 of the 84 bad rows, BOTH properties.last_known_rent and
-- leases.annual_rent carry the same inflated value (the corruption hit
-- both tables in the same import). For the rest, properties was inflated
-- but the underlying lease row had the correct annual rent.
--
-- This migration takes a conservative auto-correction approach:
--
--   - Divide last_known_rent / anchor_rent / leases.annual_rent /
--     leases.rent_per_sf by 12 ONLY when the PSF fingerprint is clear:
--       current PSF > 150  AND  div12 PSF in [10, 80]
--     That window excludes:
--       - legitimate premium specialty / urban medical retail (often $60-100/SF)
--       - rows where div12 doesn't land in a dialysis-realistic range
--         (i.e., a different corruption mode that needs human review)
--
--   - The remaining ~50 ambiguous rows surface via the new
--     `rent_psf_anomaly` entry in v_data_quality_issues for manual triage.
--
--   - Companion sidebar-pipeline.js patch adds an upstream guard so future
--     captures with PSF > 200 either auto-divide or get rejected, preventing
--     this corruption from reappearing.
--
-- Audit counts (pre-correction):
--   properties.last_known_rent: 113 rows match the auto-fix window
--   properties.anchor_rent:       3 rows
--   leases.annual_rent:          70 active rows
-- ============================================================================

-- 1) Correct properties.last_known_rent where the ×12 fingerprint is clean.
UPDATE public.properties
SET last_known_rent = last_known_rent / 12.0,
    notes = CASE
      WHEN notes IS NULL OR notes = '' THEN '[2026-05-21 DQ] last_known_rent corrected /12 (was ×12-inflated from legacy import).'
      ELSE notes || E'\n[2026-05-21 DQ] last_known_rent corrected /12 (was ×12-inflated from legacy import).'
    END
WHERE last_known_rent IS NOT NULL
  AND building_size IS NOT NULL
  AND building_size > 100
  AND last_known_rent / building_size > 150
  AND (last_known_rent / 12 / building_size) BETWEEN 10 AND 80;

-- 2) Correct properties.anchor_rent on the same fingerprint (rare; ~3 rows).
UPDATE public.properties
SET anchor_rent = anchor_rent / 12.0
WHERE anchor_rent IS NOT NULL
  AND building_size IS NOT NULL
  AND building_size > 100
  AND anchor_rent / building_size > 150
  AND (anchor_rent / 12 / building_size) BETWEEN 10 AND 80;

-- 3) Correct leases.annual_rent + rent_per_sf on the same fingerprint.
UPDATE public.leases
SET annual_rent = annual_rent / 12.0,
    rent_per_sf = CASE
      WHEN rent_per_sf IS NOT NULL THEN rent_per_sf / 12.0
      ELSE NULL
    END
WHERE is_active = true
  AND annual_rent IS NOT NULL
  AND leased_area IS NOT NULL
  AND leased_area > 100
  AND annual_rent / leased_area > 150
  AND (annual_rent / 12 / leased_area) BETWEEN 10 AND 80;

-- 4) Refresh the materialized value signal so the corrections flow into
--    v_property_value_signal + v_next_best_action immediately.
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_property_value_signal;

-- 5) Extend v_data_quality_issues with rent_psf_anomaly so any residual
--    bad rows (didn't fit the clean ×12 fingerprint) surface for triage.
--    The view already lives at public.v_data_quality_issues with the
--    UNION-ALL shape (issue_kind, record_id, detail_1, detail_2, detail_3,
--    severity, suggested_action); we recreate it with the new arm appended.
CREATE OR REPLACE VIEW public.v_data_quality_issues AS
WITH dup_props AS (
  SELECT 'duplicate_property_address'::text AS issue_kind,
    p.property_id::text AS record_id,
    p.address AS detail_1, p.state AS detail_2, p.tenant AS detail_3,
    g.dupe_count::integer AS severity,
    ('Same normalized address+state used by ' || g.dupe_count || ' property_ids: '
      || array_to_string(g.property_ids[1:5], ', ')
      || CASE WHEN g.dupe_count > 5 THEN '…' ELSE '' END) AS suggested_action
  FROM properties p
  JOIN (
    SELECT state,
      lower(TRIM(regexp_replace(address, '\s+', ' ', 'g'))) AS norm_addr,
      count(*) AS dupe_count,
      array_agg(property_id ORDER BY property_id) AS property_ids
    FROM properties
    WHERE address IS NOT NULL
    GROUP BY state, lower(TRIM(regexp_replace(address, '\s+', ' ', 'g')))
    HAVING count(*) > 1
  ) g ON g.state::text = p.state::text
     AND g.norm_addr = lower(TRIM(regexp_replace(p.address, '\s+', ' ', 'g')))
),
multi_lease AS (
  SELECT 'multi_active_lease'::text AS issue_kind,
    property_id::text AS record_id,
    NULL::text AS detail_1, NULL::text AS detail_2, NULL::text AS detail_3,
    count(*)::integer AS severity,
    ('Property has ' || count(*) || ' active leases. Review for stale duplicates vs legitimate multi-tenant.') AS suggested_action
  FROM leases
  WHERE is_active = true
  GROUP BY property_id
  HAVING count(*) > 1
),
listing_after_sale AS (
  SELECT 'listing_after_sale'::text AS issue_kind,
    al.listing_id::text AS record_id,
    al.status AS detail_1, st.sale_date::text AS detail_2, al.listing_date::text AS detail_3,
    1 AS severity,
    ('Listing is active but a sale was recorded on ' || st.sale_date
      || '. Check if listing pre-dates sale (should be Sold) or is a relisting.') AS suggested_action
  FROM available_listings al
  JOIN sales_transactions st ON st.property_id = al.property_id
  WHERE al.is_active = true
    AND (al.status::text <> ALL (ARRAY['Sold'::text, 'sold'::text]))
    AND st.sale_date IS NOT NULL
    AND (al.listing_date IS NULL OR al.listing_date <= st.sale_date)
),
orphan_listings AS (
  SELECT 'orphan_listing'::text AS issue_kind,
    al.listing_id::text AS record_id,
    al.property_id::text AS detail_1, NULL::text AS detail_2, NULL::text AS detail_3,
    1 AS severity,
    ('Listing references property_id ' || al.property_id || ' which no longer exists in properties.') AS suggested_action
  FROM available_listings al
  WHERE NOT EXISTS (SELECT 1 FROM properties p WHERE p.property_id = al.property_id)
),
date_less_leases AS (
  SELECT 'lease_no_dates'::text AS issue_kind,
    lease_id::text AS record_id,
    property_id::text AS detail_1, tenant AS detail_2, NULL::text AS detail_3,
    1 AS severity,
    'Active lease has neither lease_start nor lease_expiration. Likely a placeholder.'::text AS suggested_action
  FROM leases
  WHERE is_active = true AND lease_start IS NULL AND lease_expiration IS NULL
),
truly_empty_props AS (
  SELECT
    CASE
      WHEN p.address IS NULL OR TRIM(p.address) = '' THEN 'property_no_address'::text
      WHEN p.medicare_id IS NOT NULL THEN 'property_orphan_medicare_id'::text
      ELSE 'property_unverified'::text
    END AS issue_kind,
    p.property_id::text AS record_id,
    p.address AS detail_1, p.tenant AS detail_2, p.medicare_id AS detail_3,
    CASE
      WHEN p.address IS NULL OR TRIM(p.address) = '' THEN 3
      WHEN p.medicare_id IS NOT NULL THEN 2
      ELSE 1
    END AS severity,
    CASE
      WHEN p.address IS NULL OR TRIM(p.address) = ''
        THEN 'Property row with no address and no operational data (no leases, sales, listings, clinics). Almost certainly a failed import / aborted stub. Cleanup candidate.'::text
      WHEN p.medicare_id IS NOT NULL
        THEN ('Property has medicare_id ' || p.medicare_id || ' but no medicare_clinics row references it (or clinic was deleted). Re-link the clinic, clear the stale medicare_id, or merge into a canonical property.')
      ELSE 'Property has an address but no leases, sales, listings, or clinics. Could be legitimate-but-unverified or a mid-import casualty.'::text
    END AS suggested_action
  FROM properties p
  WHERE NOT EXISTS (SELECT 1 FROM leases l              WHERE l.property_id = p.property_id AND l.is_active = true)
    AND NOT EXISTS (SELECT 1 FROM sales_transactions s  WHERE s.property_id = p.property_id)
    AND NOT EXISTS (SELECT 1 FROM available_listings al WHERE al.property_id = p.property_id)
    AND NOT EXISTS (SELECT 1 FROM medicare_clinics m    WHERE m.property_id = p.property_id)
),
anchor_no_bump AS (
  SELECT 'property_anchor_rent_no_bump'::text AS issue_kind,
    p.property_id::text AS record_id,
    p.anchor_rent::text AS detail_1, p.anchor_rent_source AS detail_2,
    CASE
      WHEN EXISTS (SELECT 1 FROM lease_escalations le WHERE le.property_id = p.property_id)
        THEN 'has_escalation_rows'::text
      ELSE 'no_escalation_rows'::text
    END AS detail_3,
    2 AS severity,
    'Property has anchor_rent set but lease_bump_pct is NULL/0. dia_project_rent_at_date returns static anchor for all future dates, so cap-rate projections from this property are stale. Set lease_bump_pct (decimal, e.g. 0.02 for 2%) and lease_bump_interval_mo (12 for annual, 60 for every-5-years) from the underlying lease abstract.'::text AS suggested_action
  FROM properties p
  WHERE p.anchor_rent IS NOT NULL AND (p.lease_bump_pct IS NULL OR p.lease_bump_pct = 0)
),
-- NEW (2026-05-21 DQ): rent figures that still look corrupted after the
-- ×12 backfill. These didn't fit the clean fingerprint (div12 PSF lands
-- outside [10, 80], or building_size was NULL so we couldn't verify),
-- so they need human review.
rent_anomaly_property AS (
  SELECT 'rent_psf_anomaly'::text AS issue_kind,
    p.property_id::text AS record_id,
    p.address AS detail_1,
    ('last_known_rent=' || p.last_known_rent::bigint
      || ' building_size=' || p.building_size::int
      || ' PSF=' || ROUND((p.last_known_rent / p.building_size)::numeric, 0)) AS detail_2,
    'properties.last_known_rent'::text AS detail_3,
    CASE
      WHEN p.last_known_rent / p.building_size > 500 THEN 3
      WHEN p.last_known_rent / p.building_size > 200 THEN 2
      ELSE 1
    END AS severity,
    ('PSF of $' || ROUND((p.last_known_rent / p.building_size)::numeric, 0)
      || '/SF is well above the $15-60/SF realistic dialysis range. '
      || CASE
           WHEN (p.last_known_rent / 12 / p.building_size) BETWEEN 5 AND 100
             THEN 'Dividing by 12 lands at $' || ROUND((p.last_known_rent / 12 / p.building_size)::numeric, 0)
                  || '/SF (the ×12 fingerprint), but the corrected value was outside the auto-fix window — review and correct manually.'
           ELSE 'Doesn''t fit the ×12 fingerprint; likely a different corruption mode (total contract value, wrong units, etc.). Compare against leases.annual_rent and the source OM/lease abstract.'
         END
    ) AS suggested_action
  FROM properties p
  WHERE p.last_known_rent IS NOT NULL
    AND p.building_size IS NOT NULL
    AND p.building_size > 100
    AND p.last_known_rent / p.building_size > 100
),
rent_anomaly_lease AS (
  SELECT 'rent_psf_anomaly'::text AS issue_kind,
    l.lease_id::text AS record_id,
    l.tenant AS detail_1,
    ('annual_rent=' || l.annual_rent::bigint
      || ' leased_area=' || l.leased_area::int
      || ' PSF=' || ROUND((l.annual_rent / l.leased_area)::numeric, 0)) AS detail_2,
    'leases.annual_rent'::text AS detail_3,
    CASE
      WHEN l.annual_rent / l.leased_area > 500 THEN 3
      WHEN l.annual_rent / l.leased_area > 200 THEN 2
      ELSE 1
    END AS severity,
    ('Active lease PSF of $' || ROUND((l.annual_rent / l.leased_area)::numeric, 0)
      || '/SF is well above the $15-60/SF realistic dialysis range. Review the source OM/lease abstract — the figure may be total contract value or misread units.'
    ) AS suggested_action
  FROM leases l
  WHERE l.is_active = true
    AND l.annual_rent IS NOT NULL
    AND l.leased_area IS NOT NULL
    AND l.leased_area > 100
    AND l.annual_rent / l.leased_area > 100
)
SELECT * FROM dup_props
UNION ALL SELECT * FROM multi_lease
UNION ALL SELECT * FROM listing_after_sale
UNION ALL SELECT * FROM orphan_listings
UNION ALL SELECT * FROM date_less_leases
UNION ALL SELECT * FROM truly_empty_props
UNION ALL SELECT * FROM anchor_no_bump
UNION ALL SELECT * FROM rent_anomaly_property
UNION ALL SELECT * FROM rent_anomaly_lease;
