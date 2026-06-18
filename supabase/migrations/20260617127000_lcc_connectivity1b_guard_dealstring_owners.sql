-- ===========================================================================
-- CONNECTIVITY #1b — broad-drain gate: reject attribution / amount / date
-- artifacts mis-recorded as owners (SQL bridge path) — NARROW, defensible set
-- Target DB: LCC Opps (xengecqvemvfknjvbvrq)
-- Date: 2026-06-17
--
-- The capped broad-only (is_current_owner=false) drains surfaced the broad
-- tier's contamination classes — cells mis-recorded into recorded_owners that
-- are NOT owners:
--   * special-servicer / amount: "C-III Asset Management OBO JPM 2000-C10",
--     "Choice One Development CFCRE 2016-C4 ($2.4m approx)";
--   * broker / management attribution: "HG Fenton Co by The Kucera Co",
--     "Rendina Cos JV Artemis RE Partners OBO CalSTRS";
--   * captured date fragment: "Since Sep 30, 2022".
--
-- IMPORTANT (the gate caught the over-reach too): a CMBS-shelf-code or year-
-- series pattern alone is NOT an artifact signal — a CMBS-REO SPE
-- ("JPMBB 2014-C18 THORN RUN ROAD, LLC") is the trust's property-holding LLC, a
-- REAL title-holder owner; a street-range LLC ("1010-1090 OLD DES PERES ROAD
-- LLC") is a real owner. So this guard is NARROW: only unambiguous
-- attribution/amount/date signals a real owning LLC never carries
-- ($ / approx / parenthesized $-or-approx / OBO / "X by Y" / "Since <date>" /
-- Month D, YYYY). CMBS-REO SPE + street-range LLC owners bridge normally.
--
-- OWNER-SCOPED (lcc_owner_name_is_junk runs on true_owner names + the eligibility
-- views, never on asset names). The JS ensureEntityLink path already rejects
-- these via isImplausiblePersonName / DEAL_STRING_RE (locked by entity-link.test);
-- the gap is the SQL bridge (lcc_finalize_bridge_eligible_owners), which this
-- closes. Owner-safe (validated live): "Darby Creek Partners" / "Standby Power
-- LLC" / "May Properties LLC" / "HG Fenton Co" / the CMBS-REO SPEs all PASS.
-- Idempotent.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.lcc_owner_name_is_junk(p_name text)
RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_name IS NULL OR btrim(p_name) = '' OR (
    -- Structural junk (phone / email / contacts-header / phone-type).
       p_name ~  '\(\d{3}\)\s*\d{3}[-.\s]?\d{4}'
    OR p_name ~  '\m\d{3}[-.]\d{3}[-.]\d{4}\M'
    OR p_name ~* '(buyer|seller)\s*contacts?'
    OR p_name ~* '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
    OR p_name ~* '\(\s*[pcmf]\s*\)'
    -- Placeholder / form-field / account-number / null-ish owner cells.
    OR p_name ~* '^\s*\d{5,}\s*(ira|llc|l\.l\.c|lp|llp|inc|corp|trust)?\s*$'
    OR p_name ~* '^\s*\d{4,}\s+ira\s*$'
    OR p_name ~* ':\s*(yes|no)\s*$'
    OR p_name ~* '^\s*(1031\s+)?exchange\s+buyer\s*$'
    OR p_name ~* '^\s*(buyer|seller|escrow)\s*$'
    OR p_name ~* '^\s*(unknown(\s+owner)?|n/?a|n\.a\.?|none|tbd|not\s+available|undisclosed|various)\s*$'
    -- Attribution / amount / date artifacts (NARROW — a real owning LLC never
    -- carries $, approx, a parenthesized amount, a servicer "OBO", an "X by Y"
    -- broker/mgmt attribution, or a captured date).
    OR p_name ~* '\([^)]*(\$|approx)[^)]*\)'
    OR p_name ~* '\$[0-9]'
    OR p_name ~* '\mapprox\M'
    OR p_name ~* '\mOBO\M'
    OR p_name ~* '\mby\s+\w'
    OR p_name ~* '^\s*since\s+\w'
    OR p_name ~* '\m(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\M'
  );
$$;
