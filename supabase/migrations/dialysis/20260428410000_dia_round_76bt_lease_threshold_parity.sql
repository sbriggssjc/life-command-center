-- ============================================================================
-- Round 76bt — Dia lease threshold parity with gov + remaining stragglers
--
-- Provenance state audit (LCC Opps):
--   - 22,622 total provenance records
--   - 1,225 conflicts (open same-priority disagreements)
--   - 2,108 skips (lower-priority overwrites blocked)
--   - 0 unranked fields (Phase 4 detector clean)
--   - 697 priority rules total, 54 in warn mode, 0 in strict
--
-- v_data_quality_summary state (dia):
--   duplicate_property_address: 1,061 → 90 (-971, 91% reduction)
--   multi_active_lease:         1,007 → 0
--   listing_after_sale:             9 → 0
--   lease_no_dates:               947 → 2
--   orphan_listing:               cleared
--
-- Dia lease audit found 5 stragglers the existing trigger doesn't catch
-- because it only normalizes annual_rent=0 / rent=0 / rent_per_sf=0, while
-- the gov trigger from Round 76bp also catches < 100 (parser errors with
-- rent values like $14, $9, $11) and > 200 PSF (impossibly high). Bring
-- dia to parity with gov:
--
--   lease 13019: rent_per_sf=$653/SF (leased_area=280 too small)
--   lease 15726: annual_rent=$14, no tenant — placeholder
--   lease 24045: rent=0, active, no tenant — placeholder
--   lease 17205: annual_rent=$323K (real), rent='11' (parser error,
--                rent_per_sf was written into rent column)
--   lease 10943: rent_per_sf=$443.7 (leased_area=2000 sf with $887K rent
--                is suspicious — NULL rent_per_sf, leave for review)
--
-- 2 leases with rent_per_sf > 200 will also be NULL'd by the trigger
-- forward.
-- ============================================================================

-- 1. Backfill stragglers (preserving annual_rent & rent_per_sf where one
--    is real)
UPDATE public.leases SET annual_rent = NULL
 WHERE annual_rent IS NOT NULL AND annual_rent < 100;

UPDATE public.leases SET rent = NULL
 WHERE rent IS NOT NULL AND rent < 100;

UPDATE public.leases SET rent_per_sf = NULL
 WHERE rent_per_sf > 200;

-- 2. Tighten the BEFORE INSERT/UPDATE normalize trigger
CREATE OR REPLACE FUNCTION public.dia_normalize_zero_lease_fields()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.leased_area IS NOT NULL AND NEW.leased_area < 100 THEN NEW.leased_area := NULL; END IF;
  IF NEW.sqft IS NOT NULL AND NEW.sqft < 100 THEN NEW.sqft := NULL; END IF;
  IF NEW.annual_rent = 0 OR (NEW.annual_rent IS NOT NULL AND NEW.annual_rent < 100) THEN
    NEW.annual_rent := NULL;
  END IF;
  IF NEW.rent = 0 OR (NEW.rent IS NOT NULL AND NEW.rent < 100) THEN
    NEW.rent := NULL;
  END IF;
  IF NEW.rent_per_sf = 0 OR NEW.rent_per_sf > 200 THEN NEW.rent_per_sf := NULL; END IF;
  RETURN NEW;
END $$;
