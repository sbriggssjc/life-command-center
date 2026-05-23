-- Expand touchpoint_cadence check constraints for the §11.25 state machine.
--
-- The original touchpoint_cadence schema (Topic 7) defined
-- phase ∈ {prospecting, maintenance, paused, dormant, converted} and
-- priority_tier ∈ {A, B, C}. The §11.25 onboarding state machine adds
-- 'onboarding' / 'steady_state' / 'unsubscribed' phases and a tier 'D'
-- for cold prospects. Also realigns lcc_advance_onboarding_cadence to
-- use the existing unsubscribe_status='opt_out' value (not the
-- 'unsubscribed' I assumed in 20260522250000).

ALTER TABLE public.touchpoint_cadence
  DROP CONSTRAINT IF EXISTS touchpoint_cadence_phase_check;

ALTER TABLE public.touchpoint_cadence
  ADD CONSTRAINT touchpoint_cadence_phase_check CHECK (
    phase = ANY (ARRAY[
      'prospecting'::text,
      'onboarding'::text,
      'steady_state'::text,
      'maintenance'::text,
      'paused'::text,
      'dormant'::text,
      'converted'::text,
      'unsubscribed'::text
    ])
  );

ALTER TABLE public.touchpoint_cadence
  DROP CONSTRAINT IF EXISTS touchpoint_cadence_priority_tier_check;

ALTER TABLE public.touchpoint_cadence
  ADD CONSTRAINT touchpoint_cadence_priority_tier_check CHECK (
    priority_tier = ANY (ARRAY['A'::text, 'B'::text, 'C'::text, 'D'::text])
  );

-- Realign advance(): existing unsubscribe_status uses 'opt_out', not
-- 'unsubscribed'. The phase 'unsubscribed' that the function sets on
-- opt-out is now allowed by the expanded constraint above.
CREATE OR REPLACE FUNCTION public.lcc_advance_onboarding_cadence(
  p_cadence_id      uuid,
  p_logged_type     text,
  p_logged_at       timestamptz DEFAULT now(),
  p_email_opened    boolean     DEFAULT NULL,
  p_email_replied   boolean     DEFAULT NULL,
  p_call_connected  boolean     DEFAULT NULL,
  p_meeting_held    boolean     DEFAULT NULL
) RETURNS TABLE(
  cadence_id   uuid,
  new_step     int,
  new_phase    text,
  next_due     timestamptz,
  next_type    text,
  next_template text
) AS $$
DECLARE
  v_cad record;
  v_new_step int;
  v_next record;
  v_next_due timestamptz;
  v_next_type text;
  v_next_template text;
  v_new_phase text;
  v_unopened int;
BEGIN
  SELECT * INTO v_cad FROM public.touchpoint_cadence WHERE id = p_cadence_id FOR UPDATE;
  IF v_cad.id IS NULL THEN
    RAISE EXCEPTION 'lcc_advance_onboarding_cadence: cadence % not found', p_cadence_id;
  END IF;

  IF v_cad.unsubscribe_status = 'opt_out' THEN
    UPDATE public.touchpoint_cadence
    SET phase = 'unsubscribed',
        next_touch_due = NULL,
        next_touch_type = NULL,
        next_touch_template = NULL,
        last_touch_at = p_logged_at,
        last_touch_type = p_logged_type,
        updated_at = now()
    WHERE id = p_cadence_id
    RETURNING id, current_touch, phase, next_touch_due, next_touch_type, next_touch_template
    INTO cadence_id, new_step, new_phase, next_due, next_type, next_template;
    RETURN NEXT;
    RETURN;
  END IF;

  v_new_step := COALESCE(v_cad.current_touch, 0) + 1;
  v_unopened := COALESCE(v_cad.consecutive_unopened, 0);

  IF p_logged_type = 'email' AND COALESCE(p_email_opened, false) = false THEN
    v_unopened := v_unopened + 1;
  ELSIF p_logged_type = 'email' AND COALESCE(p_email_opened, false) = true THEN
    v_unopened := 0;
  END IF;

  IF v_new_step >= 8 OR v_cad.phase = 'steady_state' THEN
    v_new_phase := 'steady_state';
    v_next_due := p_logged_at
      + (public.lcc_steady_state_interval_days(v_cad.priority_tier) || ' days')::interval;
    v_next_type := 'email';
    v_next_template := 'steady_state_check_in';
  ELSE
    SELECT * INTO v_next FROM public.lcc_onboarding_schedule WHERE step_number = v_new_step + 1;
    v_new_phase := 'onboarding';
    IF v_next.step_number IS NULL THEN
      v_next_due := p_logged_at
        + (public.lcc_steady_state_interval_days(v_cad.priority_tier) || ' days')::interval;
      v_next_type := 'email';
      v_next_template := 'steady_state_check_in';
      v_new_phase := 'steady_state';
    ELSE
      v_next_due := p_logged_at + (v_next.offset_weeks * 7 || ' days')::interval;
      v_next_type := v_next.touch_type;
      v_next_template := v_next.template_name;
      IF v_unopened >= 3 AND v_next_type = 'email' THEN
        v_next_due := p_logged_at + interval '90 days';
      END IF;
    END IF;
  END IF;

  UPDATE public.touchpoint_cadence
  SET current_touch         = v_new_step,
      phase                 = v_new_phase,
      last_touch_at         = p_logged_at,
      last_touch_type       = p_logged_type,
      last_touch_template   = next_touch_template,
      next_touch_due        = v_next_due,
      next_touch_type       = v_next_type,
      next_touch_template   = v_next_template,
      emails_sent           = emails_sent
        + CASE WHEN p_logged_type = 'email' THEN 1 ELSE 0 END,
      emails_opened         = emails_opened
        + CASE WHEN p_email_opened = true THEN 1 ELSE 0 END,
      emails_replied        = emails_replied
        + CASE WHEN p_email_replied = true THEN 1 ELSE 0 END,
      calls_made            = calls_made
        + CASE WHEN p_logged_type IN ('call','vm') THEN 1 ELSE 0 END,
      calls_connected       = calls_connected
        + CASE WHEN p_call_connected = true THEN 1 ELSE 0 END,
      meetings_scheduled    = meetings_scheduled
        + CASE WHEN p_meeting_held = true THEN 1 ELSE 0 END,
      consecutive_unopened  = v_unopened,
      updated_at            = now()
  WHERE id = p_cadence_id
  RETURNING id, current_touch, phase, next_touch_due, next_touch_type, next_touch_template
  INTO cadence_id, new_step, new_phase, next_due, next_type, next_template;

  RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.lcc_advance_onboarding_cadence(uuid, text, timestamptz, boolean, boolean, boolean, boolean) FROM PUBLIC;
