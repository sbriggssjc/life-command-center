-- ============================================================================
-- Rent Intelligence Engine — Phase 2 ADDENDUM (dia), applied live to
-- zqzrriwuavgrquhisnoa. Three items resolving the Phase 2 review:
--   1. Convention shells (v_dia_rent_cohort_median + dia_build_rent_convention_shells)
--   2. Value-prop CANONICAL definition + reconcile publish gate
--   3. NM attribution reconstruction (source-agnostic evidence + CIS drop-in)
-- Full applied bodies are authoritative in the DB; reproduce any function via
-- pg_get_functiondef / pg_get_viewdef. Key definitions below for repo review.
-- ============================================================================

-- 1. Cohort median PSF (tenant x vintage-decade x state, n>=5) — see report.
CREATE OR REPLACE VIEW public.v_dia_rent_cohort_median AS
SELECT public.dia_normalize_operator(COALESCE(p.tenant,p.operator)) AS tenant_canonical,
       (floor(p.year_built/10.0)*10)::int AS vintage_decade, p.state,
       count(*) AS n,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY l.rent_per_sf)::numeric,2) AS median_psf
FROM public.leases l JOIN public.properties p ON p.property_id=l.property_id
WHERE l.rent_per_sf BETWEEN 5 AND 200 AND l.source_confidence='documented'
  AND p.year_built IS NOT NULL AND p.state IS NOT NULL AND COALESCE(p.tenant,p.operator) IS NOT NULL
GROUP BY 1,2,3 HAVING count(*) >= 5;
-- dia_build_rent_convention_shells(p_batch,p_limit): materializes basis='convention'
-- rows ONLY where an intercept is derivable (property rent point -> conf 0.40, else
-- cohort-median PSF -> conf 0.35); anchor recorded in assumptions; never overwrites an
-- evidence timeline; no intercept -> no rows. (Full body applied live; see report.)

-- 2. Value-prop CANONICAL definition (reproduces the documented deal-level query
--    line-for-line) + reconcile-based publish gate. Filter set is in the view.
--    cm_dialysis_value_prop_24m ships published=false; v_dia_value_prop_publish_gate
--    exposes reconciles + attribution_certified (published=true requires both).
--    (Full bodies applied live: dia_value_prop_canonical_reconcile +
--     dia_value_prop_gate_wire_attribution_v2.)

-- 3. NM attribution reconstruction — source-agnostic evidence + CIS drop-in.
--    dia_nm_cis_closings: authoritative national export lands here (empty until loaded).
--    v_dia_nm_closing_evidence: UNION of sf_deal_staging(Closed IS/Final) +
--      sf_comp_staging(Internal/Sold) + dia_nm_cis_closings — new sources UNION in.
--    v_dia_nm_attribution_audit: per-flag certification verdict for 2023-26 sales.
--    (Full bodies applied live: dia_nm_attribution_reconstruction_v2.)

-- NOTE: this file documents the addendum surface for repo review; the executable
-- definitions were applied via mcp apply_migration in the same session and are the
-- source of truth in-DB.
