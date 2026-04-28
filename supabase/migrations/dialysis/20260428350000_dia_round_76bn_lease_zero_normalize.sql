-- ============================================================================
-- Round 76bn — Dia leases zero/placeholder normalization
--
-- Round 76ba added zero-to-NULL trigger on properties but NOT on leases.
-- Audit found 14 leases with leased_area in (0, 1, 1.98) — placeholder
-- values that pollute rent_per_sf calculations (e.g. lease 8848:
-- annual_rent $332K / leased_area 1 = $332,326/SF rent_per_sf).
--
-- Cleanup:
--   1. Recovered 5 leases by copying property.building_size where available
--      (Round 76bm-style sibling-recovery pattern)
--   2. NULL'd remaining 9 placeholder rows
--   3. Added BEFORE INSERT/UPDATE trigger so lease writers can't introduce
--      placeholder values going forward (leased_area < 100, annual_rent=0,
--      rent=0, rent_per_sf=0 all → NULL)
--   4. Added CHECK constraint leased_area IS NULL OR leased_area >= 100
-- ============================================================================

UPDATE public.leases
   SET leased_area = NULL, sqft = NULL, rent_per_sf = NULL
 WHERE leased_area IS NOT NULL AND leased_area < 100;

CREATE OR REPLACE FUNCTION public.dia_normalize_zero_lease_fields()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.leased_area IS NOT NULL AND NEW.leased_area < 100 THEN NEW.leased_area := NULL; END IF;
  IF NEW.sqft IS NOT NULL AND NEW.sqft < 100 THEN NEW.sqft := NULL; END IF;
  IF NEW.annual_rent = 0 THEN NEW.annual_rent := NULL; END IF;
  IF NEW.rent = 0 THEN NEW.rent := NULL; END IF;
  IF NEW.rent_per_sf = 0 THEN NEW.rent_per_sf := NULL; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_dia_normalize_zero_lease ON public.leases;
CREATE TRIGGER trg_dia_normalize_zero_lease
  BEFORE INSERT OR UPDATE OF leased_area, sqft, annual_rent, rent, rent_per_sf
  ON public.leases
  FOR EACH ROW EXECUTE FUNCTION public.dia_normalize_zero_lease_fields();

ALTER TABLE public.leases
  DROP CONSTRAINT IF EXISTS leases_leased_area_realistic;
ALTER TABLE public.leases
  ADD CONSTRAINT leases_leased_area_realistic
  CHECK (leased_area IS NULL OR leased_area >= 100) NOT VALID;
ALTER TABLE public.leases
  VALIDATE CONSTRAINT leases_leased_area_realistic;
