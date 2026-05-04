-- ============================================================================
-- Migration: backfill — strip CoStar/LoopNet listing-status prefixes
--            ("For Sale | ", "For Lease | ", "Reduced | ", …) off existing
--            properties.address values so the visible Available Listings
--            view shows clean addresses and the consolidate UI can merge
--            the duplicates that already landed before the API guard
--            shipped.
--
-- Target:    dialysis Supabase (DIA_SUPABASE_URL)
--
-- Pairs with:
--   20260504110000_dia_normalize_address_strip_listing_prefix.sql
--
-- Effect:
--   1. UPDATE properties SET address = stripped_form WHERE address ~* '^prefix';
--   2. The next nightly dia_auto_merge_property_duplicates run (or a manual
--      consolidate-property POST from the LCC sidebar) will then collapse the
--      now-matching pairs, since dia_normalize_address(stripped) ==
--      dia_normalize_address(canonical).
-- ============================================================================

UPDATE public.properties
   SET address = regexp_replace(
                   address,
                   '^\s*(for\s+sale|for\s+lease|for\s+rent|sale|sold|lease|rent|new\s+listing|reduced|price\s+reduced|just\s+listed|coming\s+soon|under\s+contract|off\s+market|new\s+price)\s*[|\-–—:]\s*',
                   '',
                   'i'
                 )
 WHERE address ~* '^\s*(for\s+sale|for\s+lease|for\s+rent|sale|sold|lease|rent|new\s+listing|reduced|price\s+reduced|just\s+listed|coming\s+soon|under\s+contract|off\s+market|new\s+price)\s*[|\-–—:]';
