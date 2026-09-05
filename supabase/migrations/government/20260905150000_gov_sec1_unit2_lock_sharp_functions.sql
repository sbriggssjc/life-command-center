-- ===========================================================================
-- SEC1-unit2 Unit 1 — lock the two sharp gov functions plus the two named
-- alongside them (applied live 2026-09-05 to scknotsqkcheojiaewwh).
--
-- gov_apply_om_confirmed_noi already carried a REVOKE ALL FROM PUBLIC / GRANT
-- service_role stanza (20260817120000), but the live grant still showed
-- anon/authenticated executable -- Supabase's ALTER DEFAULT PRIVILEGES
-- explicitly grants those two roles at CREATE time, and a PUBLIC-only revoke
-- never removes them (the two-grant mechanism in CLAUDE.md's canonical
-- SECURITY DEFINER section). Verified real callers before locking:
--   gov_apply_om_confirmed_noi -> api/_handlers/om-comp-resolver.js via
--     domainQuery('government', …) -- service_role key, confirmed in source.
--   gov_truncate_sam_public_staging / gov_match_sam_public_extract ->
--     government-lease/src/ingest_sam_public_extract.py via
--     supabase_local.get_client(), hard-coded to SUPABASE_SERVICE_ROLE_KEY
--     (raises RuntimeError rather than falling back to anon if unset).
--   gov_pse_propagate_to_sale returns trigger and is not PostgREST-callable
--     at all -- locked for tidiness per the SEC1-unit2 prompt, not urgency.
--
-- Behavioural re-probe (rolled back), post-revoke, all three RPC-callable
-- functions: gov_apply_om_confirmed_noi returned a correct dry-run decision;
-- gov_truncate_sam_public_staging returned {"ok":true,"cleared":0};
-- gov_match_sam_public_extract returned an honest domain error
-- ("staging is empty"), never a permission error.
--
-- Full writeup: docs/audits/SEC1_UNIT2_RESULTS_2026-09-05.md
-- ===========================================================================

REVOKE ALL ON FUNCTION public.gov_apply_om_confirmed_noi(bigint,numeric,date,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gov_apply_om_confirmed_noi(bigint,numeric,date,text,boolean) TO service_role;

REVOKE ALL ON FUNCTION public.gov_truncate_sam_public_staging() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gov_truncate_sam_public_staging() TO service_role;

REVOKE ALL ON FUNCTION public.gov_match_sam_public_extract(boolean,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gov_match_sam_public_extract(boolean,text) TO service_role;

REVOKE ALL ON FUNCTION public.gov_pse_propagate_to_sale() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gov_pse_propagate_to_sale() TO service_role;

DO $$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT unnest(ARRAY[
      'gov_apply_om_confirmed_noi(bigint,numeric,date,text,boolean)',
      'gov_truncate_sam_public_staging()',
      'gov_match_sam_public_extract(boolean,text)',
      'gov_pse_propagate_to_sale()'
    ]) AS sig
  LOOP
    IF has_function_privilege('anon', ('public.' || f.sig)::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon can still execute %', f.sig;
    END IF;
    IF has_function_privilege('authenticated', ('public.' || f.sig)::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated can still execute %', f.sig;
    END IF;
    IF NOT has_function_privilege('service_role', ('public.' || f.sig)::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'service_role lost execute on %', f.sig;
    END IF;
  END LOOP;
END $$;
