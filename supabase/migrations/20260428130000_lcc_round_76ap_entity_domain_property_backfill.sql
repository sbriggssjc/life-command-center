-- ============================================================================
-- Round 76ap — backfill entities.metadata.domain_property_id from external_identities
--
-- Background: promoteIntakeToDomainListing has an "lcc-bridge unwrap" path
-- that translates an LCC entity match (domain='lcc') back to the actual
-- dia/gov property_id needed to write into the domain DB. The unwrap looks
-- up the bridge in 3 fallbacks (api/_handlers/intake-promoter.js):
--
--   1. entity.metadata.domain_property_id            (fastest)
--   2. external_identities.source_system in (dia_db, gov_db)  (slower)
--   3. address-based ilike against dia/gov.properties (slowest)
--
-- Audit found 371 entities that had a perfectly good fallback-2 row (the
-- domain bridge identity is set in external_identities) but no fallback-1
-- shortcut in entity.metadata. Every fresh promote attempt for these
-- entities was paying the extra round-trip — and 18 stuck sidebar intakes
-- never even got to fallback-2 because of subsequent matcher caching
-- behavior.
--
-- This migration stamps the metadata shortcut for all 371, plus an audit
-- breadcrumb so we can identify the source of the backfill in logs.
--
-- Apply on LCC Opps (xengecqvemvfknjvbvrq).
-- ============================================================================

WITH domain_links AS (
  SELECT DISTINCT ON (ei.entity_id)
    ei.entity_id, ei.source_system, ei.external_id
  FROM public.external_identities ei
  JOIN public.entities e ON e.id = ei.entity_id
  WHERE ei.source_system IN ('dia_db','gov_db')
    AND (e.metadata->>'domain_property_id') IS NULL
  ORDER BY ei.entity_id, ei.last_synced_at DESC NULLS LAST
)
UPDATE public.entities e
   SET metadata = COALESCE(e.metadata, '{}'::jsonb) || jsonb_build_object(
                    'domain_property_id',         dl.external_id,
                    'domain_property_id_source',  dl.source_system,
                    '_round_76ap_backfilled_at',  NOW()::text
                  ),
       updated_at = NOW()
  FROM domain_links dl
 WHERE e.id = dl.entity_id;
