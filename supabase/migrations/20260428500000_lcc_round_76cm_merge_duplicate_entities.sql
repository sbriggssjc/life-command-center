-- ============================================================================
-- Round 76cm — merge 119 duplicate LCC entity rows into 74 canonicals
--
-- Audit found 74 duplicate-address groups across 193 entity rows. Most
-- groups follow the same pattern:
--   - 1 canonical row with clean name + populated metadata (oldest)
--   - 2-10 'property <UUID>' stub rows created on 2026-04-27 with mostly
--     empty metadata (programmatic dedup-broken sync run)
--
-- The duplicates create three real problems:
--   1. Matcher ambiguity — picks any of N entities; activity_events and
--      Copilot memory split across the wrong shells.
--   2. Sidebar comparison shows different "DB" values depending on which
--      duplicate the API resolves first.
--   3. external_identities has parallel links from same dia/gov property_id
--      to different LCC entities, breaking the bridge from Round 76ce.
--
-- Strategy: per group, pick canonical = max(tenants_n + sales_n, then
-- oldest, then alphabetic-named over 'property <UUID>'-named). Migrate
-- all FKs from extras to canonical. Merge metadata (canonical wins on
-- conflicts). Delete extras.
--
-- FK targets to migrate: action_items, activity_events, entity_aliases,
-- entity_relationships (from + to), external_identities, inbox_items,
-- research_tasks, watchers.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lcc_merge_duplicate_entities()
RETURNS TABLE(groups_merged int, extras_removed int)
LANGUAGE plpgsql AS $$
DECLARE
  g int := 0;
  r int := 0;
  rec record;
  v_canonical uuid;
  v_extras uuid[];
BEGIN
  FOR rec IN
    WITH keyed AS (
      SELECT id, name, address, created_at,
             jsonb_array_length(COALESCE(metadata->'tenants','[]'::jsonb)) +
             jsonb_array_length(COALESCE(metadata->'sales_history','[]'::jsonb)) AS richness,
             (name LIKE 'property %') AS is_uuid_named,
             lower(regexp_replace(regexp_replace(address, '\s+', ' ', 'g'),
                                  '[^A-Za-z0-9 ]', '', 'g')) AS addr_key
      FROM public.entities
      WHERE entity_type = 'asset'
        AND address IS NOT NULL
        AND length(trim(address)) > 5
    ),
    ranked AS (
      SELECT *,
             ROW_NUMBER() OVER (PARTITION BY addr_key
                                ORDER BY is_uuid_named ASC,    -- non-UUID names first
                                         richness DESC,         -- more populated first
                                         created_at ASC) AS rn  -- older first
      FROM keyed
    )
    SELECT addr_key,
           (SELECT id FROM ranked WHERE addr_key = r1.addr_key AND rn = 1) AS canonical_id,
           array_agg(id ORDER BY id) FILTER (WHERE rn > 1)                AS extra_ids
    FROM ranked r1
    GROUP BY addr_key
    HAVING COUNT(*) > 1
  LOOP
    v_canonical := rec.canonical_id;
    v_extras    := rec.extra_ids;
    IF v_canonical IS NULL OR v_extras IS NULL OR cardinality(v_extras) = 0 THEN
      CONTINUE;
    END IF;

    -- Migrate FKs. external_identities + activity_events have unique-index
    -- conflicts to handle: drop rows from extras that would collide.
    DELETE FROM public.external_identities
     WHERE entity_id = ANY(v_extras)
       AND (workspace_id, source_system, source_type, external_id) IN (
         SELECT workspace_id, source_system, source_type, external_id
         FROM public.external_identities WHERE entity_id = v_canonical
       );
    UPDATE public.external_identities  SET entity_id = v_canonical WHERE entity_id = ANY(v_extras);

    UPDATE public.activity_events      SET entity_id = v_canonical WHERE entity_id = ANY(v_extras);
    UPDATE public.action_items         SET entity_id = v_canonical WHERE entity_id = ANY(v_extras);
    UPDATE public.entity_aliases       SET entity_id = v_canonical WHERE entity_id = ANY(v_extras);
    UPDATE public.inbox_items          SET entity_id = v_canonical WHERE entity_id = ANY(v_extras);
    UPDATE public.research_tasks       SET entity_id = v_canonical WHERE entity_id = ANY(v_extras);
    UPDATE public.watchers             SET entity_id = v_canonical WHERE entity_id = ANY(v_extras);

    UPDATE public.entity_relationships SET from_entity_id = v_canonical WHERE from_entity_id = ANY(v_extras);
    UPDATE public.entity_relationships SET to_entity_id   = v_canonical WHERE to_entity_id   = ANY(v_extras);

    -- Merge metadata: canonical's keys win on conflicts. Take all extras'
    -- metadata, layer canonical's on top, write back.
    UPDATE public.entities canonical
       SET metadata = COALESCE(merged.combined,'{}'::jsonb) || COALESCE(canonical.metadata,'{}'::jsonb),
           updated_at = now()
      FROM (
        SELECT jsonb_object_agg(key, value) AS combined
          FROM (
            SELECT (jsonb_each(metadata)).key, (jsonb_each(metadata)).value
              FROM public.entities
             WHERE id = ANY(v_extras) AND metadata IS NOT NULL
          ) e
      ) merged
     WHERE canonical.id = v_canonical;

    -- Delete the extras
    DELETE FROM public.entities WHERE id = ANY(v_extras);

    g := g + 1;
    r := r + cardinality(v_extras);
  END LOOP;

  RETURN QUERY SELECT g, r;
END $$;

-- Execute the merge
SELECT * FROM public.lcc_merge_duplicate_entities();
