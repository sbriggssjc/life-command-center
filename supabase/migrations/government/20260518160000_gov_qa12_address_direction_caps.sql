-- ============================================================================
-- QA-12 (2026-05-18, gov): Title-case → ALL-CAPS for USPS direction suffixes.
--
-- 2026-05-18 QA pass surfaced "1200 New Jersey Ave Se" on the detail panel
-- header for property_id 3198. USPS direction suffixes are traditionally
-- rendered in all-caps (SE, SW, NE, NW) — the title-cased forms ("Se", "Nw")
-- look unprofessional in a broker-facing tool.
--
-- One-shot backfill + BEFORE INSERT/UPDATE trigger keeps it canonical.
--
-- Affected: 710 gov properties (out of 17,435) at apply time.
--
-- Already applied live to gov (scknotsqkcheojiaewwh) on 2026-05-18 via
-- Supabase MCP. This file commits the migration to the repo as the
-- historical record.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.canonicalize_address_directions(addr text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(coalesce(addr, ''),
    '\m(Se|Sw|Ne|Nw)\M', UPPER('\1'),
    'g'
  );
$$;

COMMENT ON FUNCTION public.canonicalize_address_directions(text) IS
  'QA-12: upper-case USPS direction suffixes (Se→SE, Sw→SW, Ne→NE, Nw→NW). Match is case-sensitive on the whole word so plain English text containing those bigrams is not affected.';

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
