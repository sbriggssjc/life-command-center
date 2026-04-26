-- ============================================================================
-- Migration: automatic property dedup — batch function + pg_cron schedule
--
-- Target: dialysis Supabase (DIA_SUPABASE_URL)
--
-- Runs every 5 minutes via pg_cron. Each invocation merges up to N safe
-- duplicate-address property pairs. Safety filters:
--   - Skip placeholder addresses ("dialysis unit", "tbd", "n/a", "unknown")
--   - Skip groups with multiple distinct tenants (genuine multi-tenant
--     buildings need human review, not auto-merge)
--   - Address must contain a digit (real street addresses do)
-- Picks keep_id by completeness score (tenant > medicare_id > building_size > etc.).
-- Calls dia_merge_property() for each drop_id.
--
-- Designed to clear an existing backlog and prevent future buildup
-- (catches new dupes within 5 minutes of insert).
-- ============================================================================

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
      SELECT state, lower(trim(regexp_replace(address, '\s+', ' ', 'g'))) AS na
      FROM properties WHERE address IS NOT NULL AND address ~ '\d'
        AND lower(trim(regexp_replace(address, '\s+', ' ', 'g'))) NOT IN
            ('dialysis unit', 'tbd', 'n/a', 'unknown', '0', 'null')
      GROUP BY 1, 2 HAVING count(*) > 1
    ),
    sf AS (SELECT sg.* FROM sg WHERE (
      SELECT count(DISTINCT lower(trim(coalesce(p.tenant, '__null__'))))
          FILTER (WHERE coalesce(p.tenant, '') <> '')
      FROM properties p WHERE p.state = sg.state
        AND lower(trim(regexp_replace(p.address, '\s+', ' ', 'g'))) = sg.na
    ) <= 1),
    sc AS (SELECT sf.na, sf.state, p.property_id,
      (CASE WHEN p.tenant IS NOT NULL THEN 5 ELSE 0 END +
       CASE WHEN p.building_size > 0 THEN 3 ELSE 0 END +
       CASE WHEN p.year_built IS NOT NULL THEN 2 ELSE 0 END +
       CASE WHEN p.medicare_id IS NOT NULL THEN 4 ELSE 0 END) AS c
      FROM sf JOIN properties p ON p.state = sf.state
        AND lower(trim(regexp_replace(p.address, '\s+', ' ', 'g'))) = sf.na),
    k AS (SELECT DISTINCT ON (na, state) na, state, property_id AS keep_id
          FROM sc ORDER BY na, state, c DESC, property_id ASC)
    SELECT k.keep_id, s.property_id AS drop_id
    FROM k JOIN sc s ON s.na = k.na AND s.state = k.state
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

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('dia-auto-merge-property-duplicates')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dia-auto-merge-property-duplicates');
    PERFORM cron.schedule(
      'dia-auto-merge-property-duplicates',
      '*/5 * * * *',
      $cron$SELECT public.dia_auto_merge_property_duplicates(50);$cron$
    );
  END IF;
END$$;
