-- ============================================================================
-- P143 — lcc_owner_name_has_org_marker missed DOTTED legal forms.
-- Applied live to LCC Opps (xengecqvemvfknjvbvrq) 2026-08-19.
-- ----------------------------------------------------------------------------
-- Found by OPENING the purchase_tier_no_org_marker lane (118 rows) instead of
-- assuming it was all municipalities, which is what its growth pattern suggested.
-- The actual split:
--     37  genuinely municipal / public bodies (City & County of Denver, ...)
--     81  "person-shaped or bare name" -- and most are NOT persons
--
-- Ten of those 81 are limited partnerships whose legal form carries dots:
--     AX Madison Greenway L.P.        Bdc Livermore L.p.
--     Bsp Bluffview, L.p              East Carrillo L.P.
--     HRLP Fayetteville, L.P.         Jppf Hpc, L.p.
--     KEVON OFFICE II, L.P.           MAIN THEATER PLACE, L.P.
--     Sol Westlake, L.p.              Westlake Village Natomas, L.P.
--
-- The function already handled `l\.l\.c` but not `l\.p`. Its other arms are
-- plain words with \m..\M boundaries, so "L.P." never matched \mlp\M -- there is
-- no contiguous "lp" in the string at all. Ten unambiguous organisations were
-- held out of supersession for a punctuation reason.
--
-- ADDED: l.p · l.l.p · p.c · p.a · s.a · n.a (trailing dot optional), plus
-- `co.` and `inc.` which the plain-word arms also miss when a period is the
-- only separator.
--
-- ⚠️ The risk with dotted forms is eating PERSON names with middle initials, so
-- the gate was built from BOTH directions before applying (12/12 live):
--   TRUE  AX Madison Greenway L.P. · Bsp Bluffview, L.p · KEVON OFFICE II, L.P.
--         Jppf Hpc, L.p. · Smith Brothers Co. · Radiology P.C.
--   FALSE Robert C Maslow · Arnold Fisher · John P. Smith · Mohamed E Shahawy
--         Mary P. C. Jones · City and County of Denver
-- "Mary P. C. Jones" is the one that matters: the SPACE in "P. C." keeps it out,
-- so a middle-initial run does not read as a professional corporation.
--
-- LIVE EFFECT: purchase_tier_no_org_marker 118 -> 108; supersede resolved
-- exactly those 10, all tier_source gov_ownership_transition.
--
-- Municipalities are deliberately NOT addressed here. Whether counties are
-- prospects at all is a business call, not a regex one, and "City and County of
-- Denver" correctly remains in review.
--
-- REVERSAL: re-create the function without the second regex arm.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lcc_owner_name_has_org_marker(p_name text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  select coalesce(p_name,'') ~* '(\m(llc|l\.l\.c|inc|incorporated|corp|corporation|company|co|lp|llp|ltd|limited|trust|dst|reit|holdings|properties|property|partners|partnership|realty|capital|group|ventures|associates|enterprises|investments|investment|fund|bank|assn|association|church|center|centre|university|hospital|authority|district|management|equities|estates|development|developers)\M)'
      -- P143: dotted legal forms the plain-word arms cannot see
      or coalesce(p_name,'') ~* '(\m(l\.p|l\.l\.p|p\.c|p\.a|s\.a|n\.a)\.?\M|\mco\.|\minc\.)'
      or coalesce(p_name,'') ~ '[0-9]';
$$;

COMMENT ON FUNCTION public.lcc_owner_name_has_org_marker(text) IS
  'Does this name carry a marker that it is an ORGANISATION rather than a person? '
  'P143 added DOTTED legal forms (l.p, l.l.p, p.c, p.a, s.a, n.a, co., inc.) -- '
  '"AX Madison Greenway L.P." has no contiguous "lp" so \mlp\M never matched it, '
  'and ten real partnerships sat in the supersession review lane for a '
  'punctuation reason. The dotted arm is gated against middle-initial person '
  'names: "Mary P. C. Jones" stays FALSE because of the space in "P. C.".';
