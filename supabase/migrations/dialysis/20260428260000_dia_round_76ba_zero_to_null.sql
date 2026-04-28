-- ============================================================================
-- Round 76ba — Dialysis: convert size/area = 0 to NULL + prevent recurrence
--
-- Audit found 4,479 of 11,015 dia properties (41%) with building_size = 0.00
-- (literally 0, not NULL) — placeholder zeros from CSV imports that cause
-- division-by-zero in price_per_sf / rent_per_sf calculations and skew
-- dashboard averages.
--
-- Convert all 0 → NULL on building_size, land_area, lot_sf,
-- parking_space_count + add BEFORE INSERT/UPDATE trigger so writers
-- can't reintroduce zeros.
-- ============================================================================

UPDATE public.properties SET building_size = NULL WHERE building_size = 0;
UPDATE public.properties SET land_area = NULL WHERE land_area = 0;
UPDATE public.properties SET lot_sf = NULL WHERE lot_sf = 0;
UPDATE public.properties SET parking_space_count = NULL WHERE parking_space_count = 0;

CREATE OR REPLACE FUNCTION public.dia_normalize_zero_building_size()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.building_size = 0 THEN NEW.building_size := NULL; END IF;
  IF NEW.land_area = 0 THEN NEW.land_area := NULL; END IF;
  IF NEW.lot_sf = 0 THEN NEW.lot_sf := NULL; END IF;
  IF NEW.parking_space_count = 0 THEN NEW.parking_space_count := NULL; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_dia_normalize_zero_building_size ON public.properties;
CREATE TRIGGER trg_dia_normalize_zero_building_size
  BEFORE INSERT OR UPDATE OF building_size, land_area, lot_sf, parking_space_count
  ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.dia_normalize_zero_building_size();
