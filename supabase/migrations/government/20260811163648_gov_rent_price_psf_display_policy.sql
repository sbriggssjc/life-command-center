-- ============================================================================
-- Government CM display policy: Rent & Price / SF
-- 2026-08-11
--
-- The gov Rent & Price Per Square Foot chart reads cm_gov_rent_price_psf_q.
-- Live audit found sparse, discontinuous pre-1997 history:
--   * isolated rows in 1970, 1979, 1988, and 1990-1996
--   * 1990-1996 has no rent/SF TTM observations
--   * price/SF is based on only 3-4 TTM sale observations in the jumpy years
--
-- First sustained robust period under the continuity gate is 1997-06-30:
-- both rent_psf and price_psf populated, with n_with_rent_ttm and
-- n_with_price_ttm each >= 4 for 8 consecutive quarters. The stronger
-- sample-density standard begins around 2003, but 1997-06 is the source-level
-- minimum display policy so the report preserves useful late-1990s history
-- while suppressing the unreliable pre-1997 region.
--
-- Legacy pre-1997 rent-at-sale history is NOT imported here. If a curated
-- legacy master is later approved, import it as a separate provenance-tagged
-- source and re-evaluate the display floor after density/continuity QA.
-- ============================================================================

ALTER TABLE cm_view_registry
  ADD COLUMN IF NOT EXISTS min_n_threshold     integer,
  ADD COLUMN IF NOT EXISTS consecutive_periods integer NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS n_column            text,
  ADD COLUMN IF NOT EXISTS n_source_view       text,
  ADD COLUMN IF NOT EXISTS display_from        date;

COMMENT ON COLUMN cm_view_registry.min_n_threshold IS
  'Sample-size floor for the display-start policy: the series is robust once its density column >= this value for consecutive_periods consecutive periods. NULL disables automatic cropping.';
COMMENT ON COLUMN cm_view_registry.n_column IS
  'Name of the sample-size column used to evaluate min_n_threshold. NULL preserves a curated display_from value.';
COMMENT ON COLUMN cm_view_registry.n_source_view IS
  'Optional view to read the density column from when the registered series borrows a cohort count. Defaults to view_name.';
COMMENT ON COLUMN cm_view_registry.display_from IS
  'Source-level display-start date. The CM exporter drops period_end rows earlier than this.';

CREATE OR REPLACE FUNCTION cm_compute_display_from(
  p_view         text,
  p_n_column     text,
  p_subspecialty text DEFAULT 'all',
  p_threshold    integer DEFAULT 25,
  p_consecutive  integer DEFAULT 4
) RETURNS date
LANGUAGE plpgsql STABLE AS $fn$
DECLARE
  v_sql text;
  v_rec record;
  v_run integer := 0;
  v_start date := NULL;
  v_has_sub boolean;
BEGIN
  IF p_view IS NULL OR p_n_column IS NULL OR p_threshold IS NULL THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = p_view
      AND column_name = p_n_column
  ) THEN
    RETURN NULL;
  END IF;

  v_has_sub := EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = p_view
      AND column_name = 'subspecialty'
  );

  v_sql := format(
    'SELECT period_end::date AS pe, (%I)::numeric AS n FROM %I %s ORDER BY period_end',
    p_n_column,
    p_view,
    CASE WHEN v_has_sub THEN format('WHERE subspecialty = %L', p_subspecialty) ELSE '' END
  );

  FOR v_rec IN EXECUTE v_sql LOOP
    IF v_rec.n IS NOT NULL AND v_rec.n >= p_threshold THEN
      IF v_run = 0 THEN
        v_start := v_rec.pe;
      END IF;
      v_run := v_run + 1;
      IF v_run >= p_consecutive THEN
        RETURN v_start;
      END IF;
    ELSE
      v_run := 0;
      v_start := NULL;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$fn$;

CREATE OR REPLACE FUNCTION cm_refresh_display_from()
RETURNS integer
LANGUAGE plpgsql AS $fn$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT ctid,
           COALESCE(n_source_view, view_name) AS src_view,
           n_column,
           COALESCE(subspecialty, 'all') AS sub,
           min_n_threshold,
           consecutive_periods
    FROM cm_view_registry
    WHERE min_n_threshold IS NOT NULL
      AND n_column IS NOT NULL
      AND COALESCE(n_source_view, view_name) IS NOT NULL
  LOOP
    UPDATE cm_view_registry
       SET display_from = cm_compute_display_from(
         r.src_view,
         r.n_column,
         r.sub,
         r.min_n_threshold,
         r.consecutive_periods
       )
     WHERE ctid = r.ctid;
    n := n + 1;
  END LOOP;

  RETURN n;
END;
$fn$;

INSERT INTO cm_view_registry
  (view_name, chart_template_id, vertical, subspecialty, data_shape,
   refresh_strategy, is_active, min_n_threshold, consecutive_periods,
   n_column, n_source_view, display_from, notes)
VALUES
  (
    'cm_gov_rent_price_psf_q',
    'rent_and_price_psf',
    'gov',
    'all',
    'time_series_quarterly',
    'live',
    true,
    NULL,
    8,
    NULL,
    NULL,
    DATE '1997-06-30',
    'Curated display_from for gov Rent & Price / SF. First sustained robust period is 1997-06-30 (both rent and price populated, n_with_rent_ttm/n_with_price_ttm >= 4 for 8 q). 2003+ is the stronger density standard. Do not import legacy pre-1997 rent-at-sale into this live source without separate provenance and QA.'
  )
ON CONFLICT (view_name) DO UPDATE SET
  chart_template_id   = EXCLUDED.chart_template_id,
  vertical            = EXCLUDED.vertical,
  subspecialty        = EXCLUDED.subspecialty,
  data_shape          = EXCLUDED.data_shape,
  refresh_strategy    = EXCLUDED.refresh_strategy,
  is_active           = EXCLUDED.is_active,
  min_n_threshold     = EXCLUDED.min_n_threshold,
  consecutive_periods = EXCLUDED.consecutive_periods,
  n_column            = EXCLUDED.n_column,
  n_source_view       = EXCLUDED.n_source_view,
  display_from        = EXCLUDED.display_from,
  notes               = EXCLUDED.notes;
