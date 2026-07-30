-- ============================================================================
-- 2026-07-30 — W3.7b: sf_files traversal columns for Listing/Deal file discovery
-- Government DB (ref scknotsqkcheojiaewwh)
--
-- The SF → LCC file-discovery sweep is being extended from Comp__c only to
-- Listing__c and Opportunity (Deal) ContentDocumentLinks (proof: the Fort Wayne
-- USDVA OM is attached to the LISTING record a0jVs000005AqaLIAS in Salesforce
-- but had no sf_files row, so W3.7 could not reach it).
--
-- A file discovered off a Comp/Listing/Deal already carries linked_entity_type +
-- linked_entity_sf_id (the record the ContentDocumentLink hangs off). These
-- convenience columns ADDITIONALLY stamp which comp / listing / deal SF id the
-- file belongs to, so the om-comp-resolver traversal
--   comp review row → sf_comp_staging.{sf_comp_id,sf_listing_id,sf_deal_id}
--                    → sf_files
-- can match on a direct, indexed column rather than only linked_entity_sf_id.
--
-- Additive, nullable, reversible (DROP COLUMN / DROP INDEX). Applied live.
-- ============================================================================
ALTER TABLE public.sf_files
  ADD COLUMN IF NOT EXISTS sf_comp_id    text,
  ADD COLUMN IF NOT EXISTS sf_listing_id text,
  ADD COLUMN IF NOT EXISTS sf_deal_id    text;

CREATE INDEX IF NOT EXISTS ix_sf_files_sf_listing_id ON public.sf_files (sf_listing_id) WHERE sf_listing_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_sf_files_sf_deal_id    ON public.sf_files (sf_deal_id)    WHERE sf_deal_id    IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_sf_files_sf_comp_id    ON public.sf_files (sf_comp_id)    WHERE sf_comp_id    IS NOT NULL;

-- Backfill the convenience column for the EXISTING Comp__c-linked corpus so the
-- new resolver traversal matches them too (they are all comp-attached today).
UPDATE public.sf_files
   SET sf_comp_id = linked_entity_sf_id
 WHERE linked_entity_type = 'Comp__c'
   AND sf_comp_id IS NULL
   AND linked_entity_sf_id IS NOT NULL;
