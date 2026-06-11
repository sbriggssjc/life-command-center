-- =====================================================================
-- DRAFT REMEDIATION — dia mis-ingestion sweep (2026-06-11)
-- Project: zqzrriwuavgrquhisnoa (Dialysis_DB)
-- =====================================================================
-- *** NOT APPLIED. Kept OUT of supabase/migrations/ on purpose so a deploy
-- *** cannot auto-run it. Nothing here writes to live sales_transactions /
-- *** properties until Scott verifies the frozen list + before/after at the
-- *** gate (FINDINGS.md §7).
--
-- Greenlit decisions (Scott, 2026-06-11):
--   • Fresenius industrial -> its OWN labeled class `industrial_corporate`
--     (real operator RE, queryable; excluded from clinic comps — NOT lumped
--     with mis-typed junk).
--   • Frozen review table `_sweep_candidates_2026_06_11` IS materialized
--     (read-only CREATE TABLE AS) — confirmation + before/after compute
--     against it, not a moving query.
--   • Phantom-dup dedup is the PRIORITY slice ($906M live distortion).
--
-- Doctrine: additive · idempotent · provenance-tagged · NEVER hard-delete
--           (exclude / supersede / re-type and keep every row — mirrors gov
--           and the LCC field-provenance rules).
-- Apply order: STEP 1 -> Scott confirms _sweep_candidates -> STEP 2 (dedup,
--              priority) -> STEP 3 -> STEP 4 -> STEP 5 (guards) -> STEP 6.
-- =====================================================================


-- =====================================================================
-- STEP 1 — port gov's taxonomy to dia (additive, reversible)
-- =====================================================================
ALTER TABLE public.sales_transactions
  ADD COLUMN IF NOT EXISTS sales_record_classification text,
  ADD COLUMN IF NOT EXISTS sales_exclusion_reason     text;

-- Don't silently reclassify history: tag pre-existing exclusions as legacy.
UPDATE public.sales_transactions
   SET sales_record_classification = 'excluded_legacy'
 WHERE exclude_from_market_metrics IS TRUE
   AND sales_record_classification IS NULL;

-- Local audit ledger for this sweep (so every write is reversible from one place).
CREATE TABLE IF NOT EXISTS public._sweep_applied_2026_06_11 (
  sale_id            integer,
  property_id        integer,
  action             text,        -- supersede_duplicate | exclude | retype_property
  prev_exclude       boolean,
  prev_txn_state     text,
  prev_classification text,
  prev_domain_flag   text,
  new_value          text,
  applied_at         timestamptz DEFAULT now()
);

-- >>> GATE: Scott sets _sweep_candidates_2026_06_11.confirmed_class per row
--     BEFORE STEP 2+ run. phantom_duplicate may be applied off proposed_class
--     (deterministic price-fingerprint); mark confirmed_class='genuine_resale'
--     to spare any row that is a real second sale at a coincidentally equal price.
--     All OTHER classes require an explicit confirmed_class. <<<


-- =====================================================================
-- STEP 2 — PRIORITY SLICE: de-duplicate phantom sales (~$906M distortion)
--   Keep one row per (property_id, sold_price) fingerprint = keep_sale_id
--   (earliest sale_date). Supersede + exclude the rest. Never delete.
-- =====================================================================
-- INSERT INTO public._sweep_applied_2026_06_11
--   (sale_id, property_id, action, prev_exclude, prev_txn_state, prev_classification, new_value)
-- SELECT st.sale_id, st.property_id, 'supersede_duplicate',
--        st.exclude_from_market_metrics, st.transaction_state,
--        st.sales_record_classification, 'survivor='||c.keep_sale_id
--   FROM public._sweep_candidates_2026_06_11 c
--   JOIN public.sales_transactions st ON st.sale_id = c.sale_id
--  WHERE c.proposed_class = 'phantom_duplicate'
--    AND c.dup_rank > 1
--    AND coalesce(c.confirmed_class,'') <> 'genuine_resale';
--
-- UPDATE public.sales_transactions st
--    SET exclude_from_market_metrics = TRUE,
--        transaction_state           = 'superseded_duplicate',
--        sales_record_classification = 'duplicate_row',
--        sales_exclusion_reason      = 'mis_ingestion_sweep_2026_06_11: identical-price re-capture; survivor sale '||c.keep_sale_id,
--        dedup_group_id              = c.keep_sale_id
--   FROM public._sweep_candidates_2026_06_11 c
--  WHERE st.sale_id = c.sale_id
--    AND c.proposed_class = 'phantom_duplicate' AND c.dup_rank > 1
--    AND coalesce(c.confirmed_class,'') <> 'genuine_resale'
--    AND st.exclude_from_market_metrics IS NOT TRUE;     -- idempotent


-- =====================================================================
-- STEP 3 — exclude non-representative WRONG-ASSET sales (NO hard delete).
--   Driven by Scott-confirmed class. Includes the new industrial_corporate
--   label (excluded from clinic metrics but preserved + queryable).
-- =====================================================================
-- INSERT INTO public._sweep_applied_2026_06_11
--   (sale_id, property_id, action, prev_exclude, prev_classification, new_value)
-- SELECT st.sale_id, st.property_id, 'exclude', st.exclude_from_market_metrics,
--        st.sales_record_classification, c.confirmed_class
--   FROM public._sweep_candidates_2026_06_11 c
--   JOIN public.sales_transactions st ON st.sale_id = c.sale_id
--  WHERE c.confirmed_class IN
--    ('whole_center_multitenant','misclassified_wrong_type','industrial_corporate',
--     'portfolio_sale','unconfirmed');
--
-- UPDATE public.sales_transactions st
--    SET exclude_from_market_metrics = TRUE,
--        sales_record_classification = c.confirmed_class,
--        sales_exclusion_reason      = 'mis_ingestion_sweep_2026_06_11: '||c.confirmed_class
--   FROM public._sweep_candidates_2026_06_11 c
--  WHERE st.sale_id = c.sale_id
--    AND c.confirmed_class IN
--      ('whole_center_multitenant','misclassified_wrong_type','industrial_corporate',
--       'portfolio_sale','unconfirmed')
--    AND st.exclude_from_market_metrics IS NOT TRUE;     -- idempotent


-- =====================================================================
-- STEP 4 — re-type the property for the labeled buckets (keep the row).
--   industrial_corporate  -> domain_classification_flag = 'industrial_corporate'
--   misclassified_wrong_type (non-dialysis) -> 'non_dialysis_reclassified'
--   So the asset stays in the DB and is queryable for operator-RE analysis,
--   but every clinic/comp view filters it out.
-- =====================================================================
-- INSERT INTO public._sweep_applied_2026_06_11
--   (sale_id, property_id, action, prev_domain_flag, new_value)
-- SELECT c.sale_id, c.property_id, 'retype_property', p.domain_classification_flag,
--        CASE WHEN c.confirmed_class='industrial_corporate' THEN 'industrial_corporate'
--             ELSE 'non_dialysis_reclassified' END
--   FROM public._sweep_candidates_2026_06_11 c
--   JOIN public.properties p ON p.property_id = c.property_id
--  WHERE c.confirmed_class IN ('industrial_corporate','misclassified_wrong_type');
--
-- UPDATE public.properties p
--    SET domain_classification_flag = CASE
--          WHEN c.confirmed_class = 'industrial_corporate' THEN 'industrial_corporate'
--          ELSE 'non_dialysis_reclassified' END
--   FROM public._sweep_candidates_2026_06_11 c
--  WHERE p.property_id = c.property_id
--    AND c.confirmed_class IN ('industrial_corporate','misclassified_wrong_type')
--    AND p.domain_classification_flag IS DISTINCT FROM
--        (CASE WHEN c.confirmed_class='industrial_corporate' THEN 'industrial_corporate'
--              ELSE 'non_dialysis_reclassified' END);     -- idempotent
--
-- NOTE: clinic comp views must add  AND p.domain_classification_flag IS DISTINCT FROM
--       'industrial_corporate' AND p.domain_classification_flag IS DISTINCT FROM
--       'non_dialysis_reclassified'  (or filter on the sale exclusion, which is
--       already set in STEP 3 — belt-and-suspenders).


-- =====================================================================
-- STEP 5 — STOP RE-ACCUMULATION (the leak goes where the source is — FINDINGS §5)
-- =====================================================================
-- (a) WRITER GUARD — api/_handlers/sidebar-pipeline.js::upsertDomainSales AND the
--     historical CSV importer. Before a sale reaches market metrics, run the
--     corroborated signal check (psf > band AND (name OR size OR non-dialysis
--     ptype/tenant)); on a hit set exclude_from_market_metrics=TRUE +
--     sales_record_classification='needs_review' instead of counting it.
--     Mirrors the existing isJunkTenant() defense. (Wrong assets enter via
--     legacy/null + costar_sidebar + historical_csv_import.)
--
-- (b) DE-DUP HARDENING — fold identical-price/different-date re-captures into the
--     natural key so the existing dedup machinery owns this class going forward
--     (the 195-group miss came from costar_sidebar re-capture + CSV re-import):
--       e.g. dedup_natural_key := lower(coalesce(address,''))||'|'||property_id||'|'||sold_price
--     and a pre-write probe that supersedes on collision.
--
-- (c) DATA-QUALITY VIEW — extend dia v_data_quality_issues with new issue_kinds so
--     new arrivals surface in triage instead of silently counting. Concrete adds:
--       whole_center_sale      : non-excluded sale, psf>1500 AND (name|ptype signal)
--       non_dialysis_asset     : property_type ~ industrial/warehouse/retail-center
--                                /shopping/mall AND not domain_classification_flag-tagged
--       phantom_duplicate_sale : >1 non-excluded sale per (property_id, sold_price)
--       oversized_clinic       : building_size > 25000 on a single-tenant clinic row


-- =====================================================================
-- STEP 6 — RECOMPUTE before/after from the FROZEN list; present; Scott signs off.
--   Exact "after" = book metrics minus _sweep_candidates rows whose confirmed_class
--   is terminal (everything except 'genuine_resale' / 'keep'). Run per spike year.
-- =====================================================================
-- SELECT extract(year FROM st.sale_date)::int AS yr,
--        count(*) n_after, sum(st.sold_price)::bigint vol_after, round(avg(st.sold_price)) avg_after
--   FROM public.sales_transactions st
--  WHERE st.exclude_from_market_metrics IS NOT TRUE AND st.sold_price>0
--    AND st.sale_id NOT IN (
--      SELECT sale_id FROM public._sweep_candidates_2026_06_11
--       WHERE coalesce(confirmed_class,'review') NOT IN ('genuine_resale','keep'))
--  GROUP BY 1 ORDER BY 1;


-- =====================================================================
-- ROLLBACK (fully reversible — nothing was deleted)
-- =====================================================================
-- UPDATE public.sales_transactions st
--    SET exclude_from_market_metrics = a.prev_exclude,
--        transaction_state           = a.prev_txn_state,
--        sales_record_classification = a.prev_classification,
--        sales_exclusion_reason      = NULL, dedup_group_id = NULL
--   FROM public._sweep_applied_2026_06_11 a
--  WHERE st.sale_id = a.sale_id AND a.action IN ('supersede_duplicate','exclude');
-- UPDATE public.properties p SET domain_classification_flag = a.prev_domain_flag
--   FROM public._sweep_applied_2026_06_11 a
--  WHERE p.property_id = a.property_id AND a.action = 'retype_property';
-- -- STEP 1 columns can stay (additive) or be dropped if truly reverting.


-- =====================================================================
-- GOV (separate, light): residual is price/rba data-quality on REAL gov assets
-- (e.g. SSA Mission Viejo $14,762/sf), NOT wrong-asset bleed — gov's taxonomy
-- already excludes 68% / classifies 100%. Handle as a small DQ follow-up, not
-- part of this dia migration.
-- =====================================================================
