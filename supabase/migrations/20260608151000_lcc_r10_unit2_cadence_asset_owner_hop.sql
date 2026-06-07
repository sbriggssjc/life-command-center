-- ============================================================================
-- R10 Unit 2 — close the organic loop: asset→owner hop in the advance trigger
-- ----------------------------------------------------------------------------
-- A human touch logged from a property detail page (bridgeLogCall etc.) resolves
-- its entity to the ASSET (sourceType='asset', property_id), but cadences live on
-- the OWNER (person/organization) entity that `owns` the asset. The advance
-- trigger looked the cadence up by NEW.entity_id only, found none on the asset,
-- and no-op'd — so an organic call never advanced the owner's cadence.
--
-- This adds a single fallback hop, implemented in ONE place (the trigger): when
-- no cadence is found on the activity's entity directly, follow the `owns`
-- relationship (owner = from_entity, asset = to_entity) to an active cadence on
-- the owner. Restricted to `owns` (true ownership) to avoid mis-targeting via
-- brokerage / sale-side edges. The skip-guard from Unit 1 still fires first, so
-- JS-owned advances are never double-counted.
--
-- Live-verified acceptance (Unit 2): a call logged on an asset whose owner has a
-- cadence advances that owner's cadence and moves next_touch_due forward.
-- Idempotent (CREATE OR REPLACE). Safe to apply live.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lcc_activity_event_advance_cadence()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_cad record;
  v_logged_touch text;
  v_email_opened boolean;
  v_email_replied boolean;
  v_call_connected boolean;
  v_meeting_held boolean;
  v_matches boolean := false;
BEGIN
  -- R10 Unit 1: JS-owned advances tag their activity so we never double-count.
  IF COALESCE(NEW.metadata->>'skip_cadence_advance', '') = 'true' THEN
    RETURN NEW;
  END IF;

  IF NEW.category NOT IN ('email','call','meeting') THEN
    RETURN NEW;
  END IF;

  IF NEW.entity_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- 1. cadence directly on the activity's entity, preferring the bd_opportunity match
  SELECT * INTO v_cad
  FROM public.touchpoint_cadence
  WHERE entity_id = NEW.entity_id
    AND COALESCE(bd_opportunity_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = COALESCE(NEW.bd_opportunity_id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND phase IN ('onboarding','steady_state','prospecting')
  ORDER BY (CASE WHEN bd_opportunity_id IS NOT NULL THEN 0 ELSE 1 END), updated_at DESC
  LIMIT 1;

  -- 2. any active cadence on the activity's entity
  IF v_cad.id IS NULL THEN
    SELECT * INTO v_cad
    FROM public.touchpoint_cadence
    WHERE entity_id = NEW.entity_id
      AND phase IN ('onboarding','steady_state','prospecting')
    ORDER BY updated_at DESC
    LIMIT 1;
  END IF;

  -- 3. R10 Unit 2 asset→owner hop: the activity is on an asset; follow `owns`
  --    to a cadence on the owner entity. Single place, conservative edge type.
  IF v_cad.id IS NULL THEN
    SELECT tc.* INTO v_cad
    FROM public.entity_relationships er
    JOIN public.touchpoint_cadence tc ON tc.entity_id = er.from_entity_id
    WHERE er.to_entity_id = NEW.entity_id
      AND er.relationship_type = 'owns'
      AND tc.phase IN ('onboarding','steady_state','prospecting')
    ORDER BY tc.updated_at DESC
    LIMIT 1;
  END IF;

  IF v_cad.id IS NULL THEN
    RETURN NEW;
  END IF;

  v_logged_touch := CASE NEW.category::text
    WHEN 'email'   THEN 'email'
    WHEN 'call'    THEN
      CASE WHEN v_cad.next_touch_type = 'vm' THEN 'vm'
           ELSE 'call'
      END
    WHEN 'meeting' THEN 'meeting'
  END;

  v_matches := (v_cad.next_touch_type = v_logged_touch)
    OR (v_cad.next_touch_type IN ('vm','call') AND v_logged_touch IN ('vm','call'));

  v_email_opened   := NULLIF(NEW.metadata->>'email_opened',   '')::boolean;
  v_email_replied  := NULLIF(NEW.metadata->>'email_replied',  '')::boolean;
  v_call_connected := NULLIF(NEW.metadata->>'call_connected', '')::boolean;
  v_meeting_held   := NULLIF(NEW.metadata->>'meeting_held',   '')::boolean;

  -- R10 Unit 2: ANY human touch (matched OR off-sequence) advances + reschedules,
  -- so the card leaves its band. Previously an off-sequence touch only bumped
  -- counters (no reschedule) and the row stayed overdue. v_matches is retained
  -- for readability/diagnostics; the advance fn owns the counters either way.
  PERFORM public.lcc_advance_onboarding_cadence(
    p_cadence_id     := v_cad.id,
    p_logged_type    := v_logged_touch,
    p_logged_at      := NEW.occurred_at,
    p_email_opened   := v_email_opened,
    p_email_replied  := v_email_replied,
    p_call_connected := v_call_connected,
    p_meeting_held   := v_meeting_held
  );

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'lcc_activity_event_advance_cadence(activity=%): %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$function$;
