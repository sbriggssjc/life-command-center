-- =====================================================================
-- DRAFT REMEDIATION — dia mis-ingestion sweep (2026-06-11)
-- =====================================================================
-- *** NOT APPLIED. DO NOT RUN until the gate in FINDINGS.md §7 clears. ***
-- This is a plan-as-code companion to the audit. It mirrors gov's mature
-- taxonomy (sales_record_classification / sales_exclusion_reason) and the
-- LCC never-hard-delete + provenance doctrine. Every step is additive,
-- idempotent, and reversible.
--
-- Apply order:  Step 1 (schema) -> freeze candidate review table ->
--               Scott sign-off -> Steps 2-4 (writes) -> Step 5 (guards/views).
-- =====================================================================

-- ---------------------------------------------------------------------
-- STEP 1 — port gov's taxonomy to dia (additive, reversible)
-- ---------------------------------------------------------------------
ALTER TABLE public.sales_transactions
  ADD COLUMN IF NOT EXISTS sales_record_classification text,
  ADD COLUMN IF NOT EXISTS sales_exclusion_reason     text;

-- Backfill already-excluded legacy rows so nothing is silently reclassified.
UPDATE public.sales_transactions
   SET sales_record_classification = 'excluded_legacy'
 WHERE exclude_from_market_metrics IS TRUE
   AND sales_record_classification IS NULL;

-- ---------------------------------------------------------------------
-- FREEZE — materialize the frozen candidate list for human review.
-- (Run candidates_dia.sql body here; this is the static gate artifact.)
-- ---------------------------------------------------------------------
-- CREATE TABLE public._sweep_candidates_2026_06_11 AS
--   SELECT * FROM ( <candidates_dia.sql> ) c;
-- ALTER TABLE public._sweep_candidates_2026_06_11
--   ADD COLUMN confirmed_class text, ADD COLUMN reviewer text, ADD COLUMN reviewed_at timestamptz;
-- >>> Scott confirms/edits confirmed_class per row BEFORE anything below runs. <<<

-- ---------------------------------------------------------------------
-- STEP 2 — exclude non-representative sales (NO hard delete).
--          Driven by _sweep_candidates_2026_06_11.confirmed_class.
-- ---------------------------------------------------------------------
-- UPDATE public.sales_transactions st
--    SET exclude_from_market_metrics    = TRUE,
--        sales_record_classification    = c.confirmed_class,            -- whole_center_multitenant | misclassified_wrong_type | portfolio_sale | unconfirmed
--        sales_exclusion_reason         = 'mis_ingestion_sweep_2026_06_11: '||c.confirmed_class
--   FROM public._sweep_candidates_2026_06_11 c
--  WHERE st.sale_id = c.sale_id
--    AND c.confirmed_class IN ('whole_center_multitenant','misclassified_wrong_type','portfolio_sale','unconfirmed')
--    AND st.exclude_from_market_metrics IS NOT TRUE;
-- + one field_provenance row per write (source='mis_ingestion_sweep_2026_06_11') via lcc_merge_field.

-- ---------------------------------------------------------------------
-- STEP 3 — re-type WRONG-TYPE properties (keep the row, drop from clinic metrics)
-- ---------------------------------------------------------------------
-- UPDATE public.properties p
--    SET domain_classification_flag = CASE
--          WHEN p.property_type ~* '(industrial|warehouse|distribution)' THEN 'fresenius_industrial'
--          ELSE 'non_dialysis_reclassified' END
--   FROM public._sweep_candidates_2026_06_11 c
--  WHERE c.confirmed_class = 'misclassified_wrong_type'
--    AND p.property_id = (SELECT property_id FROM public.sales_transactions WHERE sale_id = c.sale_id);

-- ---------------------------------------------------------------------
-- STEP 4 — de-duplicate phantom sales (keep earliest/most-complete; supersede rest)
-- ---------------------------------------------------------------------
-- WITH g AS (
--   SELECT sale_id, property_id, sold_price,
--          row_number() OVER (PARTITION BY property_id, sold_price ORDER BY sale_date) AS rn,
--          first_value(sale_id) OVER (PARTITION BY property_id, sold_price ORDER BY sale_date) AS keep_id
--   FROM public.sales_transactions
--   WHERE sold_price>0 AND property_id IS NOT NULL AND exclude_from_market_metrics IS NOT TRUE)
-- UPDATE public.sales_transactions st
--    SET exclude_from_market_metrics = TRUE,
--        transaction_state           = 'superseded_duplicate',
--        sales_record_classification = 'duplicate_row',
--        sales_exclusion_reason      = 'mis_ingestion_sweep_2026_06_11: identical-price re-capture of sale '||g.keep_id,
--        dedup_group_id              = g.keep_id
--   FROM g WHERE st.sale_id = g.sale_id AND g.rn > 1;

-- ---------------------------------------------------------------------
-- STEP 5 — stop re-accumulation (guards + DQ view + de-dup hardening)
-- ---------------------------------------------------------------------
-- (a) Writer guard: in api/_handlers/sidebar-pipeline.js::upsertDomainSales and the
--     CSV importer, before writing a sale to market metrics, run the corroborated
--     signal check (psf>band AND (name OR size OR non-dialysis ptype/tenant)) and
--     route a hit to a review queue / set exclude_from_market_metrics=TRUE with
--     classification='needs_review' — mirroring the existing isJunkTenant() defense.
--
-- (b) Data-quality view (dia) — extend v_data_quality_issues with new issue_kinds:
--       whole_center_sale | non_dialysis_asset | phantom_duplicate_sale | oversized_clinic
--     so new arrivals surface in triage instead of silently counting.
--
-- (c) De-dup hardening: extend dedup_natural_key to fold identical-price /
--     different-date re-captures (the 195-group miss) so the existing de-dup
--     machinery owns this class going forward.

-- ---------------------------------------------------------------------
-- STEP 6 — recompute before/after from the FROZEN list; present to Scott; sign off.
-- ---------------------------------------------------------------------
