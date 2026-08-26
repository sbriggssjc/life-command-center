-- ============================================================================
-- P134 — expose the duplicate GROUP's member property ids on the merge lane (gov)
--
-- Target: government Supabase (GOV_SUPABASE_URL, ref scknotsqkcheojiaewwh)
--
-- WHY: `v_property_merge_lane` emits ONE representative row per duplicate group.
-- Every consumer that needs to compare the group's members (the P134 Ollama
-- clean-assist context enrichment, and any future one) has to re-find them, and
-- re-deriving the grouping OUTSIDE the view drifts: measured live 2026-08-26, a
-- re-fetch by (state, whitespace-collapsed address) returned 150 properties for
-- the 2-member group at "702 w jerome ave, AZ", because the view ALSO excludes
-- `status='archived'` rows and the re-derivation did not. 3 of the 7 live groups
-- were wrong that way. The member ids are already computed inside the view — they
-- are just not exposed, so they are exposed here instead of re-derived.
--
-- ADDITIVE + APPEND-ONLY: `member_property_ids` is added as the LAST column
-- (Postgres 42P16 rejects a column inserted mid-list on CREATE OR REPLACE VIEW).
-- The existing 7 columns and every predicate are byte-identical to the live body.
-- Reversible: re-run the prior definition without the final column.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_property_merge_lane AS
WITH grp AS (
  SELECT p.state,
     lower(TRIM(BOTH FROM regexp_replace(p.address, '\s+'::text, ' '::text, 'g'::text))) AS norm_addr,
     count(*) AS n,
     count(DISTINCT NULLIF(btrim(COALESCE(p.agency, ''::text)), ''::text)) AS distinct_agency,
     count(DISTINCT p.lease_number) FILTER (WHERE p.lease_number IS NOT NULL) AS distinct_nonnull_leases,
     min(p.property_id) AS rep_property_id,
     (array_agg(p.property_id ORDER BY p.property_id))[1:5] AS property_ids,
     min(p.address) AS address,
     min(p.agency) AS agency
    FROM properties p
   WHERE p.address IS NOT NULL
     AND COALESCE(p.status, 'active'::text) <> 'archived'::text
     AND p.address ~ '\d'::text
   GROUP BY p.state, (lower(TRIM(BOTH FROM regexp_replace(p.address, '\s+'::text, ' '::text, 'g'::text))))
  HAVING count(*) > 1
)
SELECT 'duplicate_property_address'::text AS issue_kind,
   rep_property_id::text AS record_id,
   address AS detail_1,
   state AS detail_2,
   agency AS detail_3,
   n::integer AS severity,
   (((((('Genuine duplicate candidate: '::text || n) || ' properties at the same street address, same agency, '::text)
     || 'compatible lease identity. Representative property '::text) || rep_property_id) || '; ids: '::text)
     || array_to_string(property_ids, ', '::text))
     || '. Human picks the surviving record on the Consolidate surface.'::text AS suggested_action,
   -- P134 (appended): the group's member property ids, exactly as the view
   -- itself grouped them. Capped at 5 like `property_ids` above; the lane's own
   -- HAVING already bounds a group at n <= 4, so the cap never truncates a live
   -- group and `severity` remains the honest member count either way.
   property_ids AS member_property_ids
  FROM grp
 WHERE distinct_agency <= 1
   AND distinct_nonnull_leases <= 1
   AND n <= 4;

COMMENT ON VIEW public.v_property_merge_lane IS
  'De-noised genuine-duplicate property candidates, one row per address group. '
  'P134: member_property_ids exposes the group''s members so a consumer never '
  're-derives the grouping (a re-derivation that misses the archived-status '
  'exclusion returns the wrong set).';
