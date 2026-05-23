-- ============================================================================
-- 20260523120020_dia_cap_rate_bands.sql
-- OWNERSHIP_AND_SALES_REMEDIATION_PLAN — Foundation for Decision #3 (dia)
--
-- Per-asset-class cap rate plausibility bands. B5 cap-rate-quality-tick and
-- A5 retroactive tagging both read from this table so bands can be tuned
-- without code changes.
--
-- Bands are stored as fractional values (0.05 = 5%) to match the existing
-- chk_cap_rate_range constraint on sales_transactions (cap_rate is fractional,
-- 0.005-0.30). Each row is dated; the active band for a class on a given
-- sale_date is the row where effective_from <= sale_date < effective_until
-- (NULL effective_until = current).
--
-- Seed values per Decision #3:
--   medical office     5.0 - 8.0 %
--   dialysis           5.5 - 8.0 %
--   industrial         5.0 - 9.0 %
--   retail             6.0 - 10.0 %
--   office             6.0 - 10.0 %
--   government_leased  5.0 - 8.0 %
--   default (unknown)  3.0 - 10.0 %   (wide fallback when asset_class is null)
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
  'Per-asset-class cap rate plausibility bands. Decision #3 of REMEDIATION_PLAN. B5/A5 read from this table.';

-- Seed defaults (idempotent — only insert if no active band exists for the class).
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

-- Convenience lookup function. Returns the active band for a class.
-- Falls back to 'default' when the class has no active band.
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
  'Returns (min_pct, max_pct, source_class) for the given asset_class as of a date. Falls back to the default band when no class-specific band is active.';
