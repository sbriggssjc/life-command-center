-- ============================================================================
-- Round 76az — Loosen dia_auto_merge_property_duplicates tenant matching
--
-- Audit found 37 dup property groups (51 extras) the existing auto-merge
-- skipped because tenant text differed slightly:
--   "Fresenius" vs "Fresenius Medical Care"
--   "DaVita" vs "DaVita Inc"
-- 4 properties at 6411 Chillum Place NW DC all Fresenius dialysis but
-- never collapsed because exact-match comparison saw them as different.
--
-- Switch tenant comparison to first-significant-word of normalize_entity_name —
-- handles chain variations (suffix/prefix) while staying conservative
-- enough to avoid false-merging unrelated tenants.
--
-- Also: wire dia_auto_merge_property_duplicates into the daily
-- lcc_data_hygiene_sweep so any new matcher misses get auto-resolved
-- within 24h.
--
-- First batch run merged 23/0 (failed) of the 37 groups, leaving 27
-- residual that have NULL state or different chain leaders (need
-- human review via v_property_merge_candidates).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.dia_auto_merge_property_duplicates(p_batch_size integer DEFAULT 100)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $function$
DECLARE
  v_pair RECORD;
  v_merged INTEGER := 0;
  v_failed INTEGER := 0;
BEGIN
  FOR v_pair IN
    WITH sg AS (
      SELECT dia_normalize_state(state) AS ns,
             dia_normalize_address(address) AS na
      FROM properties
      WHERE address IS NOT NULL AND address ~ '\d'
        AND dia_normalize_address(address) NOT IN
            ('dialysis unit', 'tbd', 'n/a', 'unknown', '0', 'null')
      GROUP BY 1, 2 HAVING count(*) > 1
    ),
    sf AS (
      SELECT sg.* FROM sg
      WHERE (
        SELECT count(DISTINCT split_part(normalize_entity_name(coalesce(p.tenant, '')), ' ', 1))
            FILTER (WHERE coalesce(p.tenant, '') <> '')
        FROM properties p
        WHERE dia_normalize_state(p.state) = sg.ns
          AND dia_normalize_address(p.address) = sg.na
      ) <= 1
    ),
    sc AS (
      SELECT sf.ns, sf.na, p.property_id,
        (CASE WHEN p.tenant IS NOT NULL THEN 5 ELSE 0 END +
         CASE WHEN p.building_size > 0 THEN 3 ELSE 0 END +
         CASE WHEN p.year_built IS NOT NULL THEN 2 ELSE 0 END +
         CASE WHEN p.medicare_id IS NOT NULL THEN 4 ELSE 0 END +
         CASE WHEN p.zip_code IS NOT NULL THEN 1 ELSE 0 END +
         (SELECT count(*) FROM sales_transactions s WHERE s.property_id=p.property_id)) AS c
      FROM sf
      JOIN properties p
        ON dia_normalize_state(p.state) = sf.ns
       AND dia_normalize_address(p.address) = sf.na
    ),
    k AS (
      SELECT DISTINCT ON (na, ns) na, ns, property_id AS keep_id
      FROM sc ORDER BY na, ns, c DESC, property_id ASC
    )
    SELECT k.keep_id, s.property_id AS drop_id
    FROM k
    JOIN sc s ON s.na = k.na AND s.ns = k.ns
    WHERE s.property_id <> k.keep_id
    ORDER BY k.keep_id, s.property_id
    LIMIT p_batch_size
  LOOP
    BEGIN
      PERFORM dia_merge_property(v_pair.keep_id, v_pair.drop_id);
      v_merged := v_merged + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      RAISE NOTICE 'merge failed % -> %: %', v_pair.drop_id, v_pair.keep_id, SQLERRM;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'merged', v_merged, 'failed', v_failed,
    'remaining_dup_groups', COALESCE((SELECT count(*) FROM v_property_merge_candidates), 0),
    'ran_at', now()
  );
END;
$function$;

-- The lcc_data_hygiene_sweep extension to call this function is in
-- 20260428250500_dia_round_76az_c_sweep_with_property_merge.sql
