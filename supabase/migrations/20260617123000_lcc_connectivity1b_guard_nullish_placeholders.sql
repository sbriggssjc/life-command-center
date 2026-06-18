-- ===========================================================================
-- CONNECTIVITY #1b — drain-gate tightening: null-ish "no owner known" placeholders
-- Target DB: LCC Opps (xengecqvemvfknjvbvrq)
-- Date: 2026-06-17
--
-- The capped→drain dia conservative pass surfaced one slip the guard missed: a
-- dia true_owner literally named "Unknown" got bridged (colliding with an
-- existing lcc "Unknown"). Add the null-ish placeholder class (Unknown /
-- Unknown Owner / N/A / N.A. / None / TBD / Not Available / Undisclosed /
-- Various) to the one SQL guard so every bridge path + the eligibility views
-- (separate migrations) exclude them. Whole-name anchored — "Various Partners
-- LLC" / "Unknown Holdings LLC" still pass. Mirrors entity-link.js
-- PLACEHOLDER_OWNER_PATTERNS. Idempotent (CREATE OR REPLACE).
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.lcc_owner_name_is_junk(p_name text)
RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_name IS NULL OR btrim(p_name) = '' OR (
       p_name ~  '\(\d{3}\)\s*\d{3}[-.\s]?\d{4}'
    OR p_name ~  '\m\d{3}[-.]\d{3}[-.]\d{4}\M'
    OR p_name ~* '(buyer|seller)\s*contacts?'
    OR p_name ~* '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
    OR p_name ~* '\(\s*[pcmf]\s*\)'
    OR p_name ~* '^\s*\d{5,}\s*(ira|llc|l\.l\.c|lp|llp|inc|corp|trust)?\s*$'
    OR p_name ~* '^\s*\d{4,}\s+ira\s*$'
    OR p_name ~* ':\s*(yes|no)\s*$'
    OR p_name ~* '^\s*(1031\s+)?exchange\s+buyer\s*$'
    OR p_name ~* '^\s*(buyer|seller|escrow)\s*$'
    OR p_name ~* '^\s*(unknown(\s+owner)?|n/?a|n\.a\.?|none|tbd|not\s+available|undisclosed|various)\s*$'
  );
$$;
