-- ============================================================================
-- Migration: extend dia_normalize_address to strip CoStar/LoopNet listing-
--            status prefixes ("For Sale | ", "For Lease | ", "Reduced | ", …)
--            and rebuild the consolidate function so existing duplicates merge.
--
-- Target:    dialysis Supabase (DIA_SUPABASE_URL)
--
-- Why:
--   Sidebar captures of CoStar /detail/for-sale/ and LoopNet listing pages
--   sometimes leak the heading prefix into properties.address. The 24h audit
--   on 2026-05-04 (LCC > Dialysis > Pipeline > Available) showed the first
--   page of available DaVita listings dominated by addresses like
--       "For Sale | 1164 Route 130 North"
--       "For Sale | 802 N John Young Pky"
--       "For Sale | 215 Old Camp Rd"
--   each of which is a duplicate of the canonical row keyed on the bare
--   street address. The "🔗 Consolidate Property" sidebar action couldn't
--   merge them because find_property_consolidation_candidates compares
--   exact_address_dups via dia_normalize_address(p.address) = subject.na,
--   and the prefix slipped through normalization unchanged.
--
--   Server-side ingestion is now defended at the API layer
--   (api/_shared/entity-link.js::stripListingStatusPrefix is called from
--   entities-handler.js and sidebar-pipeline.js::upsertDomainProperty), and
--   the extension content scripts now strip the prefix client-side too.
--   This migration mirrors that strip into SQL so:
--     (a) v_property_merge_candidates / dia_auto_merge_property_duplicates
--         pick up the existing duplicates that already landed before the
--         API fix shipped, and
--     (b) the find_property_consolidation_candidates UI lookup can match
--         "For Sale | <street>" rows to their canonical "<street>" rows.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.dia_normalize_address(addr text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT lower(trim(regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(
                  regexp_replace(
                    regexp_replace(
                      regexp_replace(
                        regexp_replace(
                          -- Strip listing-status prefix BEFORE any other
                          -- processing so "For Sale | 1164 Route 130 North"
                          -- collapses to the same key as "1164 Route 130 North".
                          -- Pattern is anchored ^ and tolerates pipe / hyphen /
                          -- en-dash / em-dash / colon delimiters with optional
                          -- surrounding whitespace.
                          split_part(
                            regexp_replace(
                              coalesce(addr, ''),
                              '^\s*(for\s+sale|for\s+lease|for\s+rent|sale|sold|lease|rent|new\s+listing|reduced|price\s+reduced|just\s+listed|coming\s+soon|under\s+contract|off\s+market|new\s+price)\s*[|\-–—:]\s*',
                              '',
                              'i'
                            ),
                            ',', 1
                          ),
                        '\mStreet\M', 'St',   'gi'),
                      '\mAvenue\M',   'Ave',  'gi'),
                    '\mBoulevard\M',  'Blvd', 'gi'),
                  '\mDrive\M',        'Dr',   'gi'),
                '\mRoad\M',           'Rd',   'gi'),
              '\mLane\M',             'Ln',   'gi'),
            '\mCourt\M',              'Ct',   'gi'),
          '\mPlace\M',                'Pl',   'gi'),
        '\mHighway\M',                'Hwy',  'gi'),
      '\mParkway\M',                  'Pkwy', 'gi'),
    '\mCircle\M',                     'Cir',  'gi'),
  '\mTrail\M',                        'Trl',  'gi'));
$$;

COMMENT ON FUNCTION public.dia_normalize_address(text) IS
  'SQL mirror of api/_shared/entity-link.js:normalizeAddress. Strips
   CoStar/LoopNet listing-status prefixes ("For Sale | ", "Reduced | ", …)
   first, then truncates at the first comma, expands suffix abbreviations,
   and lowercases. Used by v_property_merge_candidates,
   dia_auto_merge_property_duplicates, and
   find_property_consolidation_candidates so format variants — including
   prefixed listing addresses — group together for duplicate detection.';
