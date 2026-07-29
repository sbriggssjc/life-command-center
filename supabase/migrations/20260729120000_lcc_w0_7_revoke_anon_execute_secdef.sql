-- 20260729120000_lcc_w0_7_revoke_anon_execute_secdef.sql
-- W0.7 — Revoke anon EXECUTE on SECURITY DEFINER functions (LCC Opps), fold in
--        function_search_path_mutable. Keep authenticated + service_role unchanged.
--
-- Front-end anon-RPC audit (2026-07-29, ROLLOUT_STATUS W0.7): grepped every served
--   front-end file (app.js, detail.js, dialysis.js, gov.js, ops.js, contacts-ui.js,
--   auth.js, capital-markets.js, marketing.js, treasury.js, diag.js, review-shared.js)
--   for supabase.rpc()/`rest/v1/rpc`/`table=rpc/` calls.
--   * The browser NEVER calls an LCC Opps public RPC as anon. auth.js's anon-key
--     supabase client is auth-only (no .rpc()/.from()); every LCC RPC the SPA triggers
--     goes through server-side handlers (api/admin.js opsQuery, /api/data-query) that
--     use the SERVICE_ROLE key. dia/gov RPCs go through /api/dia-query & /api/gov-query
--     which also use service_role ("Prefer service_role over anon — issue #720").
--   => EXCEPTION LIST FOR LCC OPPS: (none).
--
-- Grounding note: because the browser reaches these functions only via service_role
--   proxies, revoking anon here is pure hardening — it does not change any current
--   browser behavior. authenticated retains execute (the W0.V advisor's
--   authenticated-execute WARN is deliberately left for authenticated per Scott).
--
-- Effective revoke: each targeted function currently grants EXECUTE to anon explicitly
--   AND to PUBLIC (proacl `...,anon=X/postgres,...,=X/postgres`). anon rides the PUBLIC
--   grant too, so removing only the explicit anon grant is cosmetic. This migration
--   therefore, for each targeted fn that currently has a PUBLIC EXECUTE:
--     (1) GRANTs EXECUTE to authenticated + service_role  (preserve their access — some
--         reach the fn only via PUBLIC), then
--     (2) REVOKEs EXECUTE FROM PUBLIC,
--   and in all cases REVOKEs EXECUTE FROM anon. Functions with no PUBLIC grant only have
--   the anon grant removed (authenticated/service_role untouched — never widened). This
--   keeps authenticated's *capability* identical while actually blocking anon.
-- Folds in function_search_path_mutable: sets `search_path = public` only on targeted
--   functions that currently have NO search_path in proconfig (never clobbers an explicit
--   multi-schema search_path such as `public, extensions`).
-- Scope: public schema, SECURITY DEFINER only. SECURITY INVOKER fns are untouched.
-- Idempotent / re-runnable. Reversible by re-granting anon/PUBLIC per function if needed.

DO $$
DECLARE
  -- W0.7 EXCEPTION LIST (browser-invoked RPCs kept anon-executable): (none for LCC Opps)
  v_exceptions text[] := ARRAY[]::text[];
  r record;
  v_locked int := 0;
  v_sp int := 0;
BEGIN
  FOR r IN
    SELECT format('public.%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid)) AS sig,
           ((p.proacl IS NULL) OR COALESCE((SELECT bool_or(a.grantee = 0 AND a.privilege_type = 'EXECUTE')
              FROM aclexplode(p.proacl) a), false)) AS has_public,
           NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%') AS missing_sp
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.proname <> ALL (v_exceptions)
  LOOP
    IF r.has_public THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', r.sig);
    END IF;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', r.sig);
    v_locked := v_locked + 1;
    IF r.missing_sp THEN
      EXECUTE format('ALTER FUNCTION %s SET search_path = public', r.sig);
      v_sp := v_sp + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'W0.7 [%]: locked % SECURITY DEFINER fn(s) from anon; set search_path=public on %',
    current_database(), v_locked, v_sp;
END $$;
