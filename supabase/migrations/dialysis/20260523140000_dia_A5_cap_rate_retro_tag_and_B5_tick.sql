-- ============================================================================
-- 20260523140000_dia_A5_cap_rate_retro_tag_and_B5_tick.sql
-- OWNERSHIP_AND_SALES_REMEDIATION_PLAN — A5 (one-shot) + B5 (continuous) (dia)
--
-- A5: walk every live sale with a non-null cap_rate, look up the
--     appropriate cap_rate_bands entry (dia defaults to 'dialysis' since
--     93% of dia properties are dialysis facilities and 92% have NULL
--     building_type), and tag cap_rate_quality with one of:
--       'verified'              — calculated_cap_rate matches stated ±0.5pp
--       'stated_only'           — in-band but no rent to verify against
--       'implausible_unverified'— outside the class band
--     The row stays in transaction_state='live'. Comp views can opt in
--     to `WHERE cap_rate_quality NOT IN ('implausible_unverified')`.
--
-- B5: function + pg_cron schedule that re-runs A5 logic continuously.
--     Idempotent — only tags rows whose cap_rate_quality is currently NULL
--     or differs from the computed value. Scheduled nightly (slower
--     cadence than B1 because cap rates change less frequently than
--     duplicate inserts arrive).
--
-- The function maps building_type → asset_class via a small CASE so a
-- non-dialysis dia property (e.g. 'Medical Office') uses its own band.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.dia_asset_class_for(p_building_type TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_building_type IS NULL THEN 'dialysis'
    WHEN p_building_type ILIKE '%dialysis%'   THEN 'dialysis'
    WHEN p_building_type ILIKE '%medical%'    THEN 'medical_office'
    WHEN p_building_type ILIKE '%healthcare%' THEN 'medical_office'
    WHEN p_building_type ILIKE '%retail%'     THEN 'retail'
    WHEN p_building_type ILIKE '%shop%'       THEN 'retail'
    WHEN p_building_type ILIKE '%storefront%' THEN 'retail'
    WHEN p_building_type ILIKE '%office%'     THEN 'office'
    WHEN p_building_type ILIKE '%industrial%' THEN 'industrial'
    WHEN p_building_type ILIKE '%warehouse%'  THEN 'industrial'
    WHEN p_building_type ILIKE '%flex%'       THEN 'industrial'
    ELSE 'dialysis'  -- dia-domain default
  END;
$$;

COMMENT ON FUNCTION public.dia_asset_class_for IS
  'Maps dia.properties.building_type to a cap_rate_bands.asset_class key. Defaults to dialysis (the domain default — 93% of dia properties are dialysis facilities).';

-- ----------------------------------------------------------------------------
-- A5 retroactive tagging (one-shot, but the function is also reused by B5)
-- ----------------------------------------------------------------------------
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
  -- Step 1: tag implausible (cap rate outside the class band)
  WITH classed AS (
    SELECT s.sale_id,
           s.cap_rate,
           public.dia_asset_class_for(p.building_type) AS asset_class
    FROM public.sales_transactions s
    LEFT JOIN public.properties p ON p.property_id = s.property_id
    WHERE s.transaction_state = 'live'
      AND s.cap_rate IS NOT NULL
  ),
  banded AS (
    SELECT c.sale_id, c.cap_rate, c.asset_class,
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
       AND (b.cap_rate < b.band_min OR b.cap_rate > b.band_max)
       AND s.cap_rate_quality IS DISTINCT FROM 'implausible_unverified'
    RETURNING s.sale_id
  )
  SELECT COUNT(*) INTO v_impl FROM to_implausible;

  -- Step 2: tag in-band as 'stated_only' (we don't have rent to verify here).
  -- 'verified' tagging happens in a separate enrichment pass when
  -- calculated_cap_rate is computed from rent_at_sale + sold_price.
  WITH classed AS (
    SELECT s.sale_id,
           s.cap_rate,
           public.dia_asset_class_for(p.building_type) AS asset_class
    FROM public.sales_transactions s
    LEFT JOIN public.properties p ON p.property_id = s.property_id
    WHERE s.transaction_state = 'live'
      AND s.cap_rate IS NOT NULL
      AND s.cap_rate_quality IS NULL  -- only previously-untagged
  ),
  banded AS (
    SELECT c.sale_id, c.cap_rate,
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
       AND b.cap_rate >= b.band_min AND b.cap_rate <= b.band_max
    RETURNING s.sale_id
  )
  SELECT COUNT(*) INTO v_ok FROM to_stated;

  RETURN QUERY SELECT v_impl, v_ok, now();
END;
$$;

COMMENT ON FUNCTION public.cap_rate_quality_tick IS
  'B5: continuous-propagation worker. Tags live sales cap_rate_quality based on cap_rate_bands lookup keyed on property building_type. Idempotent.';

-- ----------------------------------------------------------------------------
-- pg_cron schedule (nightly at 03:15 UTC)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_existing_jobid BIGINT;
BEGIN
  SELECT jobid INTO v_existing_jobid
  FROM cron.job WHERE jobname = 'lcc-dia-cap-rate-quality-tick';

  IF v_existing_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_existing_jobid);
  END IF;

  PERFORM cron.schedule(
    'lcc-dia-cap-rate-quality-tick',
    '15 3 * * *',
    $cron$SELECT public.cap_rate_quality_tick();$cron$
  );

  RAISE NOTICE '[B5] Scheduled lcc-dia-cap-rate-quality-tick (nightly 03:15 UTC)';
END $$;
