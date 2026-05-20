-- ============================================================================
-- R4 data-governance: complete the stalled Phase-3 enforcement rollout
--
-- Target: LCC Opps (xengecqvemvfknjvbvrq)
-- Tracks: R4-5 (163 unranked writer-paths) + R4-6 (485 logged conflicts)
-- Spec:   audit/ROUND_4_FINDINGS_2026-05-20.md + Field-level data provenance
--         decisions captured in this round (see audit/R4_PROVENANCE_PHASE3.md).
--
-- Owner-decided per-field winners (CoStar vs RCA vs OM vs Email):
--   * OM wins lease terms over Email           (was a true 35/35 tie)
--   * CoStar wins property attributes over RCA (year_built, address, parcel,
--     source_url, parcel improvement_value)
--   * CoStar wins `role` over OM and RCA (CoStar's role labels are richer)
--   * RCA wins contact-identity fields (already in place)
--   * OM wins deal economics + parties (already in place)
--
-- This migration only touches the priority registry (no domain data writes).
-- Phase-3 enforcement flips here are RECORD_ONLY -> WARN, not WARN -> STRICT.
-- ============================================================================

BEGIN;

-- --------------------------------------------------------------------------
-- Part 1 (R4-6): rerank per owner decisions
-- --------------------------------------------------------------------------

-- 1a. OM > Email for lease terms (only set with both currently at 35).
UPDATE public.field_source_priority
   SET priority = 30,
       notes    = COALESCE(notes,'') || ' [R4-6 2026-05-20: OM>Email on lease terms]'
 WHERE target_table = 'dia.leases'
   AND field_name IN ('lease_expiration','lease_start','renewal_options')
   AND source = 'om_extraction';

-- 1b. CoStar > RCA for property attributes (year_built, address, parcel,
-- source_url, improvement_value). CoStar was at 55-65 (loses to RCA=50);
-- pull below RCA so it wins between the two while still letting county
-- (=5-10), OM (=30-50), and manual_edit (=1) win where they apply.
UPDATE public.field_source_priority
   SET priority = 45,
       notes    = COALESCE(notes,'') || ' [R4-6 2026-05-20: CoStar>RCA on property attrs]'
 WHERE source = 'costar_sidebar'
   AND (
        (target_table = 'dia.properties'         AND field_name = 'year_built')
     OR (target_table = 'dia.properties'         AND field_name = 'address')
     OR (target_table = 'dia.properties'         AND field_name = 'parcel_number')
     OR (target_table = 'dia.property_documents' AND field_name = 'source_url')
     OR (target_table = 'gov.properties'         AND field_name = 'year_built')
     OR (target_table = 'gov.property_documents' AND field_name = 'source_url')
     OR (target_table = 'gov.parcel_records'     AND field_name = 'improvement_value')
   );

-- 1c. CoStar wins `role` (between CoStar, RCA, OM). Move CoStar below
-- om_extraction(=40) and rca_sidebar(=50). manual_edit(=1) and
-- salesforce(=20) still outrank.
UPDATE public.field_source_priority
   SET priority = 30,
       notes    = COALESCE(notes,'') || ' [R4-6 2026-05-20: CoStar wins role]'
 WHERE target_table = 'dia.contacts'
   AND field_name   = 'role'
   AND source       = 'costar_sidebar';

-- --------------------------------------------------------------------------
-- Part 2 (R4-5): register the 163 unranked writer-paths
--
-- Pulls from v_field_provenance_unranked and assigns a priority by source
-- naming convention (matching the seed registry). Skips two known
-- already-fixed drift cases:
--   * `gov.gov.leases.*` (double-schema writer typo, fixed in companion JS
--     change to sidebar-pipeline.js)
--   * `gov.contacts.contact_name` / `gov.contacts.contact_email`
--     (column-name drift -- gov.contacts uses `name`/`email`; these are
--     misspelled writer paths -- see migration 20260511120000)
-- --------------------------------------------------------------------------

INSERT INTO public.field_source_priority
  (target_table, field_name, source, priority, enforce_mode, notes)
SELECT
  u.target_table,
  u.field_name,
  u.source,
  CASE u.source
    WHEN 'manual_edit'                THEN 1
    WHEN 'county_records'              THEN 5
    WHEN 'lease_document'              THEN 10
    WHEN 'cms_chain_org'               THEN 15
    WHEN 'salesforce'                  THEN 20
    WHEN 'manual_verify'               THEN 20
    WHEN 'costar_cmbs_loan'            THEN 20
    WHEN 'om_extraction'               THEN 30
    WHEN 'email_intake'                THEN 35
    WHEN 'rca_sidebar'                 THEN 50
    WHEN 'sidebar_inline_match'        THEN 50
    WHEN 'costar_sidebar'              THEN 60
    WHEN 'crexi_sidebar'               THEN 65
    WHEN 'crexi_sidebar_description'   THEN 70
    WHEN 'availability_scraper'        THEN 65
    WHEN 'loopnet'                     THEN 75
    ELSE 80
  END AS priority,
  'record_only' AS enforce_mode,
  'R4-5 2026-05-20: auto-registered from v_field_provenance_unranked' AS notes
FROM public.v_field_provenance_unranked u
WHERE u.target_table NOT LIKE 'gov.gov.%'
  AND NOT (u.target_table = 'gov.contacts' AND u.field_name IN ('contact_name','contact_email'))
ON CONFLICT (target_table, field_name, source) DO NOTHING;

-- --------------------------------------------------------------------------
-- Part 3 (R4-6 / Phase-3): flip the OWNER-DECIDED rules to WARN.
--
-- Flips happen on the *losing* source's rule. In warn mode, the JS-side
-- field-priority guard logs `[field-provenance:warn] skip on <table>.<field>`
-- whenever lcc_merge_field would block this source's write under strict.
-- No writes are blocked yet -- this is observation only. After a cycle of
-- warn-mode logs are reviewed, flip the same set to STRICT in a follow-up.
-- --------------------------------------------------------------------------

-- email_intake loses to om_extraction on lease terms
UPDATE public.field_source_priority
   SET enforce_mode = 'warn',
       notes        = COALESCE(notes,'') || ' [R4-6 Phase-3 warn]'
 WHERE target_table = 'dia.leases'
   AND field_name IN ('lease_expiration','lease_start','renewal_options')
   AND source = 'email_intake'
   AND enforce_mode = 'record_only';

-- rca_sidebar loses to costar_sidebar on property attributes
UPDATE public.field_source_priority
   SET enforce_mode = 'warn',
       notes        = COALESCE(notes,'') || ' [R4-6 Phase-3 warn]'
 WHERE source = 'rca_sidebar'
   AND enforce_mode = 'record_only'
   AND (
        (target_table = 'dia.properties'         AND field_name IN ('year_built','address','parcel_number'))
     OR (target_table = 'dia.property_documents' AND field_name = 'source_url')
     OR (target_table = 'gov.properties'         AND field_name = 'year_built')
     OR (target_table = 'gov.property_documents' AND field_name = 'source_url')
     OR (target_table = 'gov.parcel_records'     AND field_name = 'improvement_value')
   );

-- om_extraction + rca_sidebar lose to costar_sidebar on dia.contacts.role
UPDATE public.field_source_priority
   SET enforce_mode = 'warn',
       notes        = COALESCE(notes,'') || ' [R4-6 Phase-3 warn]'
 WHERE target_table = 'dia.contacts'
   AND field_name   = 'role'
   AND source IN ('om_extraction','rca_sidebar')
   AND enforce_mode = 'record_only';

COMMIT;
