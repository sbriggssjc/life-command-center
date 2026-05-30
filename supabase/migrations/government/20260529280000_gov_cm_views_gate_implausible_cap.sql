-- ============================================================================
-- Gov — Gate implausible cap rates out of ALL capital-markets cap metrics
--
-- Target: government Supabase (GOV_SUPABASE_URL)
--
-- 2026-05-29 cap-rate consistency audit, gov side. cm_gov_market_quarterly +
-- v_sales_comps were already gated; the 14 gov standalone cap-detail views were
-- not. Gov cap expressions are varied and ALSO reference sold_cap_rate in
-- WHERE/FILTER/JOIN conditions, so this wraps ONLY value expressions with a
-- null-implausible CASE, never a boolean condition. Idempotent (skips
-- already-gated views). Covers every form found across the gov cap views:
--   COALESCE chains incl. crh.cap_rate fallback, avg(s.sold_cap_rate),
--   avg((s.sold_cap_rate)::numeric), percentile_cont WITHIN GROUP
--   (ORDER BY (s.sold_cap_rate)::double precision), (s.last_cap_rate -
--   s.sold_cap_rate) spreads, bare `s.sold_cap_rate,` projection, `... AS cap`.
-- Verified live: 0 cm_gov cap views ungated afterward; all query.
--
-- DURABILITY CAVEAT: applied via CREATE OR REPLACE on live view defs. Any FUTURE
-- migration that recreates a cm_gov_* cap view MUST re-include this gate.
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
    d := replace(d,'COALESCE(crh.cap_rate, s.sold_cap_rate, s.last_cap_rate, s.initial_cap_rate)', C||'COALESCE(crh.cap_rate, s.sold_cap_rate, s.last_cap_rate, s.initial_cap_rate) END');
    d := replace(d,'COALESCE(s.sold_cap_rate, s.last_cap_rate, s.initial_cap_rate)', C||'COALESCE(s.sold_cap_rate, s.last_cap_rate, s.initial_cap_rate) END');
    d := replace(d,'avg(s.sold_cap_rate)', 'avg('||C||'s.sold_cap_rate END)');
    -- avg(...) FILTER form: wrap only the inner value arg, never the FILTER WHERE.
    d := replace(d,'avg(s.sold_cap_rate) FILTER', 'avg(CASE WHEN s.cap_rate_quality = ''implausible_unverified''::text THEN NULL::numeric ELSE s.sold_cap_rate END) FILTER');
    d := replace(d,'(s.sold_cap_rate - s.last_cap_rate)', '(CASE WHEN s.cap_rate_quality = ''implausible_unverified''::text THEN NULL::numeric ELSE s.sold_cap_rate END - s.last_cap_rate)');
    -- bid-ask spread is avg(last - sold) (this ordering); wrap the sold term.
    d := replace(d,'avg(s.last_cap_rate - s.sold_cap_rate)', 'avg(s.last_cap_rate - CASE WHEN s.cap_rate_quality = ''implausible_unverified''::text THEN NULL::numeric ELSE s.sold_cap_rate END)');
    d := replace(d,'(s.sold_cap_rate)::numeric', '('||C||'s.sold_cap_rate END)::numeric');
    d := replace(d,'(s.sold_cap_rate)::double precision', '('||C||'s.sold_cap_rate END)::double precision');
    d := replace(d,'(s.last_cap_rate - s.sold_cap_rate)', '('||C||'s.last_cap_rate - s.sold_cap_rate END)');
    d := replace(d,'s.sold_cap_rate AS cap', C||'s.sold_cap_rate END AS cap');
    IF d = d0 AND (length(d0)-length(replace(d0,'s.sold_cap_rate,','')))/length('s.sold_cap_rate,') = 1 THEN
      d := replace(d0,'s.sold_cap_rate,', C||'s.sold_cap_rate END AS sold_cap_rate,');
    END IF;
    IF d = d0 THEN RAISE NOTICE 'SKIP % (no safe value-expr target — manual review)', v; CONTINUE; END IF;
    BEGIN
      EXECUTE 'CREATE OR REPLACE VIEW public.'||v||' AS ' || d;
      RAISE NOTICE 'patched %', v;
    EXCEPTION WHEN others THEN RAISE WARNING 'FAILED % : %', v, SQLERRM;
    END;
  END LOOP;
END $$;
