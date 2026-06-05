-- R5 (2026-06-05): SPE->parent reconciliation + buyer-vs-prospect doctrine.
-- File B of two — the open-time GATE, the Government Buyer opportunity type,
-- the P-BUYER queue lane, and the SF-routing sync-health view. Depends on
-- File A (20260605120000) which ships the registry + lcc_resolve_buyer_parent.
--
-- DEPLOY ORDERING: every change here is backward-compatible.
--   * lcc_open_prospect_opportunity keeps its first two output columns
--     (opportunity_id, already_open); the refusal payload is APPENDED
--     (blocked, parent_entity_id, parent_name). Old callers that read only the
--     first two still work, so DB-first or JS-first ordering is both safe.
--   * The BEFORE-INSERT trigger enforces the doctrine even on the direct-insert
--     path (bridgeCreateLead inserts bd_opportunities itself), so a buyer SPE
--     can never receive a prospect opportunity regardless of which JS build is
--     live. bridgeCreateLead already treats an opp-insert failure as non-fatal.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Allow the Government Buyer opportunity type (widening a CHECK is safe).
-- ---------------------------------------------------------------------------
ALTER TABLE public.bd_opportunities DROP CONSTRAINT IF EXISTS bd_opportunities_type_check;
ALTER TABLE public.bd_opportunities
  ADD CONSTRAINT bd_opportunities_type_check
  CHECK (type IS NULL OR type IN ('prospect','buyer','other','government_buyer'));

-- ---------------------------------------------------------------------------
-- 2. The GATE inside lcc_open_prospect_opportunity (backward-compatible).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.lcc_open_prospect_opportunity(uuid,uuid,text,text,text);
CREATE FUNCTION public.lcc_open_prospect_opportunity(
  p_entity_id uuid,
  p_owner_user_id uuid DEFAULT NULL::uuid,
  p_vertical text DEFAULT NULL::text,
  p_source text DEFAULT 'manual'::text,
  p_notes text DEFAULT NULL::text)
RETURNS TABLE(opportunity_id uuid, already_open boolean, blocked text, parent_entity_id uuid, parent_name text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $function$
DECLARE
  v_opp_id uuid;
  v_workspace_id uuid;
  v_existing uuid;
  v_vertical text;
  v_parent_id uuid;
  v_parent_name text;
BEGIN
  -- GATE: a repeat-buyer SPE (or the parent itself) never gets a standard
  -- prospect opportunity — it is a buy-side relationship.
  SELECT r.parent_entity_id, r.parent_name INTO v_parent_id, v_parent_name
  FROM public.lcc_resolve_buyer_parent(p_entity_id) r LIMIT 1;
  IF v_parent_id IS NOT NULL THEN
    opportunity_id := NULL; already_open := false;
    blocked := 'repeat_buyer_spe';
    parent_entity_id := v_parent_id; parent_name := v_parent_name;
    RETURN NEXT; RETURN;
  END IF;

  v_vertical := CASE p_vertical
                  WHEN 'dialysis'   THEN 'dia'
                  WHEN 'government' THEN 'gov'
                  ELSE p_vertical END;

  SELECT workspace_id INTO v_workspace_id
  FROM public.entities WHERE id = p_entity_id AND merged_into_entity_id IS NULL;
  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'lcc_open_prospect_opportunity: entity % not found (or merged)', p_entity_id;
  END IF;

  SELECT id INTO v_existing
  FROM public.bd_opportunities
  WHERE entity_id = p_entity_id AND type = 'prospect' AND is_open = true LIMIT 1;
  IF v_existing IS NOT NULL THEN
    opportunity_id := v_existing; already_open := true;
    blocked := NULL; parent_entity_id := NULL; parent_name := NULL;
    RETURN NEXT; RETURN;
  END IF;

  INSERT INTO public.bd_opportunities
    (workspace_id, entity_id, owner_user_id, vertical, type, stage, opened_at, metadata)
  VALUES (v_workspace_id, p_entity_id, p_owner_user_id, v_vertical, 'prospect', 'identified', now(),
          jsonb_strip_nulls(jsonb_build_object('source', p_source, 'notes', p_notes)))
  RETURNING id INTO v_opp_id;

  opportunity_id := v_opp_id; already_open := false;
  blocked := NULL; parent_entity_id := NULL; parent_name := NULL;
  RETURN NEXT; RETURN;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. DB-side enforcement: block prospect opps on buyer entities on ANY path.
--    Makes the gate deploy-order-proof (covers bridgeCreateLead's direct
--    INSERT, which does not call the RPC).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_block_repeat_buyer_prospect()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public AS $fn$
DECLARE v_parent uuid;
BEGIN
  IF NEW.type = 'prospect' AND NEW.entity_id IS NOT NULL THEN
    SELECT parent_entity_id INTO v_parent
    FROM public.lcc_resolve_buyer_parent(NEW.entity_id) LIMIT 1;
    IF v_parent IS NOT NULL THEN
      RAISE EXCEPTION 'repeat_buyer_spe: entity % reconciles to repeat-buyer parent %; prospect opportunities are blocked (open a government_buyer on the parent)', NEW.entity_id, v_parent
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_bd_block_repeat_buyer_prospect ON public.bd_opportunities;
CREATE TRIGGER trg_bd_block_repeat_buyer_prospect
  BEFORE INSERT ON public.bd_opportunities
  FOR EACH ROW EXECUTE FUNCTION public.lcc_block_repeat_buyer_prospect();

-- ---------------------------------------------------------------------------
-- 4. Government Buyer opportunity — opened ON THE PARENT only, idempotent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_open_government_buyer_opportunity(
  p_entity_id uuid,
  p_owner_user_id uuid DEFAULT NULL::uuid,
  p_source text DEFAULT 'priority_queue'::text)
RETURNS TABLE(opportunity_id uuid, already_open boolean, parent_entity_id uuid,
              parent_name text, needs_sf_mapping boolean, sf_account_id text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $function$
DECLARE
  v_parent uuid;
  v_pname text;
  v_ws uuid;
  v_domain text;
  v_existing uuid;
  v_needs boolean;
  v_sf text;
  v_opp uuid;
BEGIN
  -- Resolve to the PARENT (caller may pass an SPE or the parent itself).
  SELECT r.parent_entity_id, r.parent_name INTO v_parent, v_pname
  FROM public.lcc_resolve_buyer_parent(p_entity_id) r LIMIT 1;
  IF v_parent IS NULL THEN
    RAISE EXCEPTION 'lcc_open_government_buyer_opportunity: % is not a registered repeat-buyer parent or SPE', p_entity_id;
  END IF;

  SELECT bp.domain, bp.needs_sf_mapping, bp.sf_account_id
    INTO v_domain, v_needs, v_sf
  FROM public.lcc_buyer_parents bp WHERE bp.parent_entity_id = v_parent;
  SELECT workspace_id INTO v_ws FROM public.entities WHERE id = v_parent;

  -- Idempotent: one open government_buyer per parent.
  SELECT id INTO v_existing
  FROM public.bd_opportunities
  WHERE entity_id = v_parent AND type = 'government_buyer' AND is_open = true LIMIT 1;
  IF v_existing IS NOT NULL THEN
    opportunity_id := v_existing; already_open := true;
    parent_entity_id := v_parent; parent_name := v_pname;
    needs_sf_mapping := v_needs; sf_account_id := v_sf;
    RETURN NEXT; RETURN;
  END IF;

  INSERT INTO public.bd_opportunities
    (workspace_id, entity_id, owner_user_id, vertical, type, stage, opened_at, metadata)
  VALUES (v_ws, v_parent, p_owner_user_id, v_domain, 'government_buyer', 'identified', now(),
          jsonb_strip_nulls(jsonb_build_object(
            'source', p_source, 'kind', 'government_buyer',
            'opened_from_entity', p_entity_id::text)))
  RETURNING id INTO v_opp;

  opportunity_id := v_opp; already_open := false;
  parent_entity_id := v_parent; parent_name := v_pname;
  needs_sf_mapping := v_needs; sf_account_id := v_sf;
  RETURN NEXT; RETURN;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Priority queue: drop buyer SPEs out of P0.5; add the P-BUYER lane.
--    (Full redefinition — preserves the 17-column shape of every branch.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_priority_queue AS
 WITH entity_effective_role AS (
         SELECT entities.id AS entity_id, entities.workspace_id, entities.name, entities.domain,
            COALESCE(entities.behavioral_override, entities.owner_role) AS effective_owner_role,
            entities.owner_role_confidence, entities.developer_status_active_until,
            entities.user_owner_tier, entities.primary_concern
           FROM entities WHERE entities.merged_into_entity_id IS NULL
        ), open_prospect_opps AS (
         SELECT bd_opportunities.entity_id, count(*) AS open_count,
            min(bd_opportunities.opened_at) AS oldest_open_at,
            array_agg(bd_opportunities.owner_user_id) FILTER (WHERE bd_opportunities.owner_user_id IS NOT NULL) AS owner_user_ids,
            array_agg(bd_opportunities.vertical) FILTER (WHERE bd_opportunities.vertical IS NOT NULL) AS verticals
           FROM bd_opportunities
          WHERE bd_opportunities.is_open = true AND bd_opportunities.type = 'prospect'::text
          GROUP BY bd_opportunities.entity_id
        ), cadence_state AS (
         SELECT touchpoint_cadence.entity_id, touchpoint_cadence.contact_id, touchpoint_cadence.owner_user_id,
            touchpoint_cadence.bd_opportunity_id, touchpoint_cadence.phase, touchpoint_cadence.priority_tier,
            touchpoint_cadence.current_touch, touchpoint_cadence.last_touch_at, touchpoint_cadence.next_touch_due,
            touchpoint_cadence.last_touch_type, touchpoint_cadence.domain AS cadence_domain
           FROM touchpoint_cadence
        ), gov_owner_props AS (
         SELECT eer.entity_id, eer.name, eer.workspace_id, eer.effective_owner_role, eer.owner_role_confidence,
            f.source_domain, f.source_property_id, a.lease_expiration, a.firm_term_remaining,
            a.term_remaining, a.sam_active_opportunities
           FROM entity_effective_role eer
             JOIN lcc_entity_portfolio_facts f ON f.entity_id = eer.entity_id AND f.is_current = true AND f.source_domain = 'gov'::text
             JOIN lcc_property_attributes a ON a.source_domain = f.source_domain AND a.source_property_id = f.source_property_id
          WHERE eer.effective_owner_role = ANY (ARRAY['developer'::text, 'user_owner'::text])
        ), recent_acquirers AS (
         SELECT eer.entity_id, eer.name, eer.workspace_id, eer.domain AS vertical, eer.effective_owner_role,
            eer.owner_role_confidence, count(*) AS recent_acq_count,
            min(f.ownership_start_date) AS earliest_recent_start, max(f.ownership_start_date) AS latest_recent_start
           FROM entity_effective_role eer
             JOIN lcc_entity_portfolio_facts f ON f.entity_id = eer.entity_id AND f.is_current = true
          WHERE (eer.effective_owner_role = ANY (ARRAY['developer'::text, 'user_owner'::text, 'buyer'::text])) AND f.ownership_start_date >= (CURRENT_DATE - '1 year 6 mons'::interval)
          GROUP BY eer.entity_id, eer.name, eer.workspace_id, eer.domain, eer.effective_owner_role, eer.owner_role_confidence
         HAVING count(*) >= 2
        ), aged_props AS (
         SELECT eer.entity_id, eer.name, eer.workspace_id, eer.effective_owner_role, eer.owner_role_confidence,
            f.source_domain, f.source_property_id, a.year_built, a.year_renovated
           FROM entity_effective_role eer
             JOIN lcc_entity_portfolio_facts f ON f.entity_id = eer.entity_id AND f.is_current = true
             JOIN lcc_property_attributes a ON a.source_domain = f.source_domain AND a.source_property_id = f.source_property_id
          WHERE (eer.effective_owner_role = ANY (ARRAY['developer'::text, 'user_owner'::text])) AND a.year_built IS NOT NULL AND a.year_built > 1800 AND a.year_built <= (EXTRACT(year FROM CURRENT_DATE)::integer - 25) AND (a.year_renovated IS NULL OR a.year_renovated <= (EXTRACT(year FROM CURRENT_DATE)::integer - 15))
        )
 SELECT cs.entity_id, eer.name, eer.workspace_id, COALESCE(cs.cadence_domain, eer.domain) AS vertical,
    cs.owner_user_id, cs.contact_id, cs.bd_opportunity_id, 'P0'::text AS priority_band,
    'developer_overdue'::text AS reason, cs.next_touch_due,
    EXTRACT(day FROM now() - cs.next_touch_due)::integer AS days_overdue,
    cs.last_touch_at, cs.last_touch_type, eer.effective_owner_role, eer.owner_role_confidence,
    NULL::text AS source_domain, NULL::text AS source_property_id
   FROM cadence_state cs
     JOIN entity_effective_role eer ON eer.entity_id = cs.entity_id
     JOIN open_prospect_opps opp ON opp.entity_id = cs.entity_id
  WHERE eer.effective_owner_role = 'developer'::text AND cs.next_touch_due IS NOT NULL AND cs.next_touch_due <= now()
UNION ALL
 SELECT eer.entity_id, eer.name, eer.workspace_id, eer.domain AS vertical,
    NULL::uuid, NULL::uuid, NULL::uuid, 'P0.5'::text, 'open_bd_opportunity_needed'::text,
    NULL::timestamp with time zone, NULL::integer, NULL::timestamp with time zone, NULL::text,
    eer.effective_owner_role, eer.owner_role_confidence, NULL::text, NULL::text
   FROM entity_effective_role eer
     LEFT JOIN open_prospect_opps opp ON opp.entity_id = eer.entity_id
  WHERE (eer.effective_owner_role = ANY (ARRAY['developer'::text, 'user_owner'::text]))
    AND opp.entity_id IS NULL
    -- R5: repeat-buyer SPEs leave P0.5 entirely (handled in the P-BUYER lane).
    AND eer.entity_id NOT IN (SELECT entity_id FROM public.v_lcc_buyer_spe_entities)
UNION ALL
 SELECT gop.entity_id, gop.name, gop.workspace_id, 'gov'::text, NULL::uuid, NULL::uuid, NULL::uuid,
    'P1'::text, 'lease_expiry_24mo'::text, NULL::timestamp with time zone,
    EXTRACT(day FROM gop.lease_expiration::timestamp with time zone - now())::integer,
    NULL::timestamp with time zone, NULL::text, gop.effective_owner_role, gop.owner_role_confidence,
    gop.source_domain, gop.source_property_id
   FROM gov_owner_props gop
  WHERE gop.lease_expiration IS NOT NULL AND gop.lease_expiration >= CURRENT_DATE AND gop.lease_expiration <= (CURRENT_DATE + '2 years'::interval)::date
UNION ALL
 SELECT gop.entity_id, gop.name, gop.workspace_id, 'gov'::text, NULL::uuid, NULL::uuid, NULL::uuid,
    'P2'::text, 'firm_term_ending_24mo'::text, NULL::timestamp with time zone, NULL::integer,
    NULL::timestamp with time zone, NULL::text, gop.effective_owner_role, gop.owner_role_confidence,
    gop.source_domain, gop.source_property_id
   FROM gov_owner_props gop
  WHERE gop.firm_term_remaining IS NOT NULL AND gop.firm_term_remaining > 0::numeric AND gop.firm_term_remaining < 2::numeric
UNION ALL
 SELECT gop.entity_id, gop.name, gop.workspace_id, 'gov'::text, NULL::uuid, NULL::uuid, NULL::uuid,
    'P3'::text, 'ten_year_window'::text, NULL::timestamp with time zone, NULL::integer,
    NULL::timestamp with time zone, NULL::text, gop.effective_owner_role, gop.owner_role_confidence,
    gop.source_domain, gop.source_property_id
   FROM gov_owner_props gop
  WHERE gop.term_remaining IS NOT NULL AND gop.term_remaining >= 8::numeric AND gop.term_remaining <= 12::numeric
UNION ALL
 SELECT ra.entity_id, ra.name, ra.workspace_id, ra.vertical, NULL::uuid, NULL::uuid, NULL::uuid,
    'P4'::text, 'recent_acquisition_streak:'::text || ra.recent_acq_count, NULL::timestamp with time zone,
    ra.recent_acq_count::integer, ra.latest_recent_start::timestamp with time zone, 'acquisition'::text,
    ra.effective_owner_role, ra.owner_role_confidence, NULL::text, NULL::text
   FROM recent_acquirers ra
UNION ALL
 SELECT ap.entity_id, ap.name, ap.workspace_id, ap.source_domain AS vertical, NULL::uuid, NULL::uuid, NULL::uuid,
    'P5'::text, 'aged_building_value_add:built_'::text || ap.year_built::text, NULL::timestamp with time zone,
    EXTRACT(year FROM CURRENT_DATE)::integer - ap.year_built, NULL::timestamp with time zone, NULL::text,
    ap.effective_owner_role, ap.owner_role_confidence, ap.source_domain, ap.source_property_id
   FROM aged_props ap
UNION ALL
 SELECT cs.entity_id, eer.name, eer.workspace_id, COALESCE(cs.cadence_domain, eer.domain) AS vertical,
    cs.owner_user_id, cs.contact_id, cs.bd_opportunity_id, 'P6'::text,
    'onboarding_step_due_'::text || COALESCE(cs.current_touch::text, '0'::text), cs.next_touch_due,
    EXTRACT(day FROM now() - cs.next_touch_due)::integer, cs.last_touch_at, cs.last_touch_type,
    eer.effective_owner_role, eer.owner_role_confidence, NULL::text, NULL::text
   FROM cadence_state cs
     JOIN entity_effective_role eer ON eer.entity_id = cs.entity_id
  WHERE cs.phase = 'onboarding'::text AND cs.next_touch_due IS NOT NULL AND cs.next_touch_due <= now()
UNION ALL
 SELECT cs.entity_id, eer.name, eer.workspace_id, COALESCE(cs.cadence_domain, eer.domain) AS vertical,
    cs.owner_user_id, cs.contact_id, cs.bd_opportunity_id, 'P7'::text, 'steady_state_cadence_due'::text,
    cs.next_touch_due, EXTRACT(day FROM now() - cs.next_touch_due)::integer, cs.last_touch_at, cs.last_touch_type,
    eer.effective_owner_role, eer.owner_role_confidence, NULL::text, NULL::text
   FROM cadence_state cs
     JOIN entity_effective_role eer ON eer.entity_id = cs.entity_id
  WHERE COALESCE(cs.phase, 'steady_state'::text) <> 'onboarding'::text AND cs.next_touch_due IS NOT NULL AND cs.next_touch_due <= now() AND NOT (EXISTS ( SELECT 1 FROM open_prospect_opps opp WHERE opp.entity_id = cs.entity_id AND eer.effective_owner_role = 'developer'::text))
UNION ALL
 SELECT gop.entity_id, gop.name, gop.workspace_id, 'gov'::text, NULL::uuid, NULL::uuid, NULL::uuid,
    'P8'::text, 'agency_active_solicitations:'::text || gop.sam_active_opportunities, NULL::timestamp with time zone,
    gop.sam_active_opportunities, NULL::timestamp with time zone, NULL::text, gop.effective_owner_role,
    gop.owner_role_confidence, gop.source_domain, gop.source_property_id
   FROM gov_owner_props gop
  WHERE gop.sam_active_opportunities IS NOT NULL AND gop.sam_active_opportunities > 0
UNION ALL
 -- R5 P-BUYER lane: one row per repeat-buyer PARENT, SPE portfolio rolled up.
 SELECT br.parent_entity_id AS entity_id, pe.name, pe.workspace_id, br.domain AS vertical,
    NULL::uuid, NULL::uuid, NULL::uuid, 'P-BUYER'::text,
    'repeat_buyer_relationship:'::text || br.spe_count, NULL::timestamp with time zone,
    br.spe_count::integer, br.last_acquisition_date::timestamp with time zone, 'acquisition'::text,
    'buyer'::text, NULL::numeric(3,2), NULL::text, NULL::text
   FROM public.v_lcc_buyer_parent_rollup br
     JOIN entities pe ON pe.id = br.parent_entity_id AND pe.merged_into_entity_id IS NULL
  WHERE br.spe_count >= 1;

-- ---------------------------------------------------------------------------
-- 6. Enriched view: append buyer-rollup columns for the P-BUYER lane.
--    (Append-only — preserves the existing column order/positions.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_priority_queue_enriched AS
 SELECT q.entity_id, q.name, q.workspace_id,
        CASE q.vertical WHEN 'dialysis'::text THEN 'dia'::text WHEN 'government'::text THEN 'gov'::text ELSE q.vertical END AS vertical,
    q.owner_user_id, q.contact_id, q.bd_opportunity_id, q.priority_band, q.reason, q.next_touch_due,
    q.days_overdue, q.last_touch_at, q.last_touch_type, q.effective_owner_role, q.owner_role_confidence,
    COALESCE(p.total_property_count, 0::bigint) AS total_property_count,
    COALESCE(p.current_property_count, 0::bigint) AS current_property_count,
    COALESCE(p.dia_property_count, 0::bigint) AS dia_property_count,
    COALESCE(p.gov_property_count, 0::bigint) AS gov_property_count,
    COALESCE(p.is_cross_vertical, false) AS is_cross_vertical,
    p.earliest_acquisition_date, p.latest_acquisition_date, p.latest_disposition_date,
    COALESCE(p.current_annual_rent_total, 0::numeric) AS current_annual_rent_total,
    p.avg_cap_rate,
        CASE q.source_domain WHEN 'dialysis'::text THEN 'dia'::text WHEN 'government'::text THEN 'gov'::text ELSE q.source_domain END AS source_domain,
    q.source_property_id, pa.address AS source_property_address, pa.city AS source_property_city,
    pa.state AS source_property_state, pa.lease_expiration AS source_property_lease_expiration,
    pa.firm_term_remaining AS source_property_firm_term_remaining,
    pa.term_remaining AS source_property_term_remaining,
    -- R5 appended columns (populated only for P-BUYER rows)
    br.spe_count             AS buyer_spe_count,
    br.rollup_property_count AS buyer_rollup_property_count,
    br.rollup_annual_rent    AS buyer_rollup_annual_rent,
    br.last_acquisition_date AS buyer_last_acquisition_date,
    br.sf_account_id         AS buyer_sf_account_id,
    br.needs_sf_mapping      AS buyer_needs_sf_mapping
   FROM v_priority_queue q
     LEFT JOIN v_entity_portfolio_all p ON p.entity_id = q.entity_id
     LEFT JOIN lcc_property_attributes pa ON pa.source_domain = q.source_domain AND pa.source_property_id = q.source_property_id
     LEFT JOIN public.v_lcc_buyer_parent_rollup br ON q.priority_band = 'P-BUYER' AND br.parent_entity_id = q.entity_id
  WHERE q.entity_id IS NOT NULL AND
        CASE q.vertical WHEN 'dialysis'::text THEN 'dia'::text WHEN 'government'::text THEN 'gov'::text ELSE q.vertical END IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 7. SF opportunity-sync health for Government Buyer opps.
--    The sync path must route to the mapped PARENT sf_account_id; unmapped
--    parents HOLD (do not sync) and surface here.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_lcc_government_buyer_sync_health
WITH (security_invoker = true) AS
SELECT o.id AS opportunity_id, o.entity_id AS parent_entity_id, e.name AS parent_name,
  o.vertical, bp.sf_account_id, o.sf_opp_id, o.opened_at,
  CASE
    WHEN bp.sf_account_id IS NULL THEN 'hold_unmapped'
    WHEN o.sf_opp_id IS NULL       THEN 'ready_to_sync'
    ELSE 'synced'
  END AS sync_status
FROM public.bd_opportunities o
JOIN public.entities e ON e.id = o.entity_id
LEFT JOIN public.lcc_buyer_parents bp ON bp.parent_entity_id = o.entity_id
WHERE o.type = 'government_buyer' AND o.is_open = true;

GRANT SELECT ON public.v_lcc_government_buyer_sync_health TO authenticated;

COMMIT;
