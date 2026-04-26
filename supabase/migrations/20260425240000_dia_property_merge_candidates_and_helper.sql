-- ============================================================================
-- Migration: property merge tooling — view + helper function
--
-- Target: dialysis Supabase (DIA_SUPABASE_URL)
--
-- Goal: human-driven merges of duplicate property rows. Auto-merge is too
-- risky because property_id is referenced by ~12 child tables. Each merge
-- repoints FKs from drop_ids → keep_id, then deletes the drop rows.
--
-- Pieces:
--   1. v_property_merge_candidates — lists duplicate-address groups with
--      a recommended `keep_id` (most-complete row) and `drop_ids`.
--   2. dia_merge_property(keep_id, drop_id) — executes one merge.
--      SECURITY DEFINER — caller must have appropriate role grants.
--      Returns audit JSON: which child tables had how many rows repointed.
--
-- Audit 2026-04-25 found 515 duplicate-address groups (1,061 dup rows).
-- Worst case: "Dialysis Unit" placeholder in NJ used by 8 different
-- property_ids (probably hospital-owned dialysis units).
-- ============================================================================

CREATE OR REPLACE VIEW public.v_property_merge_candidates AS
WITH groups AS (
  SELECT
    state,
    lower(trim(regexp_replace(address, '\s+', ' ', 'g'))) AS norm_addr,
    array_agg(property_id ORDER BY property_id) AS property_ids,
    count(*) AS dupe_count
  FROM properties
  WHERE address IS NOT NULL
  GROUP BY 1, 2
  HAVING count(*) > 1
),
scored AS (
  SELECT
    p.property_id,
    p.address,
    p.city,
    p.state,
    p.tenant,
    p.building_size,
    p.year_built,
    p.medicare_id,
    (CASE WHEN p.tenant IS NOT NULL                  THEN 5 ELSE 0 END +
     CASE WHEN p.building_size > 0                   THEN 3 ELSE 0 END +
     CASE WHEN p.year_built IS NOT NULL              THEN 2 ELSE 0 END +
     CASE WHEN p.medicare_id IS NOT NULL             THEN 4 ELSE 0 END +
     CASE WHEN p.parcel_number IS NOT NULL           THEN 2 ELSE 0 END +
     CASE WHEN p.true_owner_id IS NOT NULL           THEN 3 ELSE 0 END +
     CASE WHEN p.recorded_owner_id IS NOT NULL       THEN 2 ELSE 0 END +
     CASE WHEN p.anchor_rent IS NOT NULL             THEN 2 ELSE 0 END +
     CASE WHEN p.latitude IS NOT NULL                THEN 1 ELSE 0 END
    ) AS completeness,
    g.dupe_count,
    g.norm_addr
  FROM properties p
  JOIN groups g
    ON g.state    = p.state
   AND g.norm_addr = lower(trim(regexp_replace(p.address, '\s+', ' ', 'g')))
),
keepers AS (
  SELECT DISTINCT ON (norm_addr, state)
    property_id AS keep_id, norm_addr, state,
    completeness AS keep_completeness,
    address, tenant, medicare_id, dupe_count
  FROM scored
  ORDER BY norm_addr, state, completeness DESC, property_id ASC
)
SELECT
  k.keep_id, k.address, k.state, k.tenant, k.medicare_id,
  k.keep_completeness, k.dupe_count,
  array_agg(s.property_id ORDER BY s.property_id) FILTER (WHERE s.property_id <> k.keep_id) AS drop_ids,
  array_agg(s.completeness ORDER BY s.property_id) FILTER (WHERE s.property_id <> k.keep_id) AS drop_completeness_scores
FROM keepers k
JOIN scored s ON s.norm_addr = k.norm_addr AND s.state = k.state
GROUP BY k.keep_id, k.address, k.state, k.tenant, k.medicare_id, k.keep_completeness, k.dupe_count
ORDER BY k.dupe_count DESC, k.address;

COMMENT ON VIEW public.v_property_merge_candidates IS
  'Duplicate-address property groups with a recommended keep_id (highest
   completeness score) and drop_ids. Driven by lower(trim(address)) + state.
   Use for a human-confirmed merge UI — call dia_merge_property() per pair.';

CREATE OR REPLACE FUNCTION public.dia_merge_property(
  p_keep_id INTEGER, p_drop_id INTEGER
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_counts jsonb := '{}'::jsonb;
  v_n      int;
BEGIN
  IF p_keep_id = p_drop_id THEN
    RAISE EXCEPTION 'keep_id and drop_id must differ';
  END IF;

  UPDATE leases               SET property_id = p_keep_id WHERE property_id = p_drop_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;  v_counts := v_counts || jsonb_build_object('leases', v_n);

  UPDATE available_listings   SET property_id = p_keep_id WHERE property_id = p_drop_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;  v_counts := v_counts || jsonb_build_object('available_listings', v_n);

  UPDATE sales_transactions   SET property_id = p_keep_id WHERE property_id = p_drop_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;  v_counts := v_counts || jsonb_build_object('sales_transactions', v_n);

  UPDATE contacts             SET property_id = p_keep_id WHERE property_id = p_drop_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;  v_counts := v_counts || jsonb_build_object('contacts', v_n);

  UPDATE ownership_history    SET property_id = p_keep_id WHERE property_id = p_drop_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;  v_counts := v_counts || jsonb_build_object('ownership_history', v_n);

  BEGIN UPDATE parcel_records             SET property_id = p_keep_id WHERE property_id = p_drop_id;
        GET DIAGNOSTICS v_n = ROW_COUNT;  v_counts := v_counts || jsonb_build_object('parcel_records', v_n);
  EXCEPTION WHEN undefined_table THEN NULL; END;

  BEGIN UPDATE tax_records                SET property_id = p_keep_id WHERE property_id = p_drop_id;
        GET DIAGNOSTICS v_n = ROW_COUNT;  v_counts := v_counts || jsonb_build_object('tax_records', v_n);
  EXCEPTION WHEN undefined_table THEN NULL; END;

  BEGIN UPDATE listing_change_events      SET property_id = p_keep_id WHERE property_id = p_drop_id;
        GET DIAGNOSTICS v_n = ROW_COUNT;  v_counts := v_counts || jsonb_build_object('listing_change_events', v_n);
  EXCEPTION WHEN undefined_table THEN NULL; END;

  BEGIN UPDATE property_public_records    SET property_id = p_keep_id WHERE property_id = p_drop_id;
        GET DIAGNOSTICS v_n = ROW_COUNT;  v_counts := v_counts || jsonb_build_object('property_public_records', v_n);
  EXCEPTION WHEN undefined_table THEN NULL; END;

  DELETE FROM properties WHERE property_id = p_drop_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;  v_counts := v_counts || jsonb_build_object('properties_deleted', v_n);

  RETURN jsonb_build_object('keep_id', p_keep_id, 'drop_id', p_drop_id, 'rewired', v_counts);
END;
$$;

COMMENT ON FUNCTION public.dia_merge_property(INTEGER, INTEGER) IS
  'Merge property p_drop_id into p_keep_id by rewiring all known FK
   children, then deleting p_drop_id from properties. Returns a JSON
   audit log of how many rows were repointed per child table.
   SECURITY DEFINER — caller must have appropriate RLS / role grants.';
