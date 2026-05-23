-- Bugfix (audit §11.31 prep): lcc_merge_entity could throw a PK-conflict
-- error when the loser and winner both had portfolio_facts edges to the
-- SAME (source_domain, source_property_id). The original §11.24
-- implementation packaged the dedupe DELETE and the move UPDATE as
-- concurrent data-modifying CTEs in a single WITH statement — both
-- saw the pre-snapshot state, so the UPDATE tried to write a row that
-- the DELETE's snapshot still had visible, hitting
-- lcc_entity_portfolio_facts_pkey.
--
-- §11.24's strict-canonical-name merges didn't trip this because every
-- loser there was either a legacy 'dialysis'/'government' row with 0
-- portfolio edges or a singleton with no overlap. Fuzzy merge in
-- §11.31 introduces cases like "Davita" (60 props) + "DaVita Inc."
-- (2 props) where the dedupe path actually fires.
--
-- Fix: split the CTE into two sequential statements. Same logic, no
-- concurrency hazard.

BEGIN;

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

  -- Portfolio facts: drop duplicates FIRST (as its own statement), then
  -- move the rest. Two separate statements = no CTE concurrency hazard.
  DELETE FROM public.lcc_entity_portfolio_facts f
  WHERE f.entity_id = p_loser
    AND EXISTS (
      SELECT 1 FROM public.lcc_entity_portfolio_facts w
      WHERE w.entity_id = p_winner
        AND w.source_domain = f.source_domain
        AND w.source_property_id = f.source_property_id
    );

  UPDATE public.lcc_entity_portfolio_facts
  SET entity_id = p_winner, updated_at = now()
  WHERE entity_id = p_loser;
  GET DIAGNOSTICS v_edges = ROW_COUNT;

  -- External identities: same pattern.
  DELETE FROM public.external_identities x
  WHERE x.entity_id = p_loser
    AND EXISTS (
      SELECT 1 FROM public.external_identities w
      WHERE w.entity_id = p_winner
        AND w.workspace_id = x.workspace_id
        AND w.source_system = x.source_system
        AND w.source_type = x.source_type
        AND w.external_id = x.external_id
    );

  UPDATE public.external_identities
  SET entity_id = p_winner
  WHERE entity_id = p_loser;
  GET DIAGNOSTICS v_xids = ROW_COUNT;

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

COMMIT;
