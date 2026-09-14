-- ============================================================================
-- P134 — expose the duplicate GROUP's member property ids on the merge lane (dia)
--
-- Target: Dialysis_DB Supabase (DIA_SUPABASE_URL, ref zqzrriwuavgrquhisnoa)
--
-- Mirror of the gov migration in this round; same rationale (a consumer that
-- re-derives the group outside the view drifts from the view's own predicates).
-- dia's lane already sits on `v_property_merge_candidates`, which carries
-- keep_id + drop_ids — so the member set is exposed straight from there rather
-- than recomputed.
--
-- ADDITIVE + APPEND-ONLY: `member_property_ids` is the LAST column; the existing
-- 7 columns and every predicate are byte-identical to the live body. Reversible:
-- re-run the prior definition without the final column.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_property_merge_lane AS
WITH genuine AS (
  SELECT dia_normalize_state(p.state::text) AS ns,
     dia_normalize_address(p.address) AS na
    FROM properties p
   WHERE p.address IS NOT NULL AND p.address ~ '\d'::text
   GROUP BY (dia_normalize_state(p.state::text)), (dia_normalize_address(p.address))
  HAVING count(*) > 1
     AND count(*) <= 4
     AND count(*) FILTER (WHERE COALESCE(p.chain_canonical, p.operator, p.tenant::text) IS NULL) = 0
     AND count(DISTINCT lower(NULLIF(btrim(COALESCE(p.chain_canonical, p.operator, p.tenant::text, ''::text)), ''::text)))
           FILTER (WHERE COALESCE(p.chain_canonical, p.operator, p.tenant::text) IS NOT NULL) <= 1
     AND count(DISTINCT p.medicare_id) FILTER (WHERE p.medicare_id IS NOT NULL) <= 1
)
SELECT 'duplicate_property_address'::text AS issue_kind,
   c.keep_id::text AS record_id,
   c.address AS detail_1,
   c.state::text AS detail_2,
   c.tenant AS detail_3,
   c.dupe_count::integer AS severity,
   (((((('Genuine duplicate candidate: '::text || c.dupe_count) || ' properties at the same street address, same '::text)
     || 'operator, compatible CMS identity. Keep '::text) || c.keep_id) || ', drop '::text)
     || array_to_string(COALESCE(c.drop_ids::bigint[], ARRAY[]::bigint[]), ', '::text))
     || '. Human confirms the surviving record on the Consolidate surface.'::text AS suggested_action,
   -- P134 (appended): survivor first, then the drops — the group exactly as the
   -- candidates view resolved it.
   (ARRAY[c.keep_id::bigint] || COALESCE(c.drop_ids::bigint[], ARRAY[]::bigint[])) AS member_property_ids
  FROM v_property_merge_candidates c
  JOIN genuine g ON g.ns = c.state::text AND g.na = dia_normalize_address(c.address);

COMMENT ON VIEW public.v_property_merge_lane IS
  'De-noised genuine-duplicate property candidates, one row per address group. '
  'P134: member_property_ids exposes the group''s members (survivor first) so a '
  'consumer never re-derives the grouping.';
