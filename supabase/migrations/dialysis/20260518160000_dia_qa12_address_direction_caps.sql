-- ============================================================================
-- QA-12 (2026-05-18, dia): Mirror of gov address direction-suffix fix.
-- See supabase/migrations/government/20260518160000_gov_qa12_address_direction_caps.sql
-- for the discovery writeup.
--
-- Affected: 450 dia properties (out of 15,194) at apply time.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.canonicalize_address_directions(addr text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(coalesce(addr, ''),
    '\m(Se|Sw|Ne|Nw)\M', UPPER('\1'),
    'g'
  );
$$;

UPDATE public.properties
SET address = public.canonicalize_address_directions(address)
WHERE address IS NOT NULL
  AND address ~ '\m(Se|Sw|Ne|Nw)\M'
  AND address IS DISTINCT FROM public.canonicalize_address_directions(address);

CREATE OR REPLACE FUNCTION public.properties_address_caps_trg()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.address IS NOT NULL THEN
    NEW.address := public.canonicalize_address_directions(NEW.address);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS properties_address_caps_trg ON public.properties;
CREATE TRIGGER properties_address_caps_trg
  BEFORE INSERT OR UPDATE OF address ON public.properties
  FOR EACH ROW
  EXECUTE FUNCTION public.properties_address_caps_trg();
