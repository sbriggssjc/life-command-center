-- ============================================================================
-- QA-22 (2026-05-18, dia): Canonicalize "Davita" / "DAVITA" → "DaVita".
--
-- QA pass #5 surfaced detail-panel headers reading "Davita Lakewood Community
-- Dialysis Center" instead of "DaVita …". properties.tenant had:
--   • 2,531 rows with "Davita" prefix (title-cased from upstream initcap)
--   • 115 rows with "DAVITA" (all-caps, e.g. county recorder dumps)
--   • 1,798 rows already canonical with "DaVita"
--
-- The brand is "DaVita" (NYSE: DVA). Affects ~30% of the dialysis book.
--
-- Helper: canonicalize_davita_brand(s) does a word-boundary regex replace
-- on any of [davita / DAVITA / Davita] → "DaVita".
--
-- Trigger fires BEFORE INSERT/UPDATE OF tenant so future ingests stay
-- canonical.
--
-- Already applied live on 2026-05-18 via Supabase MCP. Verified: 2,531
-- bad rows → 0 remaining; canonical "DaVita" prefix count went from
-- 1,798 → 4,329.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.canonicalize_davita_brand(s text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(coalesce(s, ''), '\m(davita|DAVITA|Davita)\M', 'DaVita', 'g');
$$;

COMMENT ON FUNCTION public.canonicalize_davita_brand(text) IS
  'QA-22: title-case "DaVita" inside any tenant string (Davita/DAVITA/davita → DaVita) using whole-word match. Paired with the BEFORE INSERT/UPDATE trigger on properties.tenant.';

UPDATE public.properties
SET tenant = public.canonicalize_davita_brand(tenant)
WHERE tenant ~ '\m(davita|DAVITA|Davita)\M'
  AND tenant IS DISTINCT FROM public.canonicalize_davita_brand(tenant);

CREATE OR REPLACE FUNCTION public.properties_tenant_brand_canonicalize_trg()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant IS NOT NULL THEN
    NEW.tenant := public.canonicalize_davita_brand(NEW.tenant);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS properties_tenant_brand_canonicalize_trg ON public.properties;
CREATE TRIGGER properties_tenant_brand_canonicalize_trg
  BEFORE INSERT OR UPDATE OF tenant ON public.properties
  FOR EACH ROW
  EXECUTE FUNCTION public.properties_tenant_brand_canonicalize_trg();
