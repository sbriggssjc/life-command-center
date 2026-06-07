-- ============================================================================
-- R10 Unit 1 — single advance owner: skip-guard on the organic advance trigger
-- ----------------------------------------------------------------------------
-- The 2026-06-07 cadence audit found the loop had never closed. Part of the
-- fix (Unit 1) makes the JS advanceCadence() function the SINGLE owner of the
-- advance: the manual "Log touch" endpoint (api/operations.js
-- bridgeAdvanceCadence) advances the cadence directly AND writes an
-- activity_events row so the touch renders in history.
--
-- Without a guard, that activity_events INSERT would fire the existing
-- AFTER-INSERT trigger lcc_activity_event_advance_cadence and advance the same
-- cadence a SECOND time. This migration teaches the trigger to skip any
-- activity tagged metadata.skip_cadence_advance='true' (the JS writers set this
-- whenever they have already advanced the cadence themselves), so each
-- activity advances the cadence exactly once.
--
-- Deploy ordering: SAFE to apply DB-first. No currently-deployed JS sets the
-- flag, so the guard is a no-op until the Railway redeploy ships the writers.
-- Idempotent (CREATE OR REPLACE).
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
  -- R10 Unit 1: the JS advance owner tags activities it has already accounted
  -- for so this trigger does not double-advance the cadence.
  IF COALESCE(NEW.metadata->>'skip_cadence_advance', '') = 'true' THEN
    RETURN NEW;
  END IF;

  IF NEW.category NOT IN ('email','call','meeting') THEN
    RETURN NEW;
  END IF;

  IF NEW.entity_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_cad
  FROM public.touchpoint_cadence
  WHERE entity_id = NEW.entity_id
    AND COALESCE(bd_opportunity_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = COALESCE(NEW.bd_opportunity_id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND phase IN ('onboarding','steady_state','prospecting')
  ORDER BY (CASE WHEN bd_opportunity_id IS NOT NULL THEN 0 ELSE 1 END), updated_at DESC
  LIMIT 1;

  IF v_cad.id IS NULL THEN
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

  IF v_matches THEN
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
  WHEN OTHERS THEN
    RAISE WARNING 'lcc_activity_event_advance_cadence(activity=%): %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$function$;
