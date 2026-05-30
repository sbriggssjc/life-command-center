-- ============================================================================
-- Dia — Gate implausible cap rates out of ALL capital-markets cap metrics
--
-- Target: dialysis Supabase (DIA_SUPABASE_URL)
--
-- 2026-05-29 cap-rate consistency audit. G6 nulled implausible caps in
-- v_sales_comps, but the cm_dialysis_* capital-markets views (which feed the
-- PDF/Excel) had NO implausible gate — they averaged caps tagged
-- cap_rate_quality='implausible_unverified' (within the numeric band), so the
-- CM cap metrics overstated cap rates vs the (clean) detail panel / gov side.
--
-- Principle "null the cap, keep the row": implausible sales still count as
-- transactions/volume, but contribute NO cap rate. This migration wraps every
-- cm_dialysis cap expression with a CASE that nulls implausible. Idempotent and
-- tolerant: handles both COALESCE orderings + the bare `s.cap_rate,` projection;
-- views already gated, derived views (read a patched base), or with a
-- non-standard expression are skipped. (Gov: cm_gov_market_quarterly was already
-- gated; the gov standalone cap views are a separate per-view follow-up because
-- their expressions reference cap in WHERE/FILTER/JOIN contexts that a blind
-- replace would corrupt.)
-- ============================================================================

DO $$
DECLARE v text; d0 text; d text;
BEGIN
  FOR v IN
    SELECT viewname FROM pg_views WHERE schemaname='public' AND viewname LIKE 'cm_dialysis%'
      AND position('cap_rate_quality' in pg_get_viewdef((schemaname||'.'||viewname)::regclass,true))=0
      AND position('s.cap_rate' in pg_get_viewdef((schemaname||'.'||viewname)::regclass,true))>0
  LOOP
    SELECT pg_get_viewdef(('public.'||v)::regclass, true) INTO d0;
    d := replace(d0,
      'COALESCE(s.calculated_cap_rate, s.stated_cap_rate, s.cap_rate)',
      'CASE WHEN s.cap_rate_quality = ''implausible_unverified''::text THEN NULL::numeric ELSE COALESCE(s.calculated_cap_rate, s.stated_cap_rate, s.cap_rate) END');
    d := replace(d,
      'COALESCE(s.cap_rate, s.calculated_cap_rate, s.stated_cap_rate)',
      'CASE WHEN s.cap_rate_quality = ''implausible_unverified''::text THEN NULL::numeric ELSE COALESCE(s.cap_rate, s.calculated_cap_rate, s.stated_cap_rate) END');
    -- bare projection `s.cap_rate,` (e.g. cap_by_term_q) — only when it's the
    -- sole such occurrence, to avoid touching WHERE/FILTER references.
    IF d = d0 AND (length(d0)-length(replace(d0,'s.cap_rate,','')))/length('s.cap_rate,') = 1 THEN
      d := replace(d0, 's.cap_rate,',
        'CASE WHEN s.cap_rate_quality = ''implausible_unverified''::text THEN NULL::numeric ELSE s.cap_rate END AS cap_rate,');
    END IF;
    IF d = d0 THEN RAISE NOTICE 'SKIP % (no standard cap expr / derives from a patched base / needs manual review)', v; CONTINUE; END IF;
    EXECUTE 'CREATE OR REPLACE VIEW public.'||v||' AS ' || d;
    RAISE NOTICE 'patched %', v;
  END LOOP;
END $$;
