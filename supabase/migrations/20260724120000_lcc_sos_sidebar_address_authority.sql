-- ============================================================================
-- ORE Option B — give the human-in-the-loop SOS-sidebar capture its correct
-- authority in the owner-address observations recorder. LCC Opps
-- (xengecqvemvfknjvbvrq). Additive · reversible.
-- ----------------------------------------------------------------------------
-- The SOS-sidebar capture (extension/content/public-records.js scanSOS → POST
-- /api/sos-writeback) is a HUMAN reading the official state Secretary-of-State
-- filing — an SOS-official, human-verified source. It emits observations with
-- source_surface='sos_sidebar'. The recorder RPC's authority ladder had no case
-- for it, so it fell to the ELSE default (45) — below assessor (50) / costar
-- (55/60), which is wrong for the reconcile engine's "pick the best matchable
-- address" ranking.
--
-- This CREATE OR REPLACE is byte-identical to the Option-A body (migration
-- 20260723123000) EXCEPT for the single added CASE arm giving 'sos_sidebar'
-- authority 70 (the SOS-official tier, same as the AI-inferred 'sos_registry').
--
-- REVERSAL: re-create the function from 20260723123000 (drop the sos_sidebar
-- arm) → zero trace. No table or curated write path is touched.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lcc_record_owner_address_observation(
  p_owner_entity_id          uuid,
  p_owner_name               text,
  p_source_domain            text,
  p_source_recorded_owner_id text,
  p_address                  text,
  p_city                     text,
  p_state                    text,
  p_source_surface           text,
  p_address_kind             text DEFAULT NULL,
  p_confidence               numeric DEFAULT NULL,
  p_source_url               text DEFAULT NULL,
  p_source_context           jsonb DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS
$$
DECLARE
  v_norm text := public.lcc_normalize_address(p_address);
  v_entity uuid := p_owner_entity_id;
  v_matchable boolean := coalesce(lower(p_address_kind), '') <> 'situs';
  v_authority int;
  v_id bigint;
BEGIN
  IF v_norm IS NULL OR p_source_surface IS NULL THEN RETURN NULL; END IF;  -- un-normalizable / no surface → not a linkage observation
  -- Resolve the owner entity by name when not supplied (the same normalized-name
  -- match ensureEntityLink dedupes on) — best-effort, may stay null.
  IF v_entity IS NULL AND nullif(btrim(p_owner_name), '') IS NOT NULL THEN
    SELECT e.id INTO v_entity
    FROM public.entities e
    WHERE e.entity_type = 'organization' AND e.merged_into_entity_id IS NULL
      AND public.lcc_normalize_entity_name(e.name) = public.lcc_normalize_entity_name(p_owner_name)
    ORDER BY e.created_at ASC LIMIT 1;
  END IF;
  v_authority := CASE p_source_surface
    WHEN 'recorded_owner_domain' THEN 90
    WHEN 'deed_grantee'          THEN 80
    WHEN 'deed_grantor'          THEN 80
    WHEN 'sos_registry'          THEN 70
    WHEN 'sos_sidebar'           THEN 70   -- ORE Option B: human-read official SOS filing (SOS-official tier)
    WHEN 'salesforce'            THEN 65
    WHEN 'costar_owner_panel'    THEN 60
    WHEN 'costar_contacts'       THEN 55
    WHEN 'assessor_parcel'       THEN 50
    WHEN 'sales_comp_contact'    THEN 40
    ELSE 45 END;
  INSERT INTO public.lcc_owner_address_observations (
    owner_entity_id, owner_name, source_domain, source_recorded_owner_id,
    address_raw, addr_norm, city, state, source_surface, address_kind,
    matchable, authority, confidence, source_url, source_context)
  VALUES (
    v_entity, nullif(btrim(p_owner_name), ''), nullif(p_source_domain,''),
    nullif(p_source_recorded_owner_id,''),
    btrim(p_address), v_norm, nullif(btrim(p_city),''), nullif(upper(btrim(p_state)),''),
    p_source_surface, nullif(p_address_kind,''), v_matchable, v_authority,
    p_confidence, nullif(p_source_url,''), p_source_context)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
