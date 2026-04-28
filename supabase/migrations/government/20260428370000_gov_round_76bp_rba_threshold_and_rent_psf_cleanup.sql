-- ============================================================================
-- Round 76bp (gov) — RBA threshold tightening + rent_psf garbage cleanup
--
-- Same audit pattern as dia 76bo + 76bn: 33 gov leases had rent_psf > $200
-- (impossible) because property.rba was tiny (e.g. rba=15 sf) and the
-- per-SF calculation produced absurdly large values.
--
-- Cleanup:
--   1. NULL rent_psf > 200 (33 rows)
--   2. NULL rba < 100 sf (placeholder values like rba=15)
--   3. Tighten gov_normalize_zero_size_rent trigger to enforce both
--      thresholds going forward.
--
-- Gov sales over $100M are kept unchanged — they're likely real federal
-- portfolio sales (e.g. $436M government office tower trades). No
-- trustworthy way to distinguish from data errors at that scale.
--
-- 1 gov sale under $50K (rare edge case) is left for human review.
-- ============================================================================

UPDATE public.leases SET rent_psf = NULL WHERE rent_psf > 200;

UPDATE public.properties SET rba = NULL WHERE rba > 0 AND rba < 100;

CREATE OR REPLACE FUNCTION public.gov_normalize_zero_size_rent()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'properties' THEN
    IF NEW.rba IS NOT NULL AND NEW.rba < 100 THEN NEW.rba := NULL; END IF;
    IF NEW.land_acres IS NOT NULL AND NEW.land_acres < 0.01 THEN NEW.land_acres := NULL; END IF;
  ELSIF TG_TABLE_NAME = 'leases' THEN
    IF NEW.annual_rent = 0 OR (NEW.annual_rent IS NOT NULL AND NEW.annual_rent < 100) THEN
      NEW.annual_rent := NULL;
    END IF;
    IF NEW.rent_psf > 200 OR NEW.rent_psf = 0 THEN NEW.rent_psf := NULL; END IF;
  END IF;
  RETURN NEW;
END $$;
