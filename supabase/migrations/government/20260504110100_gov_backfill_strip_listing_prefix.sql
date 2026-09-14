-- ⚠️ HISTORICAL — DO NOT RE-APPLY. This directory does not own the government database;
-- `government-lease` does (see supabase/migrations/government/README.md, 2026-09-12).
-- This file is kept as a record of what this repo applied in the past. The live, correct
-- copy of any object it defines may have since diverged -- read the deployed database or
-- government-lease's committed source, never this file, before trusting its content.

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
