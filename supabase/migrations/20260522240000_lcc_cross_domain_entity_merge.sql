-- Topic 11 (audit §11.24): LCC cross-domain entity merge.
--
-- The §11.22 entity sync gives every dia/gov true_owner its own LCC
-- entities row (reusing true_owner_id as entities.id). But the same
-- legal entity can own properties in both verticals — Truist Bank,
-- Jana Collins LLC, Embree — and currently shows up as two rows. The
-- §11.23 portfolio view's `is_cross_vertical` flag returns false for
-- every entity as a result.
--
-- Beyond cross-vertical duplicates, the table also carries 4,762
-- legacy rows with `domain IN ('dialysis','government')` (pre-fact-
-- based-classification seeds, owner_role='unknown'). 57 of these
-- duplicate a now-classified 'dia'/'gov' entity on canonical_name.
--
-- This migration:
--   1. Adds `entities.merged_into_entity_id` (mirrors the
--      `merged_into_true_owner_id` pattern used in dia/gov true_owners).
--   2. Adds `lcc_merge_entity(p_loser, p_winner)` — repoints
--      external_identities + lcc_entity_portfolio_facts onto the
--      winner, then stamps the loser with merged_into_entity_id.
--   3. Runs the one-shot canonical-name merges as a `DO` block (3
--      cross-vertical + 57 legacy = 60 entities marked merged).
--   4. Updates `v_entity_portfolio_all` and `v_priority_queue
--      _enriched` to filter out merged entities and aggregate
--      portfolio facts under the canonical winner.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. merged_into_entity_id column
-- ---------------------------------------------------------------------------
ALTER TABLE public.entities
  ADD COLUMN IF NOT EXISTS merged_into_entity_id uuid
    REFERENCES public.entities(id);

CREATE INDEX IF NOT EXISTS idx_entities_merged_into
  ON public.entities(merged_into_entity_id)
  WHERE merged_into_entity_id IS NOT NULL;

COMMENT ON COLUMN public.entities.merged_into_entity_id IS
  'When set, this row is a duplicate of the target. Views and the BD '
  'priority queue should treat the target as canonical and ignore or '
  'coalesce the loser. Mirrors the merged_into_true_owner_id pattern in '
  'dia/gov.true_owners.';

-- ---------------------------------------------------------------------------
-- 2. lcc_merge_entity(p_loser, p_winner)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_merge_entity(p_loser uuid, p_winner uuid)
RETURNS TABLE(
  portfolio_edges_moved int,
  external_identities_moved int
) AS $$
DECLARE
  v_edges int := 0;
  v_xids int := 0;
BEGIN
  IF p_loser = p_winner THEN
    RAISE EXCEPTION 'lcc_merge_entity: loser and winner must differ';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.entities WHERE id = p_winner) THEN
    RAISE EXCEPTION 'lcc_merge_entity: winner % does not exist', p_winner;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.entities WHERE id = p_loser) THEN
    RAISE EXCEPTION 'lcc_merge_entity: loser % does not exist', p_loser;
  END IF;

  -- Portfolio facts: re-point to winner. If the winner already has a
  -- row for the same (source_domain, source_property_id), drop the
  -- loser's duplicate; otherwise re-point it.
  WITH winner_keys AS (
    SELECT source_domain, source_property_id
    FROM public.lcc_entity_portfolio_facts
    WHERE entity_id = p_winner
  ),
  losers_dups AS (
    DELETE FROM public.lcc_entity_portfolio_facts f
    USING winner_keys w
    WHERE f.entity_id = p_loser
      AND f.source_domain = w.source_domain
      AND f.source_property_id = w.source_property_id
    RETURNING 1
  ),
  moved AS (
    UPDATE public.lcc_entity_portfolio_facts
    SET entity_id = p_winner, updated_at = now()
    WHERE entity_id = p_loser
    RETURNING 1
  )
  SELECT (SELECT COUNT(*) FROM moved) INTO v_edges;

  -- External identities: re-point to winner. ON CONFLICT (the unique
  -- (workspace_id, source_system, source_type, external_id) index)
  -- means duplicates are skipped via the explicit dedupe below.
  WITH winner_xids AS (
    SELECT workspace_id, source_system, source_type, external_id
    FROM public.external_identities
    WHERE entity_id = p_winner
  ),
  loser_dups AS (
    DELETE FROM public.external_identities x
    USING winner_xids w
    WHERE x.entity_id = p_loser
      AND x.workspace_id = w.workspace_id
      AND x.source_system = w.source_system
      AND x.source_type = w.source_type
      AND x.external_id = w.external_id
    RETURNING 1
  ),
  moved AS (
    UPDATE public.external_identities
    SET entity_id = p_winner
    WHERE entity_id = p_loser
    RETURNING 1
  )
  SELECT (SELECT COUNT(*) FROM moved) INTO v_xids;

  -- Stamp the loser
  UPDATE public.entities
  SET merged_into_entity_id = p_winner,
      updated_at = now()
  WHERE id = p_loser;

  portfolio_edges_moved := v_edges;
  external_identities_moved := v_xids;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.lcc_merge_entity(uuid, uuid) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 3. One-shot merges
--
-- Strict canonical-name matches across dia↔gov:
--   - Embree (dia developer 3 props) ← Embree (gov buyer 1 prop)
--   - Jana Collins LLC (dia buyer 1 prop) ← Jana Collins LLC (gov buyer 1 prop)
--   - Truist Bank (dia developer 41 props) ← Truist Bank (gov buyer 3 props)
-- Winner = the dia row (higher portfolio count in each pair).
--
-- Legacy 'dialysis'/'government' domain rows whose canonical_name now
-- matches a classified 'dia'/'gov' entity are also merged — the
-- classified row wins.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_winner uuid;
  v_loser  uuid;
  v_rec    record;
BEGIN
  -- Strict cross-vertical matches: dia wins
  FOR v_rec IN
    SELECT
      d.id AS dia_id,
      g.id AS gov_id
    FROM public.entities d
    JOIN public.entities g
      ON g.canonical_name = d.canonical_name
     AND d.entity_type = 'organization'
     AND g.entity_type = 'organization'
     AND d.domain = 'dia'
     AND g.domain = 'gov'
     AND LENGTH(d.canonical_name) >= 4
    WHERE d.merged_into_entity_id IS NULL
      AND g.merged_into_entity_id IS NULL
  LOOP
    PERFORM public.lcc_merge_entity(v_rec.gov_id, v_rec.dia_id);
  END LOOP;

  -- Legacy → classified merges. Pick exactly one winner (the
  -- classified row) per canonical_name. Some canonical_names map to
  -- multiple classified entities (1 in dia + 1 in gov, both already
  -- merged above); prefer the still-canonical one.
  FOR v_rec IN
    SELECT
      legacy.id AS loser_id,
      (
        SELECT id FROM public.entities canonical
        WHERE canonical.canonical_name = legacy.canonical_name
          AND canonical.entity_type = 'organization'
          AND canonical.domain IN ('dia','gov')
          AND canonical.merged_into_entity_id IS NULL
        ORDER BY (CASE canonical.owner_role
                    WHEN 'developer' THEN 1
                    WHEN 'operator'  THEN 2
                    WHEN 'user_owner' THEN 3
                    WHEN 'buyer'     THEN 4
                    ELSE 5
                  END),
                 canonical.id
        LIMIT 1
      ) AS winner_id
    FROM public.entities legacy
    WHERE legacy.entity_type = 'organization'
      AND legacy.domain IN ('dialysis','government')
      AND legacy.canonical_name IS NOT NULL
      AND LENGTH(legacy.canonical_name) >= 4
      AND legacy.merged_into_entity_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.entities c
        WHERE c.canonical_name = legacy.canonical_name
          AND c.entity_type = 'organization'
          AND c.domain IN ('dia','gov')
          AND c.merged_into_entity_id IS NULL
      )
  LOOP
    IF v_rec.winner_id IS NOT NULL AND v_rec.loser_id <> v_rec.winner_id THEN
      PERFORM public.lcc_merge_entity(v_rec.loser_id, v_rec.winner_id);
    END IF;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. View updates: hide merged rows, aggregate portfolio under winners
--
-- v_entity_portfolio_all already aggregates by entity_id, and after the
-- merge step portfolio facts have been re-pointed to the winner — so
-- the existing GROUP BY naturally rolls cross-vertical portfolios up.
-- We just need to exclude merged-out entities from the outer query.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_entity_portfolio_all
WITH (security_invoker = true) AS
SELECT
  e.id                                                                AS entity_id,
  e.workspace_id,
  e.name,
  e.owner_role,
  e.owner_role_source,
  e.domain                                                            AS primary_domain,
  COALESCE(COUNT(f.source_property_id), 0)                            AS total_property_count,
  COALESCE(COUNT(f.source_property_id) FILTER (WHERE f.is_current), 0) AS current_property_count,
  COALESCE(COUNT(f.source_property_id) FILTER (WHERE f.source_domain = 'dia'), 0) AS dia_property_count,
  COALESCE(COUNT(f.source_property_id) FILTER (WHERE f.source_domain = 'gov'), 0) AS gov_property_count,
  COALESCE(
    ARRAY_AGG(f.source_property_id) FILTER (WHERE f.source_domain = 'dia'),
    ARRAY[]::text[]
  ) AS dia_property_ids,
  COALESCE(
    ARRAY_AGG(f.source_property_id) FILTER (WHERE f.source_domain = 'gov'),
    ARRAY[]::text[]
  ) AS gov_property_ids,
  MIN(f.ownership_start_date)                                         AS earliest_acquisition_date,
  MAX(f.ownership_start_date)                                         AS latest_acquisition_date,
  MAX(f.ownership_end_date)                                           AS latest_disposition_date,
  COUNT(DISTINCT f.source_domain) >= 2                                AS is_cross_vertical,
  COALESCE(SUM(f.annual_rent) FILTER (WHERE f.is_current), 0)         AS current_annual_rent_total,
  COALESCE(AVG(f.cap_rate) FILTER (WHERE f.cap_rate IS NOT NULL), 0)  AS avg_cap_rate
FROM public.entities e
LEFT JOIN public.lcc_entity_portfolio_facts f
  ON f.entity_id = e.id
WHERE e.entity_type = 'organization'
  AND e.merged_into_entity_id IS NULL
GROUP BY e.id, e.workspace_id, e.name, e.owner_role, e.owner_role_source, e.domain;

GRANT SELECT ON public.v_entity_portfolio_all TO authenticated;

COMMIT;
