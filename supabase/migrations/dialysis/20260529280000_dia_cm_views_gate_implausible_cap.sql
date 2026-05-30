-- ============================================================================
-- Dia — Gate implausible cap rates out of ALL capital-markets cap metrics
--
-- Target: dialysis Supabase (DIA_SUPABASE_URL)
--
-- 2026-05-29 cap-rate consistency audit. G6 nulled implausible caps in
-- v_sales_comps, but the cm_dialysis_* capital-markets views (which feed the
-- PDF/Excel) had NO implausible gate — they averaged caps tagged
-- cap_rate_quality='implausible_unverified' (within the numeric band), so the CM
-- cap metrics overstated cap rates vs the (now clean) detail panel / dashboard.
--
-- Principle "null the cap, keep the row": implausible sales still count as
-- transactions/volume but contribute NO cap rate. This wraps every cap VALUE
-- expression (never a boolean WHERE/JOIN/FILTER condition) with a
-- null-implausible CASE. Idempotent (skips already-gated views) and covers every
-- expression form found across the dia cap views:
--   COALESCE(...) value chains (both orderings), avg(s.cap_rate),
--   avg((s.cap_rate)::numeric), percentile_cont WITHIN GROUP (ORDER BY
--   (s.cap_rate)::double precision), bare `s.cap_rate,` projection, `... AS cap`.
-- Verified live: 0 cm_dialysis cap views ungated afterward; all query.
--
-- DURABILITY CAVEAT: applied via CREATE OR REPLACE on live view defs. Any FUTURE
-- migration that recreates a cm_dialysis_* cap view MUST re-include this gate, or
-- it silently reintroduces the leak. (Gov mirror: government/20260529280000.)
-- ============================================================================

DO $$
DECLARE v text; d0 text; d text;
  C constant text := 'CASE WHEN s.cap_rate_quality = ''implausible_unverified''::text THEN NULL::numeric ELSE ';
BEGIN
  FOR v IN
    SELECT viewname FROM pg_views WHERE schemaname='public' AND viewname LIKE 'cm_dialysis%'
      AND position('cap_rate_quality' in pg_get_viewdef((schemaname||'.'||viewname)::regclass,true))=0
      AND position('s.cap_rate' in pg_get_viewdef((schemaname||'.'||viewname)::regclass,true))>0
  LOOP
    SELECT pg_get_viewdef(('public.'||v)::regclass, true) INTO d0;
    d := d0;
    d := replace(d,'COALESCE(s.calculated_cap_rate, s.stated_cap_rate, s.cap_rate)', C||'COALESCE(s.calculated_cap_rate, s.stated_cap_rate, s.cap_rate) END');
    d := replace(d,'COALESCE(s.cap_rate, s.calculated_cap_rate, s.stated_cap_rate)', C||'COALESCE(s.cap_rate, s.calculated_cap_rate, s.stated_cap_rate) END');
    d := replace(d,'avg(s.cap_rate)', 'avg('||C||'s.cap_rate END)');
    d := replace(d,'(s.cap_rate)::numeric', '('||C||'s.cap_rate END)::numeric');
    d := replace(d,'(s.cap_rate)::double precision', '('||C||'s.cap_rate END)::double precision');
    -- bare projection `s.cap_rate,` only when it is the sole occurrence, so we
    -- never touch WHERE/JOIN references of s.cap_rate.
    IF d = d0 AND (length(d0)-length(replace(d0,'s.cap_rate,','')))/length('s.cap_rate,') = 1 THEN
      d := replace(d0,'s.cap_rate,', C||'s.cap_rate END AS cap_rate,');
    END IF;
    IF d = d0 THEN RAISE NOTICE 'SKIP % (no safe value-expr target — manual review)', v; CONTINUE; END IF;
    BEGIN
      EXECUTE 'CREATE OR REPLACE VIEW public.'||v||' AS ' || d;
      RAISE NOTICE 'patched %', v;
    EXCEPTION WHEN others THEN RAISE WARNING 'FAILED % : %', v, SQLERRM;
    END;
  END LOOP;
END $$;
