-- ============================================================================
-- Round 76bj — Dialysis address / city / state capitalization normalization
--
-- Scott noted inconsistent caps everywhere: "ANCHORAGE" vs "Anchorage",
-- "1809 Avenue H" vs "1809 AVENUE H". Apply title-case to addresses +
-- cities, upper-case to state. BEFORE INSERT/UPDATE trigger keeps it
-- consistent going forward.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.dia_normalize_address_caps(p_input text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  WITH s AS (SELECT trim(coalesce(p_input, '')) AS x)
  SELECT CASE
    WHEN x = '' THEN NULL
    WHEN x ~ '[a-z]' AND x ~ '[A-Z]' AND length(x) > 4 THEN x
    ELSE regexp_replace(
      regexp_replace(initcap(lower(x)), '\m(Nw|Ne|Sw|Se|N|S|E|W)\M', UPPER('\1'), 'g'),
      '\m(Llc|Llp|Lp|Inc|Cir)\M', UPPER('\1'), 'g'
    )
  END FROM s;
$$;

CREATE OR REPLACE FUNCTION public.dia_normalize_city_state()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.address IS NOT NULL THEN NEW.address := dia_normalize_address_caps(NEW.address); END IF;
  IF NEW.city IS NOT NULL THEN NEW.city := initcap(lower(trim(NEW.city))); END IF;
  IF NEW.state IS NOT NULL THEN NEW.state := upper(trim(NEW.state)); END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_dia_normalize_addr_caps ON public.properties;
CREATE TRIGGER trg_dia_normalize_addr_caps
  BEFORE INSERT OR UPDATE OF address, city, state
  ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.dia_normalize_city_state();

UPDATE public.properties SET
  address = dia_normalize_address_caps(address),
  city = CASE WHEN city IS NOT NULL THEN initcap(lower(trim(city))) ELSE NULL END,
  state = upper(trim(state))
WHERE address IS NOT NULL OR city IS NOT NULL OR state IS NOT NULL;
