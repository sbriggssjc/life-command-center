-- ===========================================================================
-- Round: create_lead / open_opportunity idempotence + Davita artifact cleanup
-- DB: LCC Opps (xengecqvemvfknjvbvrq)
-- Date: 2026-06-03
--
-- Three fixes from the live BD-loop test (prop dia 26502 / Palestra Properties):
--
--  (b) open_opportunity idempotence + surfaced flag. lcc_open_prospect_opportunity
--      already reused an existing OPEN prospect opportunity rather than opening a
--      duplicate, but its scalar uuid return shape could not tell the caller
--      whether the row was new or reused. It now RETURNS TABLE(opportunity_id,
--      already_open) so the bridge can report already_open on a repeat click.
--      (The create_lead bridge enforces the same guard application-side.)
--
--  (a) Disposition the mis-anchored "Davita" artifact. create_lead anchored the
--      BD opportunity + entity to the OPERATOR (DaVita) instead of the landlord
--      (Palestra Properties) — BD outreach targets landlords, not tenants. Void
--      the opportunity (terminal status + audit note), dormant-ize its
--      auto-seeded cadence (same doctrine as the orphaned seed cadences in
--      20260603130000), and remove the corrupt asset external-identity that
--      points dia property 26502 at the DaVita organization entity.
--
-- All statements are idempotent (re-running is a no-op).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- (b) lcc_open_prospect_opportunity → RETURNS TABLE(opportunity_id, already_open)
-- ---------------------------------------------------------------------------
-- Return type changes, so the existing scalar-returning function must be dropped
-- before re-creating (CREATE OR REPLACE cannot change the return type).
DROP FUNCTION IF EXISTS public.lcc_open_prospect_opportunity(uuid, uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.lcc_open_prospect_opportunity(
  p_entity_id      uuid,
  p_owner_user_id  uuid     DEFAULT NULL,
  p_vertical       text     DEFAULT NULL,
  p_source         text     DEFAULT 'manual',
  p_notes          text     DEFAULT NULL
) RETURNS TABLE(opportunity_id uuid, already_open boolean) AS $$
DECLARE
  v_opp_id uuid;
  v_workspace_id uuid;
  v_existing uuid;
  v_vertical text;
BEGIN
  -- Canonicalize the vertical (dia/gov). NULL and any other value pass through.
  v_vertical := CASE p_vertical
                  WHEN 'dialysis'   THEN 'dia'
                  WHEN 'government' THEN 'gov'
                  ELSE p_vertical
                END;

  SELECT workspace_id INTO v_workspace_id
  FROM public.entities
  WHERE id = p_entity_id
    AND merged_into_entity_id IS NULL;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'lcc_open_prospect_opportunity: entity % not found (or merged)', p_entity_id;
  END IF;

  -- Idempotency (Bug b): if there's already an open prospect opportunity for
  -- this entity, return it flagged already_open instead of opening a duplicate
  -- (which would seed a second cadence).
  SELECT id INTO v_existing
  FROM public.bd_opportunities
  WHERE entity_id = p_entity_id
    AND type = 'prospect'
    AND is_open = true
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    opportunity_id := v_existing;
    already_open   := true;
    RETURN NEXT;
    RETURN;
  END IF;

  -- bd_opportunities doesn't carry dedicated opened_by/source/notes columns;
  -- source/notes ride in metadata jsonb. is_open is generated on (closed_at IS
  -- NULL) so we leave closed_at NULL. stage defaults to 'identified' to match
  -- the create_lead bridge path.
  INSERT INTO public.bd_opportunities (
    workspace_id, entity_id, owner_user_id, vertical, type, stage,
    opened_at, metadata
  ) VALUES (
    v_workspace_id, p_entity_id, p_owner_user_id, v_vertical, 'prospect', 'identified',
    now(),
    jsonb_strip_nulls(jsonb_build_object('source', p_source, 'notes', p_notes))
  )
  RETURNING id INTO v_opp_id;

  opportunity_id := v_opp_id;
  already_open   := false;
  RETURN NEXT;
  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.lcc_open_prospect_opportunity(uuid, uuid, text, text, text) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- (a) Void the mis-anchored Davita BD opportunity for dia property 26502.
--     is_open is GENERATED on (closed_at IS NULL), so stamping closed_at flips
--     it false automatically. Guarded on is_open so a re-run is a no-op.
-- ---------------------------------------------------------------------------
UPDATE public.bd_opportunities o
SET closed_at  = now(),
    closed_won = false,
    stage      = 'closed_lost',
    metadata   = COALESCE(o.metadata, '{}'::jsonb)
                 || jsonb_build_object('void_reason',
                      'mis-anchored to operator (DaVita) instead of landlord (Palestra Properties); voided 2026-06-03 (Bug a)')
WHERE o.type = 'prospect'
  AND o.is_open
  AND o.vertical = 'dia'
  AND o.metadata->>'source_property_id' = '26502'
  AND o.metadata->>'origin' = 'property_flow'
  AND EXISTS (
        SELECT 1 FROM public.entities e
        WHERE e.id = o.entity_id AND e.name ILIKE 'davita%'
      );

-- Disposition its auto-seeded cadence the same way the orphaned seed cadences
-- were handled (20260603130000): terminal 'dormant' phase, cleared next_touch_due
-- (drops it out of every due-based band), audit note. Guarded on phase so a
-- re-run is a no-op.
UPDATE public.touchpoint_cadence c
SET phase          = 'dormant',
    next_touch_due = NULL,
    notes          = COALESCE(c.notes || E'\n', '')
                     || 'voided with mis-anchored DaVita opportunity (dia property 26502); cleared 2026-06-03 (Bug a)',
    updated_at     = now()
WHERE c.phase <> 'dormant'
  AND EXISTS (
        SELECT 1 FROM public.entities e
        WHERE e.id = c.entity_id AND e.name ILIKE 'davita%'
      )
  AND c.bd_opportunity_id IN (
        SELECT o.id FROM public.bd_opportunities o
        WHERE o.vertical = 'dia'
          AND o.metadata->>'source_property_id' = '26502'
          AND o.metadata->>'origin' = 'property_flow'
      );

-- Remove the corrupt asset external-identity that points dia property 26502 at
-- the DaVita organization entity. The asset entity (the landlord side, address
-- "4145 Cass Ave") is the correct anchor; leaving this row would let
-- ensureEntityLink re-resolve the operator org as the property's asset entity.
DELETE FROM public.external_identities ei
USING public.entities e
WHERE ei.entity_id    = e.id
  AND e.name          ILIKE 'davita%'
  AND e.entity_type   = 'organization'
  AND ei.source_system = 'dia'
  AND ei.source_type   = 'asset'
  AND ei.external_id   = '26502';
