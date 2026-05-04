-- ============================================================================
-- Migration: backfill — strip CoStar/LoopNet listing-status prefixes off
--            existing properties.address values (gov mirror of the dia
--            backfill, 20260504110100_dia_backfill_strip_listing_prefix.sql).
--
-- Target:    government Supabase
-- ============================================================================

UPDATE public.properties
   SET address = regexp_replace(
                   address,
                   '^\s*(for\s+sale|for\s+lease|for\s+rent|sale|sold|lease|rent|new\s+listing|reduced|price\s+reduced|just\s+listed|coming\s+soon|under\s+contract|off\s+market|new\s+price)\s*[|\-–—:]\s*',
                   '',
                   'i'
                 )
 WHERE address ~* '^\s*(for\s+sale|for\s+lease|for\s+rent|sale|sold|lease|rent|new\s+listing|reduced|price\s+reduced|just\s+listed|coming\s+soon|under\s+contract|off\s+market|new\s+price)\s*[|\-–—:]';
