-- ============================================================================
-- 20260523120020_gov_cap_rate_bands.sql
-- OWNERSHIP_AND_SALES_REMEDIATION_PLAN — Foundation for Decision #3 (gov)
--
-- Mirror of dia cap_rate_bands. Gov metrics layer is the single biggest
-- consumer (DQ-1 found 458 gov rows >10% feeding metrics) so this table
-- is what unblocks the cap-rate quality gate (G6).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.cap_rate_bands (
  band_id          BIGSERIAL PRIMARY KEY,
  asset_class      TEXT NOT NULL,
  min_pct          NUMERIC(5,4) NOT NULL CHECK (min_pct >= 0 AND min_pct <= 1),
  max_pct          NUMERIC(5,4) NOT NULL CHECK (max_pct >= 0 AND max_pct <= 1),
  effective_from   DATE NOT NULL DEFAULT '2000-01-01',
  effective_until  DATE,
  source           TEXT NOT NULL DEFAULT 'remediation_plan_2026-05-23',
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (max_pct > min_pct),
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_cap_rate_bands_active
  ON public.cap_rate_bands (asset_class)
  WHERE effective_until IS NULL;

CREATE INDEX IF NOT EXISTS idx_cap_rate_bands_class_date
  ON public.cap_rate_bands (asset_class, effective_from DESC);

ALTER TABLE public.cap_rate_bands ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cap_rate_bands_service_role_all ON public.cap_rate_bands;
CREATE POLICY cap_rate_bands_service_role_all ON public.cap_rate_bands
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS cap_rate_bands_authenticated_read ON public.cap_rate_bands;
CREATE POLICY cap_rate_bands_authenticated_read ON public.cap_rate_bands
  FOR SELECT TO authenticated USING (true);

COMMENT ON TABLE public.cap_rate_bands IS
  'Per-asset-class cap rate plausibility bands (gov). Decision #3 of REMEDIATION_PLAN. B5/A5 read from this table.';

INSERT INTO public.cap_rate_bands (asset_class, min_pct, max_pct, notes)
SELECT * FROM (VALUES
  ('medical_office',     0.050::NUMERIC, 0.080::NUMERIC, 'Decision #3 seed: medical office 5-8%'),
  ('dialysis',           0.055::NUMERIC, 0.080::NUMERIC, 'Decision #3 seed: dialysis 5.5-8%'),
  ('industrial',         0.050::NUMERIC, 0.090::NUMERIC, 'Decision #3 seed: industrial 5-9%'),
  ('retail',             0.060::NUMERIC, 0.100::NUMERIC, 'Decision #3 seed: retail 6-10%'),
  ('office',             0.060::NUMERIC, 0.100::NUMERIC, 'Decision #3 seed: office 6-10%'),
  ('government_leased',  0.050::NUMERIC, 0.080::NUMERIC, 'Decision #3 seed: gov-leased 5-8%'),
  ('default',            0.030::NUMERIC, 0.100::NUMERIC, 'Decision #3 seed: wide fallback when asset_class is unknown')
) AS v(asset_class, min_pct, max_pct, notes)
WHERE NOT EXISTS (
  SELECT 1 FROM public.cap_rate_bands b
  WHERE b.asset_class = v.asset_class AND b.effective_until IS NULL
);

CREATE OR REPLACE FUNCTION public.cap_rate_band_for(
  p_asset_class TEXT,
  p_as_of       DATE DEFAULT CURRENT_DATE
) RETURNS TABLE (min_pct NUMERIC, max_pct NUMERIC, source_class TEXT)
LANGUAGE sql STABLE
AS $$
  WITH match AS (
    SELECT min_pct, max_pct, asset_class
    FROM public.cap_rate_bands
    WHERE asset_class = COALESCE(p_asset_class, 'default')
      AND effective_from <= p_as_of
      AND (effective_until IS NULL OR effective_until > p_as_of)
    ORDER BY effective_from DESC
    LIMIT 1
  ),
  fallback AS (
    SELECT min_pct, max_pct, asset_class
    FROM public.cap_rate_bands
    WHERE asset_class = 'default'
      AND effective_from <= p_as_of
      AND (effective_until IS NULL OR effective_until > p_as_of)
    ORDER BY effective_from DESC
    LIMIT 1
  )
  SELECT min_pct, max_pct, asset_class FROM match
  UNION ALL
  SELECT min_pct, max_pct, asset_class FROM fallback
  WHERE NOT EXISTS (SELECT 1 FROM match)
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.cap_rate_band_for IS
  'Returns (min_pct, max_pct, source_class) for the given asset_class as of a date. Falls back to default when no class-specific band exists.';
