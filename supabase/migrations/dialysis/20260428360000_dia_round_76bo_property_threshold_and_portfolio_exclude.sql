-- ============================================================================
-- Round 76bo — Property building_size <100 cleanup + portfolio-sale excludes
--
-- Audit found 6 sales with price/SF > $5,000 — impossible for any real
-- dialysis CRE deal:
--   sale 6904: \$42M / 6,800 SF Marietta GA = \$6,191/SF
--   sale 6749: \$39M / 6,427 SF Burlingame CA = \$6,099/SF
--   sale 149:  \$11M / 2,117 SF Pasadena CA  = \$5,470/SF
--   sale 8231: \$52M / 9,630 SF Twin Falls ID = \$5,420/SF
--   sale 570:  \$18M / 3,550 SF Zephyrhills FL = \$5,282/SF
--   sale 1152: \$4.3M / building_size=1 SF West Plains MO = \$4.3M/SF
--
-- The first 5 are portfolio-style sales where the entire portfolio price
-- got recorded against one property. The last one was a stale
-- building_size=1 placeholder Round 76ba's zero-to-NULL trigger missed
-- (it converted 0 but kept 1).
--
-- Cleanup:
--   1. Tighten the dia_normalize_zero_building_size trigger threshold from
--      = 0 to < 100 (any value below 100 sf is implausible, almost always
--      placeholder data). Same for land_area < 0.01 acres, lot_sf < 100.
--      Backfill: NULL all properties.building_size < 100.
--   2. Mark the 5 portfolio-style sales as exclude_from_market_metrics=TRUE
--      so they don't pollute v_sales_comps cap-rate / price-psf medians.
-- ============================================================================

UPDATE public.properties SET building_size = NULL WHERE building_size > 0 AND building_size < 100;

CREATE OR REPLACE FUNCTION public.dia_normalize_zero_building_size()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.building_size IS NOT NULL AND NEW.building_size < 100 THEN NEW.building_size := NULL; END IF;
  IF NEW.land_area IS NOT NULL AND NEW.land_area < 0.01 THEN NEW.land_area := NULL; END IF;
  IF NEW.lot_sf IS NOT NULL AND NEW.lot_sf < 100 THEN NEW.lot_sf := NULL; END IF;
  IF NEW.parking_space_count = 0 THEN NEW.parking_space_count := NULL; END IF;
  RETURN NEW;
END $$;

UPDATE public.sales_transactions
   SET exclude_from_market_metrics = TRUE
 WHERE sale_id IN (6904, 6749, 149, 8231, 570);

REFRESH MATERIALIZED VIEW public.v_sales_comps;
