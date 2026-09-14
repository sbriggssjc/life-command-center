-- B6a-follow-up (2026-08-28) — restore the anon EXECUTE grant R56 gave dia's
-- compute_feed_freshness(). APPLIED TO Dialysis_DB (zqzrriwuavgrquhisnoa).
--
-- WHY. LCC's cross-DB freshness mirror pulls each domain's public.v_feed_freshness
-- as ANON over PostgREST. dia's leg has answered
--
--   HTTP 401 {"code":"42501","message":"permission denied for function compute_feed_freshness"}
--
-- since 2026-07-29, and LCC's finalize consumed only status_code = 200 and dropped
-- everything else in silence, so the mirror froze and dia's 5 feeds stopped being
-- checked entirely. Measured 2026-08-28, dia's ACL on that function is
--   {postgres=X/postgres, service_role=X/postgres}
-- against gov's {authenticated, anon, service_role}. anon lost EXECUTE; the R56
-- migration granted it. This restores the intended contract, nothing more.
--
-- (!) THIS IS THE ONLY DOMAIN-SIDE CHANGE IN B6a-follow-up, AND IT IS NOT gov.
-- gov's leg fails for a completely different reason -- a marginal COLD-CACHE
-- statement timeout (HTTP 500 / 57014) against anon's 3s budget -- and gov is
-- deliberately NOT touched (brief 2c). gov is mitigated LCC-side by the bounded
-- retry cycle; its durable fix is filed as B6a-follow-up-b.
--
-- SAFETY. compute_feed_freshness() returns ONLY (feed_name, domain, src_table,
-- ts_column, latest, age_days, expected_max_age_days, is_stale, status) -- table
-- NAMES and max(timestamp), never a data row. That is the same non-PII shape the
-- other anon-readable portfolio views expose, and it is what R56 designed for.
-- The registry that drives it keeps its own grants; this touches EXECUTE only.
--
-- (!) AND THE GRANT CANNOT SHIP ALONE. The function is SECURITY DEFINER, so anon
-- EXECUTE means anon gets max() of whatever the REGISTRY points at. Measured here
-- 2026-08-28, dia's registry ACL is
--   {postgres=arwdDxt, anon=arwdDxt, authenticated=arwdDxt, service_role=arwdDxt}
-- -- anon can INSERT/UPDATE/DELETE/TRUNCATE the config of a SECURITY DEFINER
-- function. Any anon caller could repoint a feed at an arbitrary table/column and
-- read max() of it, or delete the registry and silently disable every freshness
-- alert. That is exactly the hole B6a closed on gov, still open on dia; restoring
-- EXECUTE without closing it would REOPEN it. Both halves ship together, or
-- neither. SELECT is retained -- the LCC cross-DB pull reads the registry as anon.
--
-- REVERSAL:
--   REVOKE EXECUTE ON FUNCTION public.compute_feed_freshness() FROM anon, authenticated;
--   GRANT INSERT, UPDATE, DELETE, TRUNCATE ON public.feed_freshness_registry TO anon, authenticated;

BEGIN;

GRANT EXECUTE ON FUNCTION public.compute_feed_freshness() TO anon, authenticated, service_role;
GRANT SELECT  ON public.v_feed_freshness                  TO anon, authenticated, service_role;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.feed_freshness_registry FROM anon, authenticated;
GRANT  SELECT                            ON public.feed_freshness_registry TO   anon, authenticated, service_role;

COMMIT;
