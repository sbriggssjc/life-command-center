-- ============================================================================
-- 20260523140000_gov_A5_cap_rate_retro_tag_and_B5_tick.sql
-- OWNERSHIP_AND_SALES_REMEDIATION_PLAN — A5 (one-shot) + B5 (continuous) (gov)
--
-- Mirror of dia A5/B5 with two differences:
--   1. Gov sales_transactions uses sold_cap_rate (no plain cap_rate col).
--   2. Default asset_class is 'government_leased' (gov is fundamentally
--      federally-leased real estate; 94% have NULL building_type).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.gov_asset_class_for(p_building_type TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_building_type IS NULL THEN 'government_leased'
    WHEN p_building_type ILIKE '%medical%'    THEN 'medical_office'
    WHEN p_building_type ILIKE '%healthcare%' THEN 'medical_office'
    WHEN p_building_type ILIKE '%retail%'     THEN 'retail'
    WHEN p_building_type ILIKE '%shop%'       THEN 'retail'
    WHEN p_building_type IN ('RT')            THEN 'retail'
    WHEN p_building_type ILIKE '%office%'     THEN 'government_leased'  -- gov office = govt-leased
    WHEN p_building_type IN ('OF')            THEN 'government_leased'
    WHEN p_building_type ILIKE '%industrial%' THEN 'industrial'
    WHEN p_building_type ILIKE '%warehouse%'  THEN 'industrial'
    WHEN p_building_type ILIKE '%flex%'       THEN 'industrial'
    WHEN p_building_type IN ('IN')            THEN 'industrial'
    ELSE 'government_leased'  -- gov-domain default
  END;
$$;

COMMENT ON FUNCTION public.gov_asset_class_for IS
  'Maps gov.properties.building_type to a cap_rate_bands.asset_class key. Defaults to government_leased (94% of gov properties have NULL building_type and the entire domain is federally-leased real estate).';

CREATE OR REPLACE FUNCTION public.cap_rate_quality_tick()
RETURNS TABLE (
  rows_tagged_implausible BIGINT,
  rows_tagged_stated_only BIGINT,
  run_at                  TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_impl BIGINT := 0;
  v_ok   BIGINT := 0;
BEGIN
  WITH classed AS (
    SELECT s.sale_id,
           s.sold_cap_rate,
           public.gov_asset_class_for(p.building_type) AS asset_class
    FROM public.sales_transactions s
    LEFT JOIN public.properties p ON p.property_id = s.property_id
    WHERE s.transaction_state = 'live'
      AND s.sold_cap_rate IS NOT NULL
  ),
  banded AS (
    SELECT c.sale_id, c.sold_cap_rate, c.asset_class,
           (SELECT min_pct FROM public.cap_rate_band_for(c.asset_class)) AS band_min,
           (SELECT max_pct FROM public.cap_rate_band_for(c.asset_class)) AS band_max
    FROM classed c
  ),
  to_implausible AS (
    UPDATE public.sales_transactions s
       SET cap_rate_quality = 'implausible_unverified',
           updated_at = now()
      FROM banded b
     WHERE s.sale_id = b.sale_id
       AND (b.sold_cap_rate < b.band_min OR b.sold_cap_rate > b.band_max)
       AND s.cap_rate_quality IS DISTINCT FROM 'implausible_unverified'
    RETURNING s.sale_id
  )
  SELECT COUNT(*) INTO v_impl FROM to_implausible;

  WITH classed AS (
    SELECT s.sale_id,
           s.sold_cap_rate,
           public.gov_asset_class_for(p.building_type) AS asset_class
    FROM public.sales_transactions s
    LEFT JOIN public.properties p ON p.property_id = s.property_id
    WHERE s.transaction_state = 'live'
      AND s.sold_cap_rate IS NOT NULL
      AND s.cap_rate_quality IS NULL
  ),
  banded AS (
    SELECT c.sale_id, c.sold_cap_rate,
           (SELECT min_pct FROM public.cap_rate_band_for(c.asset_class)) AS band_min,
           (SELECT max_pct FROM public.cap_rate_band_for(c.asset_class)) AS band_max
    FROM classed c
  ),
  to_stated AS (
    UPDATE public.sales_transactions s
       SET cap_rate_quality = 'stated_only',
           updated_at = now()
      FROM banded b
     WHERE s.sale_id = b.sale_id
       AND b.sold_cap_rate >= b.band_min AND b.sold_cap_rate <= b.band_max
    RETURNING s.sale_id
  )
  SELECT COUNT(*) INTO v_ok FROM to_stated;

  RETURN QUERY SELECT v_impl, v_ok, now();
END;
$$;

COMMENT ON FUNCTION public.cap_rate_quality_tick IS
  'B5: continuous-propagation worker. Tags live gov sales cap_rate_quality based on cap_rate_bands lookup keyed on sold_cap_rate. Idempotent.';

DO $$
DECLARE
  v_existing_jobid BIGINT;
BEGIN
  SELECT jobid INTO v_existing_jobid
  FROM cron.job WHERE jobname = 'lcc-gov-cap-rate-quality-tick';

  IF v_existing_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_existing_jobid);
  END IF;

  PERFORM cron.schedule(
    'lcc-gov-cap-rate-quality-tick',
    '15 3 * * *',
    $cron$SELECT public.cap_rate_quality_tick();$cron$
  );

  RAISE NOTICE '[B5] Scheduled lcc-gov-cap-rate-quality-tick (nightly 03:15 UTC)';
END $$;
