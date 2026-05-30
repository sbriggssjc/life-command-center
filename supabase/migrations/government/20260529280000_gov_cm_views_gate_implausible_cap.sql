-- ============================================================================
-- Gov — Gate implausible cap rates out of ALL capital-markets cap metrics
--
-- Target: government Supabase (GOV_SUPABASE_URL)
--
-- 2026-05-29 cap-rate consistency audit, gov side. cm_gov_market_quarterly +
-- v_sales_comps were already gated; the 14 gov standalone cap-detail views were
-- not. Gov cap expressions are varied (avg(COALESCE(sold/last/initial)),
-- avg(sold_cap_rate) FILTER, crh.cap_rate fallback chain, sold-vs-asking spreads)
-- and reference sold_cap_rate in WHERE/FILTER/JOIN conditions too — so this only
-- wraps unambiguous VALUE expressions with a null-implausible CASE, never a
-- boolean condition. "Null the cap, keep the row." Idempotent; views already
-- gated are skipped. Verified: 0 gov cap views ungated afterward; all query.
-- ============================================================================

DO $$
DECLARE v text; d0 text; d text;
  C constant text := 'CASE WHEN s.cap_rate_quality = ''implausible_unverified''::text THEN NULL::numeric ELSE ';
BEGIN
  FOR v IN
    SELECT viewname FROM pg_views WHERE schemaname='public' AND viewname LIKE 'cm_gov%'
      AND position('cap_rate_quality' in pg_get_viewdef((schemaname||'.'||viewname)::regclass,true))=0
      AND position('s.sold_cap_rate' in pg_get_viewdef((schemaname||'.'||viewname)::regclass,true))>0
  LOOP
    SELECT pg_get_viewdef(('public.'||v)::regclass, true) INTO d0;
    d := d0;
    d := replace(d, 'COALESCE(crh.cap_rate, s.sold_cap_rate, s.last_cap_rate, s.initial_cap_rate)',
                    C||'COALESCE(crh.cap_rate, s.sold_cap_rate, s.last_cap_rate, s.initial_cap_rate) END');
    d := replace(d, 'COALESCE(s.sold_cap_rate, s.last_cap_rate, s.initial_cap_rate)',
                    C||'COALESCE(s.sold_cap_rate, s.last_cap_rate, s.initial_cap_rate) END');
    d := replace(d, 'avg(s.sold_cap_rate)', 'avg('||C||'s.sold_cap_rate END)');
    d := replace(d, 's.sold_cap_rate AS cap', C||'s.sold_cap_rate END AS cap');
    d := replace(d, 's.sold_cap_rate - s.asking_cap_rate', C||'s.sold_cap_rate - s.asking_cap_rate END');
    IF d = d0 THEN RAISE NOTICE 'SKIP % (no safe value-expr target — manual review)', v; CONTINUE; END IF;
    EXECUTE 'CREATE OR REPLACE VIEW public.'||v||' AS ' || d;
    RAISE NOTICE 'patched %', v;
  END LOOP;
END $$;
