-- ============================================================================
-- CM Export Audit item 7 — per-series display_from policy (Dialysis DB)
-- 2026-08-07
--
-- Sparse early history (2001-start sale series with 2-8 TTM deals through 2004;
-- pre-2017 listing under-capture) plots as noise on every chart's left edge.
-- Rather than hand-crop each chart's x-axis, store a computed `display_from`
-- per registered series = the first period_end where the series' sample-size
-- column clears a threshold for N consecutive periods. The exporter emits only
-- rows >= display_from, so charts inherit clean axes and the rule self-extends
-- as history accretes. Additive + reversible (DROP COLUMN / DROP FUNCTION).
--
-- Density-column sharing: the front-page TTM sale series (cap avg, cap
-- quartile, volume, avg deal, YoY, NM-vs-market) do not each carry a count
-- column, but they all read the SAME TTM sale cohort as cm_dialysis_count_ttm_q
-- (ttm_count). So a series may borrow another view's density via `n_source_view`
-- — one computed display_from then governs the whole co-dated cohort.
-- ============================================================================

ALTER TABLE cm_view_registry
  ADD COLUMN IF NOT EXISTS min_n_threshold     integer,
  ADD COLUMN IF NOT EXISTS consecutive_periods integer NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS n_column            text,
  ADD COLUMN IF NOT EXISTS n_source_view       text,
  ADD COLUMN IF NOT EXISTS display_from        date;

COMMENT ON COLUMN cm_view_registry.min_n_threshold IS
  'Sample-size floor for the display-start policy: the series is robust once its density column >= this value for consecutive_periods consecutive periods. NULL disables cropping (whole history exported).';
COMMENT ON COLUMN cm_view_registry.n_column IS
  'Name of the sample-size column used to evaluate min_n_threshold (e.g. ttm_count, n_leases). NULL disables cropping.';
COMMENT ON COLUMN cm_view_registry.n_source_view IS
  'Optional view to read the density column from when the series has no count of its own but shares a cohort (e.g. cap/volume/avg-deal series borrow cm_dialysis_count_ttm_q). Defaults to view_name.';
COMMENT ON COLUMN cm_view_registry.display_from IS
  'Computed by cm_refresh_display_from(): first period_end where the series clears its density floor. The CM exporter drops rows earlier than this.';

-- Compute the display-start for one series. Reads the view dynamically, orders
-- by period_end, and returns the first period_end that begins a run of
-- p_consecutive periods each with n_column >= p_threshold. NULL if never met
-- (caller then exports the whole history). Guards against schema drift by only
-- evaluating identifiers that actually exist.
CREATE OR REPLACE FUNCTION cm_compute_display_from(
  p_view         text,
  p_n_column     text,
  p_subspecialty text DEFAULT 'all',
  p_threshold    integer DEFAULT 25,
  p_consecutive  integer DEFAULT 4
) RETURNS date
LANGUAGE plpgsql STABLE AS $fn$
DECLARE
  v_sql text; v_rec record; v_run integer := 0; v_start date := NULL; v_has_sub boolean;
BEGIN
  IF p_view IS NULL OR p_n_column IS NULL OR p_threshold IS NULL THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = p_view AND column_name = p_n_column) THEN
    RETURN NULL;
  END IF;
  v_has_sub := EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = p_view AND column_name = 'subspecialty');
  v_sql := format(
    'SELECT period_end::date AS pe, (%I)::numeric AS n FROM %I %s ORDER BY period_end',
    p_n_column, p_view,
    CASE WHEN v_has_sub THEN format('WHERE subspecialty = %L', p_subspecialty) ELSE '' END);
  FOR v_rec IN EXECUTE v_sql LOOP
    IF v_rec.n IS NOT NULL AND v_rec.n >= p_threshold THEN
      IF v_run = 0 THEN v_start := v_rec.pe; END IF;
      v_run := v_run + 1;
      IF v_run >= p_consecutive THEN RETURN v_start; END IF;
    ELSE
      v_run := 0; v_start := NULL;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$fn$;

-- Recompute display_from for every registered series that carries a threshold.
CREATE OR REPLACE FUNCTION cm_refresh_display_from()
RETURNS integer
LANGUAGE plpgsql AS $fn$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN
    SELECT ctid, COALESCE(n_source_view, view_name) AS src_view, n_column,
           COALESCE(subspecialty,'all') AS sub, min_n_threshold, consecutive_periods
    FROM cm_view_registry
    WHERE min_n_threshold IS NOT NULL AND n_column IS NOT NULL
      AND COALESCE(n_source_view, view_name) IS NOT NULL
  LOOP
    UPDATE cm_view_registry
       SET display_from = cm_compute_display_from(r.src_view, r.n_column, r.sub, r.min_n_threshold, r.consecutive_periods)
     WHERE ctid = r.ctid;
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$fn$;

-- ----------------------------------------------------------------------------
-- Seed the 2001-start sale series (audit Part D). All share the TTM sale
-- cohort, so all borrow cm_dialysis_count_ttm_q.ttm_count with a TTM-count
-- floor of 25. Idempotent (plain UPDATE keyed by chart_template_id).
-- transaction_count_ttm reads its own view (which IS the count view).
-- ----------------------------------------------------------------------------
UPDATE cm_view_registry
   SET min_n_threshold = 25, consecutive_periods = 4,
       n_column = 'ttm_count', n_source_view = 'cm_dialysis_count_ttm_q'
 WHERE vertical = 'dialysis'
   AND chart_template_id IN (
     'cap_rate_ttm_by_quarter', 'cap_rate_top_bottom_quartile', 'volume_ttm_by_quarter',
     'avg_deal_size', 'yoy_volume_change', 'nm_vs_market_cap');

UPDATE cm_view_registry
   SET min_n_threshold = 25, consecutive_periods = 4, n_column = 'ttm_count', n_source_view = NULL
 WHERE vertical = 'dialysis' AND chart_template_id = 'transaction_count_ttm';

SELECT cm_refresh_display_from();
