-- ============================================================================
-- Migration: backfill — strip CoStar/LoopNet listing-status prefixes off
--            existing LCC Opps entities.address values (asset entities).
--
-- Target:    LCC Opps Supabase
--
-- Why: pairs with the JS-side defenses in
--   - api/_handlers/entities-handler.js (stripListingStatusPrefix on insert)
--   - api/_handlers/sidebar-pipeline.js::upsertDomainProperty
--   - api/_shared/entity-link.js::normalizeAddress (now strips prefix first)
--   - extension/content/{costar,loopnet}.js (strip prefix before sending)
--
-- Without this backfill, asset entities created before the API guard shipped
-- continue to render "For Sale | 1164 Route 130 North" in the LCC contact /
-- pipeline cards and continue to mismatch CMS records during nightly
-- cross-domain matching.
-- ============================================================================

UPDATE public.entities
   SET address = regexp_replace(
                   address,
                   '^\s*(for\s+sale|for\s+lease|for\s+rent|sale|sold|lease|rent|new\s+listing|reduced|price\s+reduced|just\s+listed|coming\s+soon|under\s+contract|off\s+market|new\s+price)\s*[|\-–—:]\s*',
                   '',
                   'i'
                 )
 WHERE entity_type = 'asset'
   AND address ~* '^\s*(for\s+sale|for\s+lease|for\s+rent|sale|sold|lease|rent|new\s+listing|reduced|price\s+reduced|just\s+listed|coming\s+soon|under\s+contract|off\s+market|new\s+price)\s*[|\-–—:]';
