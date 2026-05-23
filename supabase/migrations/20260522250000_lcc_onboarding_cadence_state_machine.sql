-- Topic A6 (audit §11.25): 7-touch onboarding state machine + steady-state graduation.
--
-- touchpoint_cadence already carries phase/current_touch/next_touch_due
-- /next_touch_type/last_touch_* columns. Topic 7 set up the schema; this
-- topic adds the logic that drives those columns through the 7-touch
-- onboarding doctrine ("email → VM → email at 2/4/4/4/4/4 weeks") and
-- the steady-state graduation thereafter.
--
-- Components:
--   1. lcc_onboarding_schedule lookup table — 7 rows defining
--      (step_number, offset_weeks, touch_type, template_name) so the
--      cadence can be tuned without code changes.
--   2. lcc_steady_state_interval_days(p_tier) helper — returns the
--      target interval for tier A/B/C/D.
--   3. lcc_seed_onboarding_cadence(...) — idempotent UPSERT that
--      creates or resets a touchpoint_cadence row to step 0 / due now.
--   4. lcc_advance_onboarding_cadence(...) — increments the step and
--      computes the next due date, or graduates to steady-state once
--      step 7 is logged. Honors unsubscribe_status and consecutive
--      unopened-email stalls (3+ = back off to monthly).
--   5. Trigger lcc_bd_opportunity_auto_seed_cadence — on a new
--      open prospect bd_opportunity row, seeds the onboarding
--      cadence automatically. Operator can still call the function
--      manually for legacy prospects without a SF Opportunity.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Onboarding cadence schedule
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lcc_onboarding_schedule (
  step_number     int     PRIMARY KEY CHECK (step_number BETWEEN 1 AND 7),
  offset_weeks    int     NOT NULL CHECK (offset_weeks >= 0),
  touch_type      text    NOT NULL CHECK (touch_type IN ('email','vm','call','meeting','flyer')),
  template_name   text    NOT NULL,
  notes           text
);

COMMENT ON TABLE public.lcc_onboarding_schedule IS
  '7-touch onboarding cadence per audit §7.2: email→VM alternating, '
  '2 weeks between touch 1 and 2, then 4 weeks between subsequent '
  'touches. offset_weeks is from the previous touch (or from cadence '
  'start for step 1). Edit this table to retune the cadence without '
  'code changes.';

-- Seed the audit's prescribed cadence
INSERT INTO public.lcc_onboarding_schedule (step_number, offset_weeks, touch_type, template_name, notes)
VALUES
  (1, 0, 'email', 'onboarding_email_1_introduction',  'Initial outreach: who we are, why this property fits'),
  (2, 2, 'vm',    'onboarding_vm_2_followup',         'VM referencing email 1'),
  (3, 4, 'email', 'onboarding_email_3_market_color',  'Market intel for their submarket'),
  (4, 4, 'vm',    'onboarding_vm_4_offer_meeting',    'VM offering 15-min market review'),
  (5, 4, 'email', 'onboarding_email_5_comp',          'Recent comparable sale or lease'),
  (6, 4, 'vm',    'onboarding_vm_6_breakup',          'Polite "stopping the loop" VM'),
  (7, 4, 'email', 'onboarding_email_7_graduation',    'Final email; cadence moves to steady-state')
ON CONFLICT (step_number) DO UPDATE SET
  offset_weeks = EXCLUDED.offset_weeks,
  touch_type   = EXCLUDED.touch_type,
  template_name = EXCLUDED.template_name,
  notes = EXCLUDED.notes;

-- ---------------------------------------------------------------------------
-- 2. Steady-state interval helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_steady_state_interval_days(p_tier text)
RETURNS int AS $$
BEGIN
  -- Per audit §7.3 steady-state cadence:
  --   Tier A (top developers): 12/yr ≈ every 30 days
  --   Tier B (mid):             4/yr ≈ every 91 days
  --   Tier C (low):           1-2/yr ≈ every 240 days
  --   Tier D (cold):             1/yr ≈ every 365 days
  RETURN CASE UPPER(COALESCE(p_tier, 'B'))
    WHEN 'A' THEN 30
    WHEN 'B' THEN 91
    WHEN 'C' THEN 240
    WHEN 'D' THEN 365
    ELSE        91
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ---------------------------------------------------------------------------
-- 3. Seed the onboarding cadence (idempotent UPSERT)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_seed_onboarding_cadence(
  p_entity_id         uuid,
  p_contact_id        uuid     DEFAULT NULL,
  p_owner_user_id     uuid     DEFAULT NULL,
  p_bd_opportunity_id uuid     DEFAULT NULL,
  p_domain            text     DEFAULT NULL,
  p_priority_tier     text     DEFAULT 'B'
) RETURNS uuid AS $$
DECLARE
  v_cadence_id uuid;
  v_step1 record;
BEGIN
  SELECT * INTO v_step1 FROM public.lcc_onboarding_schedule WHERE step_number = 1;

  -- Idempotency key: one cadence row per (entity, bd_opportunity) or
  -- (entity) when no opportunity yet. Try the most specific match first.
  SELECT id INTO v_cadence_id
  FROM public.touchpoint_cadence
  WHERE entity_id = p_entity_id
    AND COALESCE(bd_opportunity_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = COALESCE(p_bd_opportunity_id, '00000000-0000-0000-0000-000000000000'::uuid)
  LIMIT 1;

  IF v_cadence_id IS NULL THEN
    INSERT INTO public.touchpoint_cadence (
      entity_id, contact_id, owner_user_id, bd_opportunity_id, domain,
      priority_tier, phase, current_touch,
      next_touch_due, next_touch_type, next_touch_template
    ) VALUES (
      p_entity_id, p_contact_id, p_owner_user_id, p_bd_opportunity_id, p_domain,
      COALESCE(p_priority_tier, 'B'), 'onboarding', 0,
      now(), v_step1.touch_type, v_step1.template_name
    )
    RETURNING id INTO v_cadence_id;
  ELSE
    UPDATE public.touchpoint_cadence
    SET phase = 'onboarding',
        current_touch = 0,
        next_touch_due = now(),
        next_touch_type = v_step1.touch_type,
        next_touch_template = v_step1.template_name,
        contact_id = COALESCE(p_contact_id, contact_id),
        owner_user_id = COALESCE(p_owner_user_id, owner_user_id),
        domain = COALESCE(p_domain, domain),
        priority_tier = COALESCE(p_priority_tier, priority_tier),
        updated_at = now()
    WHERE id = v_cadence_id;
  END IF;

  RETURN v_cadence_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.lcc_seed_onboarding_cadence(uuid, uuid, uuid, uuid, text, text) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 4. Advance the cadence after a touch has been logged
--
-- Behavior:
--   • If unsubscribe_status='unsubscribed': clear next_touch_due, set
--     phase='unsubscribed', no further work.
--   • If current_touch < 7: increment current_touch, look up the NEXT
--     step's offset, set next_touch_due = now() + offset_weeks * 7d,
--     stamp next_touch_type / next_touch_template, bump the counter
--     for the touch_type just logged (email/call/etc.).
--   • If current_touch >= 7: phase='steady_state', next_touch_due =
--     now() + lcc_steady_state_interval_days(priority_tier).
--   • If consecutive_unopened >= 3 on an email branch: back off to
--     90 days instead of the schedule interval, but stay in 'onboarding'
--     so the operator can see it's stalled (Topic A6.5 will add an
--     explicit 'stalled' phase + dashboard).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_advance_onboarding_cadence(
  p_cadence_id      uuid,
  p_logged_type     text,             -- 'email' | 'vm' | 'call' | 'meeting' | 'flyer'
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

  IF v_cad.unsubscribe_status = 'unsubscribed' THEN
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

  -- Adjust counter for the touch type that was just logged
  IF p_logged_type = 'email' AND COALESCE(p_email_opened, false) = false THEN
    v_unopened := v_unopened + 1;
  ELSIF p_logged_type = 'email' AND COALESCE(p_email_opened, false) = true THEN
    v_unopened := 0;
  END IF;

  IF v_new_step >= 8 OR v_cad.phase = 'steady_state' THEN
    -- Graduate to steady-state
    v_new_phase := 'steady_state';
    v_next_due := p_logged_at
      + (public.lcc_steady_state_interval_days(v_cad.priority_tier) || ' days')::interval;
    v_next_type := 'email';
    v_next_template := 'steady_state_check_in';
  ELSE
    -- Within onboarding: look up the NEXT step
    SELECT * INTO v_next FROM public.lcc_onboarding_schedule WHERE step_number = v_new_step + 1;
    v_new_phase := 'onboarding';
    IF v_next.step_number IS NULL THEN
      -- v_new_step IS 7; next would be graduation
      v_next_due := p_logged_at
        + (public.lcc_steady_state_interval_days(v_cad.priority_tier) || ' days')::interval;
      v_next_type := 'email';
      v_next_template := 'steady_state_check_in';
      v_new_phase := 'steady_state';
    ELSE
      v_next_due := p_logged_at + (v_next.offset_weeks * 7 || ' days')::interval;
      v_next_type := v_next.touch_type;
      v_next_template := v_next.template_name;
      -- Stall protection: 3+ unopened emails → push out to 90d
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
      last_touch_template   = next_touch_template,  -- the template we WERE pointing at
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

-- ---------------------------------------------------------------------------
-- 5. Trigger: auto-seed cadence on new open prospect bd_opportunity
--
-- When a SF Opportunity sync writes a new is_open=true, type='prospect'
-- row, fire the onboarding cadence so the operator console immediately
-- shows the entity in P6 (onboarding step due).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_bd_opportunity_auto_seed_cadence()
RETURNS trigger AS $$
DECLARE
  v_entity_role text;
  v_priority_tier text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_open = true AND NEW.type = 'prospect' THEN
      -- Map the entity's owner_role → priority_tier
      SELECT
        CASE COALESCE(behavioral_override, owner_role)
          WHEN 'developer' THEN 'A'
          WHEN 'user_owner' THEN 'B'
          WHEN 'operator' THEN 'C'
          ELSE 'B'
        END
      INTO v_priority_tier
      FROM public.entities
      WHERE id = NEW.entity_id
        AND merged_into_entity_id IS NULL;

      PERFORM public.lcc_seed_onboarding_cadence(
        p_entity_id         := NEW.entity_id,
        p_owner_user_id     := NEW.owner_user_id,
        p_bd_opportunity_id := NEW.id,
        p_domain            := NEW.vertical,
        p_priority_tier     := COALESCE(v_priority_tier, 'B')
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS bd_opportunity_auto_seed_cadence
  ON public.bd_opportunities;

CREATE TRIGGER bd_opportunity_auto_seed_cadence
  AFTER INSERT ON public.bd_opportunities
  FOR EACH ROW
  EXECUTE FUNCTION public.lcc_bd_opportunity_auto_seed_cadence();

COMMENT ON TRIGGER bd_opportunity_auto_seed_cadence ON public.bd_opportunities IS
  'When the SF Opportunity sync writes a new is_open=true, type=prospect '
  'row, automatically seed the 7-touch onboarding cadence so the operator '
  'console immediately surfaces the entity in P6.';

COMMIT;
