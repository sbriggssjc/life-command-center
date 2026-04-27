-- ============================================================================
-- Migration: align dia property merge with the JS normalizeAddress logic.
--
-- Target: dialysis Supabase (DIA_SUPABASE_URL)
--
-- Why: Round 76m fixed upsertDomainProperty so it now stores the
-- *normalized* form (e.g. "599 ct st") instead of the raw form
-- ("599 Court Street"). But the existing v_property_merge_candidates
-- view + dia_auto_merge_property_duplicates cron group by
-- lower(trim(regexp_replace(address, '\s+', ' '))) — no abbreviation
-- expansion. So a property at "599 Court Street" and another at
-- "599 ct st" appear as DISTINCT groups and never merge.
--
-- Net effect pre-fix: 107 duplicate_property_address issues in
-- v_data_quality_summary that the auto-merge cron can't touch because
-- the format mismatch hides the duplication.
--
-- Fix:
--   1. Add public.dia_normalize_address(text) — SQL mirror of the JS
--      normalizeAddress helper in api/_shared/entity-link.js.
--   2. Replace v_property_merge_candidates to group by the normalized form.
--   3. Replace dia_auto_merge_property_duplicates to group by the same.
--   4. Run the cron function once with a large batch size to clear the
--      backlog now that the normalization unlocks the matches.
-- ============================================================================

-- ─── Step 1: SQL mirror of the JS normalizeAddress helper ─────────────────
-- Mirrors api/_shared/entity-link.js:normalizeAddress. Truncates at the
-- first comma (city/state/zip residue), expands suffix abbreviations,
-- collapses whitespace, lowercases.
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
                          split_part(coalesce(addr, ''), ',', 1),
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
  'SQL mirror of api/_shared/entity-link.js:normalizeAddress. Used by
   v_property_merge_candidates and dia_auto_merge_property_duplicates so
   address format variants (Street/St, Avenue/Ave, Court/Ct, etc.) group
   together for duplicate detection.';

-- ─── Step 2: rebuild v_property_merge_candidates to use normalization ─────
CREATE OR REPLACE VIEW public.v_property_merge_candidates AS
WITH groups AS (
  SELECT
    state,
    dia_normalize_address(address) AS norm_addr,
    array_agg(property_id ORDER BY property_id) AS property_ids,
    count(*) AS dupe_count
  FROM properties
  WHERE address IS NOT NULL
    AND address ~ '\d'
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
   AND g.norm_addr = dia_normalize_address(p.address)
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
  array_agg(s.property_id ORDER BY s.property_id)        FILTER (WHERE s.property_id <> k.keep_id) AS drop_ids,
  array_agg(s.completeness ORDER BY s.property_id)        FILTER (WHERE s.property_id <> k.keep_id) AS drop_completeness_scores
FROM keepers k
JOIN scored s ON s.norm_addr = k.norm_addr AND s.state = k.state
GROUP BY k.keep_id, k.address, k.state, k.tenant, k.medicare_id, k.keep_completeness, k.dupe_count
ORDER BY k.dupe_count DESC, k.address;

COMMENT ON VIEW public.v_property_merge_candidates IS
  'Duplicate-address property groups with a recommended keep_id (highest
   completeness score) and drop_ids. Grouped by dia_normalize_address(address)
   + state so abbreviation variants ("Street"/"St", "Avenue"/"Ave", etc.)
   collapse into a single group. Updated 2026-04-27 (Round 76m followup).';

-- ─── Step 3: rebuild auto-merge cron function to use normalization ────────
CREATE OR REPLACE FUNCTION public.dia_auto_merge_property_duplicates(
  p_batch_size INTEGER DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_pair RECORD;
  v_merged INTEGER := 0;
  v_failed INTEGER := 0;
BEGIN
  FOR v_pair IN
    WITH sg AS (
      SELECT state, dia_normalize_address(address) AS na
      FROM properties
      WHERE address IS NOT NULL AND address ~ '\d'
        AND dia_normalize_address(address) NOT IN
            ('dialysis unit', 'tbd', 'n/a', 'unknown', '0', 'null')
      GROUP BY 1, 2
      HAVING count(*) > 1
    ),
    sf AS (
      SELECT sg.* FROM sg
      WHERE (
        SELECT count(DISTINCT lower(trim(coalesce(p.tenant, '__null__'))))
            FILTER (WHERE coalesce(p.tenant, '') <> '')
        FROM properties p
        WHERE p.state = sg.state
          AND dia_normalize_address(p.address) = sg.na
      ) <= 1
    ),
    sc AS (
      SELECT sf.na, sf.state, p.property_id,
        (CASE WHEN p.tenant IS NOT NULL THEN 5 ELSE 0 END +
         CASE WHEN p.building_size > 0 THEN 3 ELSE 0 END +
         CASE WHEN p.year_built IS NOT NULL THEN 2 ELSE 0 END +
         CASE WHEN p.medicare_id IS NOT NULL THEN 4 ELSE 0 END) AS c
      FROM sf
      JOIN properties p
        ON p.state = sf.state
       AND dia_normalize_address(p.address) = sf.na
    ),
    k AS (
      SELECT DISTINCT ON (na, state) na, state, property_id AS keep_id
      FROM sc ORDER BY na, state, c DESC, property_id ASC
    )
    SELECT k.keep_id, s.property_id AS drop_id
    FROM k
    JOIN sc s ON s.na = k.na AND s.state = k.state
    WHERE s.property_id <> k.keep_id
    ORDER BY k.keep_id, s.property_id
    LIMIT p_batch_size
  LOOP
    BEGIN
      PERFORM dia_merge_property(v_pair.keep_id, v_pair.drop_id);
      v_merged := v_merged + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'merged', v_merged,
    'failed', v_failed,
    'remaining_dup_groups', (SELECT count(*) FROM v_property_merge_candidates),
    'ran_at', now()
  );
END;
$$;

COMMENT ON FUNCTION public.dia_auto_merge_property_duplicates(INTEGER) IS
  'Auto-merge duplicate dia properties whose addresses normalize to the
   same form (state + dia_normalize_address(address)). Skips placeholder
   addresses and groups with multiple distinct tenants. Designed for the
   pg_cron schedule */5 * * * *. Round 76m+ alignment 2026-04-27.';

-- ─── Step 4: drain the existing backlog now that the matches are visible ──
-- Run with a generous batch_size so a single execution clears whatever
-- the normalization unlocked. The pg_cron schedule continues to run
-- every 5 minutes for any future drift.
DO $$
DECLARE
  v_result jsonb;
  v_iter   INT := 0;
BEGIN
  LOOP
    v_iter := v_iter + 1;
    SELECT public.dia_auto_merge_property_duplicates(500) INTO v_result;
    RAISE NOTICE 'auto-merge iteration %: %', v_iter, v_result;
    EXIT WHEN (v_result->>'merged')::int = 0 OR v_iter >= 10;
  END LOOP;
END$$;
