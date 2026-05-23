-- Topic A6.5 (audit §11.26): close the cadence loop.
--
-- §11.25 added the state machine functions but the operator still has to
-- explicitly call lcc_advance_onboarding_cadence() after logging a touch.
-- This topic wires the natural workflow:
--   1. Operator (or some upstream sync) inserts an activity_events row
--      with category IN ('email','call','meeting') and an entity_id.
--   2. Trigger checks whether the entity has a touchpoint_cadence with a
--      next_touch_type that matches the activity. If yes, auto-advance.
--   3. Operator dashboard reads v_bd_cadence_dashboard to see per-cadence
--      state at a glance — phase, step, due/overdue, counters.
--
-- Also adds lcc_open_prospect_opportunity(...) so the operator (or a
-- seed script) can open a bd_opportunity manually, before the SF
-- Opportunity inbound sync ships — this triggers the §11.25 auto-seed
-- of the cadence and lets the full P0.5 → P6 transition be exercised
-- right now.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Activity → cadence auto-advance trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_activity_event_advance_cadence()
RETURNS trigger AS $$
DECLARE
  v_cad record;
  v_logged_touch text;
  v_email_opened boolean;
  v_email_replied boolean;
  v_call_connected boolean;
  v_meeting_held boolean;
  v_matches boolean := false;
BEGIN
  -- Only BD-relevant activity categories
  IF NEW.category NOT IN ('email','call','meeting') THEN
    RETURN NEW;
  END IF;

  IF NEW.entity_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Find the most specific cadence row: prefer (entity, opportunity);
  -- fall back to (entity) when the activity isn't tied to an opportunity.
  SELECT * INTO v_cad
  FROM public.touchpoint_cadence
  WHERE entity_id = NEW.entity_id
    AND COALESCE(bd_opportunity_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = COALESCE(NEW.bd_opportunity_id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND phase IN ('onboarding','steady_state','prospecting')
  ORDER BY (CASE WHEN bd_opportunity_id IS NOT NULL THEN 0 ELSE 1 END), updated_at DESC
  LIMIT 1;

  IF v_cad.id IS NULL THEN
    -- Fall back: any active cadence for the entity, even without an opp link
    SELECT * INTO v_cad
    FROM public.touchpoint_cadence
    WHERE entity_id = NEW.entity_id
      AND phase IN ('onboarding','steady_state','prospecting')
    ORDER BY updated_at DESC
    LIMIT 1;
  END IF;

  IF v_cad.id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Map activity category → cadence touch_type, and check if the cadence
  -- was waiting on this kind of touch. We're permissive — VM and call
  -- both count as a 'call' activity from the operator's logging
  -- perspective; they map to the same cadence touch_type bucket.
  v_logged_touch := CASE NEW.category
    WHEN 'email'   THEN 'email'
    WHEN 'call'    THEN
      CASE WHEN v_cad.next_touch_type = 'vm' THEN 'vm'
           ELSE 'call'
      END
    WHEN 'meeting' THEN 'meeting'
  END;

  v_matches := (v_cad.next_touch_type = v_logged_touch)
    OR (v_cad.next_touch_type IN ('vm','call') AND v_logged_touch IN ('vm','call'));

  -- Optional booleans from metadata jsonb
  v_email_opened   := NULLIF(NEW.metadata->>'email_opened',   '')::boolean;
  v_email_replied  := NULLIF(NEW.metadata->>'email_replied',  '')::boolean;
  v_call_connected := NULLIF(NEW.metadata->>'call_connected', '')::boolean;
  v_meeting_held   := NULLIF(NEW.metadata->>'meeting_held',   '')::boolean;

  IF v_matches THEN
    -- Touch counts toward the cadence — advance the state machine.
    PERFORM public.lcc_advance_onboarding_cadence(
      p_cadence_id     := v_cad.id,
      p_logged_type    := v_logged_touch,
      p_logged_at      := NEW.occurred_at,
      p_email_opened   := v_email_opened,
      p_email_replied  := v_email_replied,
      p_call_connected := v_call_connected,
      p_meeting_held   := v_meeting_held
    );
  ELSE
    -- Off-schedule activity — bump counters but don't change current_touch
    -- (caller may have called an email contact about something else, etc).
    UPDATE public.touchpoint_cadence
    SET emails_sent  = emails_sent
          + CASE WHEN v_logged_touch = 'email' THEN 1 ELSE 0 END,
        emails_opened  = emails_opened
          + CASE WHEN v_email_opened = true THEN 1 ELSE 0 END,
        emails_replied = emails_replied
          + CASE WHEN v_email_replied = true THEN 1 ELSE 0 END,
        calls_made    = calls_made
          + CASE WHEN v_logged_touch IN ('call','vm') THEN 1 ELSE 0 END,
        calls_connected = calls_connected
          + CASE WHEN v_call_connected = true THEN 1 ELSE 0 END,
        meetings_scheduled = meetings_scheduled
          + CASE WHEN v_meeting_held = true THEN 1 ELSE 0 END,
        last_touch_at  = NEW.occurred_at,
        last_touch_type = v_logged_touch,
        updated_at = now()
    WHERE id = v_cad.id;
  END IF;

  RETURN NEW;
EXCEPTION
  -- Never fail the activity_events insert because of cadence wiring; log
  -- and continue. The cadence can be advanced manually if it drifts.
  WHEN OTHERS THEN
    RAISE WARNING 'lcc_activity_event_advance_cadence(activity=%): %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS activity_event_advance_cadence
  ON public.activity_events;

CREATE TRIGGER activity_event_advance_cadence
  AFTER INSERT ON public.activity_events
  FOR EACH ROW
  EXECUTE FUNCTION public.lcc_activity_event_advance_cadence();

COMMENT ON TRIGGER activity_event_advance_cadence ON public.activity_events IS
  'When an operator (or upstream sync) logs an email/call/meeting against '
  'an entity that has an active touchpoint_cadence, advance that cadence '
  'automatically. Off-schedule activity bumps counters but does not change '
  'current_touch.';

-- ---------------------------------------------------------------------------
-- 2. lcc_open_prospect_opportunity helper
--
-- Until the SF inbound sync ships, operators (and seed scripts) need a way
-- to manually open a bd_opportunities row for an entity in P0.5. The
-- §11.25 auto-seed trigger then fires the onboarding cadence.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_open_prospect_opportunity(
  p_entity_id      uuid,
  p_owner_user_id  uuid     DEFAULT NULL,
  p_vertical       text     DEFAULT NULL,
  p_source         text     DEFAULT 'manual',
  p_notes          text     DEFAULT NULL
) RETURNS uuid AS $$
DECLARE
  v_opp_id uuid;
  v_workspace_id uuid;
  v_existing uuid;
BEGIN
  SELECT workspace_id INTO v_workspace_id
  FROM public.entities
  WHERE id = p_entity_id
    AND merged_into_entity_id IS NULL;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'lcc_open_prospect_opportunity: entity % not found (or merged)', p_entity_id;
  END IF;

  -- Idempotency: if there's already an open prospect opportunity for this
  -- entity, return that one — don't create a duplicate that would seed a
  -- second cadence.
  SELECT id INTO v_existing
  FROM public.bd_opportunities
  WHERE entity_id = p_entity_id
    AND type = 'prospect'
    AND is_open = true
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- bd_opportunities doesn't carry dedicated opened_by/source/notes
  -- columns; SF-mirror fields are minimal. Source/notes ride in metadata
  -- jsonb so we don't pollute the canonical column list. is_open is a
  -- generated column on (closed_at IS NULL) so we just leave closed_at
  -- NULL and is_open computes to true automatically.
  INSERT INTO public.bd_opportunities (
    workspace_id, entity_id, owner_user_id, vertical, type,
    opened_at, metadata
  ) VALUES (
    v_workspace_id, p_entity_id, p_owner_user_id, p_vertical, 'prospect',
    now(),
    jsonb_strip_nulls(jsonb_build_object('source', p_source, 'notes', p_notes))
  )
  RETURNING id INTO v_opp_id;

  RETURN v_opp_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.lcc_open_prospect_opportunity(uuid, uuid, text, text, text) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 3. v_bd_cadence_dashboard — per-cadence summary for the operator console
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_bd_cadence_dashboard
WITH (security_invoker = true) AS
SELECT
  c.id                                                AS cadence_id,
  c.entity_id,
  e.name                                              AS entity_name,
  e.owner_role,
  e.workspace_id,
  c.domain,
  c.phase,
  c.priority_tier,
  c.current_touch,
  c.next_touch_due,
  c.next_touch_type,
  c.next_touch_template,
  CASE
    WHEN c.next_touch_due IS NULL THEN NULL
    WHEN c.next_touch_due > now()
      THEN EXTRACT(day FROM c.next_touch_due - now())::int
    ELSE -EXTRACT(day FROM now() - c.next_touch_due)::int
  END                                                 AS days_until_next,
  CASE
    WHEN c.next_touch_due IS NULL THEN 0
    WHEN c.next_touch_due > now() THEN 0
    ELSE EXTRACT(day FROM now() - c.next_touch_due)::int
  END                                                 AS days_overdue,
  c.last_touch_at,
  c.last_touch_type,
  c.last_touch_template,
  c.emails_sent,
  c.emails_opened,
  c.emails_replied,
  c.calls_made,
  c.calls_connected,
  c.meetings_scheduled,
  c.consecutive_unopened,
  c.unsubscribe_status,
  c.bd_opportunity_id,
  c.owner_user_id,
  -- Portfolio context from the §11.23 enriched view
  p.total_property_count,
  p.current_property_count,
  p.is_cross_vertical
FROM public.touchpoint_cadence c
JOIN public.entities e
  ON e.id = c.entity_id
 AND e.merged_into_entity_id IS NULL
LEFT JOIN public.v_entity_portfolio_all p
  ON p.entity_id = c.entity_id;

GRANT SELECT ON public.v_bd_cadence_dashboard TO authenticated;

COMMENT ON VIEW public.v_bd_cadence_dashboard IS
  'Per-cadence operator dashboard: phase, step, days_until_next, '
  'days_overdue, counters, portfolio context. Join target for the '
  'BD operator console rows.';

COMMIT;
