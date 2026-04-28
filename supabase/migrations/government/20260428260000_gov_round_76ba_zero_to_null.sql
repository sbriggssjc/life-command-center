-- ============================================================================
-- Round 76ba — Gov: same zero→NULL normalization pattern
-- 7 rba=0, 16 land_acres=0, 9 lease.annual_rent=0
-- ============================================================================

UPDATE public.properties SET rba = NULL WHERE rba = 0;
UPDATE public.properties SET land_acres = NULL WHERE land_acres = 0;
UPDATE public.leases SET annual_rent = NULL WHERE annual_rent = 0;

CREATE OR REPLACE FUNCTION public.gov_normalize_zero_size_rent()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'properties' THEN
    IF NEW.rba = 0 THEN NEW.rba := NULL; END IF;
    IF NEW.land_acres = 0 THEN NEW.land_acres := NULL; END IF;
  ELSIF TG_TABLE_NAME = 'leases' THEN
    IF NEW.annual_rent = 0 THEN NEW.annual_rent := NULL; END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_gov_normalize_zero ON public.properties;
CREATE TRIGGER trg_gov_normalize_zero
  BEFORE INSERT OR UPDATE OF rba, land_acres ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.gov_normalize_zero_size_rent();

DROP TRIGGER IF EXISTS trg_gov_normalize_zero_lease ON public.leases;
CREATE TRIGGER trg_gov_normalize_zero_lease
  BEFORE INSERT OR UPDATE OF annual_rent ON public.leases
  FOR EACH ROW EXECUTE FUNCTION public.gov_normalize_zero_size_rent();
