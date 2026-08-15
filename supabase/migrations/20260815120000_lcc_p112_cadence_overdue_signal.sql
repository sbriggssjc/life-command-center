-- ============================================================================
-- P112 / BREAK-2 — make "overdue" mean something (2026-08-15)
-- ----------------------------------------------------------------------------
-- The 2026-08-15 panel redesign put a read-only prospecting strip on the
-- property Ownership tab and a cadence cockpit on the owner panel. Both read
-- `touchpoint_cadence`. Measured live, that table said "overdue" on essentially
-- every owner it could say anything about — accurate, and therefore worse than
-- useless. This is the Consumption-Layer failure the doctrine names.
--
-- GROUNDED BASELINE (LCC Opps, 2026-08-15):
--   rows total ......................................... 1,905
--   never touched (last_touch_at IS NULL) .............. 1,728  (91%)
--   due in the FUTURE .................................      24
--   carrying a rep (owner_user_id) ....................       7
--   last_touch_at in the FUTURE (data defect) .........       3
--
-- ROOT CAUSE (Unit B): NOT a single bulk stamp — creation is a steady drip
-- across ~90 days (largest single day 414 rows). The producer gate had a hole:
-- R63's `bdSignalFromFacts` accepted a bare Salesforce IDENTITY as a BD signal.
-- Measured, that one arm carried the entire noise population:
--
--   prospecting cadences ............................... 1,113
--   ... passing ONLY on a bare SF identity .............   930  (84%)
--   ... of those, never touched .......................   897
--   prospecting cadences with an OPEN opportunity .....     0
--   prospecting cadences with value >= $500k floor ....   105
--
-- Salesforce is documented as "minimum-necessary and NOT cleaned by LCC" — a
-- capture surface, not a relationship signal. That arm admitted the SF contact
-- book into a prospecting cadence nobody would ever work.
--
-- This migration is ADDITIVE + REVERSIBLE + DRY-RUN-DEFAULT + IDEMPOTENT.
-- No hard deletes anywhere; every retire is a reversible pause with a reason.
--
-- DEPLOY ORDERING (CLAUDE.md): everything here is additive schema/functions, or
-- a CLAMPING backstop trigger that can only make a write MORE correct. There is
-- no rejecting CHECK, so this is safe to apply BEFORE the JS redeploy. (A true
-- `CHECK (last_touch_at <= now())` is impossible anyway — now() is not
-- immutable, so Postgres rejects it in a CHECK. Hence the trigger form.)
--
-- LCC-Opps only; no dia/gov writes; auth schema untouched.
-- ============================================================================


-- ============================================================================
-- UNIT C — a "last touch" can never be in the future
-- ----------------------------------------------------------------------------
-- 3 rows carried a COMPLETED touch dated up to two months ahead of today (max
-- 2026-10-15). All 3 are `last_touch_type='meeting'` in `steady_state`.
--
-- WRITER FOUND: `lcc_activity_event_advance_cadence` passes
-- `p_logged_at := NEW.occurred_at` with no future guard, and
-- `lcc_advance_onboarding_cadence` writes that straight into `last_touch_at`
-- (and computes `next_touch_due` from it). A calendar meeting SCHEDULED ahead
-- is ingested as a COMPLETED touch. The JS `advanceCadence` is NOT implicated —
-- it always stamps `new Date()`.
--
-- Live blast radius: 78 future-dated `meeting` activity_events across 4
-- entities, so this recurs on every calendar sync until fixed at source.
--
-- Fixed in three layers (defence in depth):
--   1. TRIGGER  — a future-dated event is not a completed touch; skip advance.
--   2. FUNCTION — clamp p_logged_at to now() for any other caller.
--   3. BACKSTOP — a BEFORE trigger on touchpoint_cadence clamps + alerts, so no
--                 write path can silently persist a future last_touch_at again.
-- ============================================================================

-- ── Layer 1: the trigger no longer treats a scheduled event as a completed touch
CREATE OR REPLACE FUNCTION public.lcc_activity_event_advance_cadence()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
  IF COALESCE(NEW.metadata->>'skip_cadence_advance', '') = 'true' THEN
    RETURN NEW;
  END IF;
  IF NEW.category NOT IN ('email','call','meeting') THEN
    RETURN NEW;
  END IF;
  IF NEW.entity_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- P112 Unit C: a FUTURE-dated activity is a SCHEDULED event (a calendar
  -- meeting that has not happened), not a completed touch. Advancing on it
  -- stamped `last_touch_at` into the future and pushed `next_touch_due` a
  -- further quarter out, so a live relationship with a meeting on the calendar
  -- next week rendered as "last touched October, next due January". Skip; the
  -- cadence advances when the touch actually occurs.
  IF NEW.occurred_at IS NOT NULL AND NEW.occurred_at > now() THEN
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
    SELECT * INTO v_cad
    FROM public.touchpoint_cadence
    WHERE contact_id = NEW.entity_id
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
      CASE WHEN v_cad.next_touch_type = 'vm' THEN 'vm' ELSE 'call' END
    WHEN 'meeting' THEN 'meeting'
  END;

  v_matches := (v_cad.next_touch_type = v_logged_touch)
    OR (v_cad.next_touch_type IN ('vm','call') AND v_logged_touch IN ('vm','call'));

  v_email_opened   := NULLIF(NEW.metadata->>'email_opened',   '')::boolean;
  v_email_replied  := NULLIF(NEW.metadata->>'email_replied',  '')::boolean;
  v_call_connected := NULLIF(NEW.metadata->>'call_connected', '')::boolean;
  v_meeting_held   := NULLIF(NEW.metadata->>'meeting_held',   '')::boolean;

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
    BEGIN
      INSERT INTO public.lcc_cadence_advance_failures
        (activity_id, entity_id, cadence_id, sqlstate, err)
      VALUES (NEW.id, NEW.entity_id, v_cad.id, SQLSTATE, SQLERRM);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    RAISE WARNING 'lcc_activity_event_advance_cadence(activity=%): %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$function$;


-- ── Layer 2: clamp inside the single advance owner (protects every caller)
CREATE OR REPLACE FUNCTION public.lcc_advance_onboarding_cadence(
  p_cadence_id uuid,
  p_logged_type text,
  p_logged_at timestamp with time zone DEFAULT now(),
  p_email_opened boolean DEFAULT NULL::boolean,
  p_email_replied boolean DEFAULT NULL::boolean,
  p_call_connected boolean DEFAULT NULL::boolean,
  p_meeting_held boolean DEFAULT NULL::boolean)
 RETURNS TABLE(cadence_id uuid, new_step integer, new_phase text, next_due timestamp with time zone, next_type text, next_template text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- P112 Unit C: a completed touch can never be in the future. Clamp so that no
  -- caller can stamp one, and so `next_touch_due` is measured from when the
  -- touch actually happened rather than from a calendar slot.
  IF p_logged_at IS NULL OR p_logged_at > now() THEN
    p_logged_at := now();
  END IF;

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
$function$;


-- ── Layer 3: universal backstop — clamp + alert, never silently persist
-- Mirrors the dia `census_writer_guard` pattern: the guard lives at the table so
-- EVERY write path is covered, including ones not touched by this round.
CREATE OR REPLACE FUNCTION public.lcc_touchpoint_cadence_future_touch_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.last_touch_at IS NOT NULL AND NEW.last_touch_at > now() THEN
    -- Deduped health alert: one unresolved row per kind, so a repeated bad
    -- writer does not spam the alert table (mirrors lcc_check_cron_health).
    BEGIN
      INSERT INTO public.lcc_health_alerts
        (alert_kind, source, severity, summary, details)
      SELECT 'cadence_future_last_touch',
             'lcc_touchpoint_cadence_future_touch_guard',
             'warn',
             'A writer attempted to stamp a future last_touch_at on touchpoint_cadence; the value was clamped to now().',
             jsonb_build_object(
               'cadence_id', NEW.id,
               'entity_id', NEW.entity_id,
               'attempted_last_touch_at', NEW.last_touch_at,
               'last_touch_type', NEW.last_touch_type)
      WHERE NOT EXISTS (
        SELECT 1 FROM public.lcc_health_alerts a
        WHERE a.alert_kind = 'cadence_future_last_touch' AND a.resolved_at IS NULL);
    EXCEPTION WHEN OTHERS THEN NULL;  -- alerting must never block the write
    END;
    NEW.last_touch_at := now();
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_lcc_cadence_future_touch_guard ON public.touchpoint_cadence;
CREATE TRIGGER trg_lcc_cadence_future_touch_guard
  BEFORE INSERT OR UPDATE ON public.touchpoint_cadence
  FOR EACH ROW EXECUTE FUNCTION public.lcc_touchpoint_cadence_future_touch_guard();


-- ── Unit C correction of the 3 live rows (reversible)
-- The correct values are DERIVED FROM REAL DATA, never invented:
--   last_touch_at  := the entity's most recent PAST email/call/meeting
--   next_touch_due := the entity's next SCHEDULED (future) event, when one
--                     exists — the meeting IS the next touch.
-- Rows with no recoverable past touch are left alone rather than guessed.
CREATE TABLE IF NOT EXISTS public._lcc_p112_future_touch_backup_20260815 (
  id uuid PRIMARY KEY,
  entity_id uuid,
  last_touch_at timestamptz,
  last_touch_type text,
  next_touch_due timestamptz,
  current_touch int,
  backed_up_at timestamptz DEFAULT now()
);

INSERT INTO public._lcc_p112_future_touch_backup_20260815
  (id, entity_id, last_touch_at, last_touch_type, next_touch_due, current_touch)
SELECT c.id, c.entity_id, c.last_touch_at, c.last_touch_type, c.next_touch_due, c.current_touch
FROM public.touchpoint_cadence c
WHERE c.last_touch_at > now()
ON CONFLICT (id) DO NOTHING;

WITH fix AS (
  SELECT c.id,
    (SELECT max(ae.occurred_at) FROM public.activity_events ae
      WHERE ae.entity_id = c.entity_id
        AND ae.category IN ('email','call','meeting')
        AND ae.occurred_at <= now())               AS real_last,
    (SELECT min(ae.occurred_at) FROM public.activity_events ae
      WHERE ae.entity_id = c.entity_id
        AND ae.category IN ('email','call','meeting')
        AND ae.occurred_at > now())                AS next_sched
  FROM public.touchpoint_cadence c
  WHERE c.last_touch_at > now()
)
UPDATE public.touchpoint_cadence c
SET last_touch_at  = fix.real_last,
    next_touch_due = COALESCE(fix.next_sched, c.next_touch_due),
    metadata       = COALESCE(c.metadata, '{}'::jsonb) || jsonb_build_object(
                       'p112_future_touch_corrected_at', now(),
                       'p112_future_touch_prior', c.last_touch_at),
    updated_at     = now()
FROM fix
WHERE c.id = fix.id AND fix.real_last IS NOT NULL;

-- REVERSE Unit C correction:
--   UPDATE public.touchpoint_cadence c
--      SET last_touch_at = b.last_touch_at, next_touch_due = b.next_touch_due,
--          metadata = c.metadata - 'p112_future_touch_corrected_at'
--                                - 'p112_future_touch_prior'
--     FROM public._lcc_p112_future_touch_backup_20260815 b WHERE b.id = c.id;
-- REVERSE Unit C writer fix: re-apply the prior bodies of
--   lcc_activity_event_advance_cadence / lcc_advance_onboarding_cadence and
--   DROP TRIGGER trg_lcc_cadence_future_touch_guard ON public.touchpoint_cadence;


-- ============================================================================
-- UNIT D — the rep (owner_user_id) producer gap
-- ----------------------------------------------------------------------------
-- Only 7 of 1,905 rows carried a rep, so the owner panel's ROE line rendered
-- blank almost everywhere. The prompt's premise was that the assignment "is
-- simply not in the data" and a backfill is a dead end. Re-verified live, that
-- is only PARTLY true:
--   - 0 prospecting cadences have an open bd_opportunity  → confirmed dead end
--   - `lcc_entity_owner_override` has 131 point-person rows, and 30 cadence
--     rows resolve to one → a real, if modest, upstream source
--
-- ⚠️ FOOTGUN (this would have failed on EVERY row): the two columns reference
-- DIFFERENT user tables —
--     lcc_entity_owner_override.owner_user_id -> lcc_users(lcc_user_id)
--     touchpoint_cadence.owner_user_id        -> users(id)
-- and ALL 131 override ids are absent from public.users. Stamping the override
-- id directly would violate the FK every time. The bridge is EMAIL, which
-- resolves cleanly for all 4 team users. That mapping is defined ONCE here so
-- no future writer re-derives it wrongly.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_lcc_entity_point_person AS
SELECT o.entity_id,
       o.owner_user_id                AS lcc_user_id,
       u.id                           AS public_user_id,
       COALESCE(u.display_name, lu.display_name) AS display_name,
       lu.email
FROM public.lcc_entity_owner_override o
JOIN public.lcc_users lu ON lu.lcc_user_id = o.owner_user_id
JOIN public.users u ON lower(btrim(u.email)) = lower(btrim(lu.email))
WHERE o.owner_user_id IS NOT NULL;

COMMENT ON VIEW public.v_lcc_entity_point_person IS
  'P112: entity -> POINT PERSON as a public.users id. Bridges lcc_users(lcc_user_id) to users(id) by email, because touchpoint_cadence.owner_user_id FKs to users(id) while lcc_entity_owner_override FKs to lcc_users. Never stamp the override id directly.';

-- Resolver used by the JS producer at cadence CREATE and ADVANCE time.
CREATE OR REPLACE FUNCTION public.lcc_cadence_point_person(p_entity_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT public_user_id FROM public.v_lcc_entity_point_person
  WHERE entity_id = p_entity_id LIMIT 1;
$function$;

GRANT SELECT ON public.v_lcc_entity_point_person TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lcc_cadence_point_person(uuid) TO anon, authenticated, service_role;

-- Fill-blanks stamp for existing rows (never overwrites an assigned rep).
CREATE OR REPLACE FUNCTION public.lcc_p112_stamp_cadence_point_person(
  p_dry_run boolean DEFAULT true
) RETURNS TABLE(action text, n bigint)
LANGUAGE plpgsql
AS $$
DECLARE v_n bigint;
BEGIN
  SELECT count(*) INTO v_n
  FROM public.touchpoint_cadence c
  JOIN public.v_lcc_entity_point_person p ON p.entity_id = c.entity_id
  WHERE c.owner_user_id IS NULL;

  IF p_dry_run THEN
    RETURN QUERY SELECT 'would_stamp_owner_user_id'::text, v_n; RETURN;
  END IF;

  UPDATE public.touchpoint_cadence c
  SET owner_user_id = p.public_user_id,
      metadata = COALESCE(c.metadata,'{}'::jsonb)
                 || jsonb_build_object('rep_source','entity_owner_override','rep_stamped_at',now()),
      updated_at = now()
  FROM public.v_lcc_entity_point_person p
  WHERE p.entity_id = c.entity_id AND c.owner_user_id IS NULL;

  RETURN QUERY SELECT 'stamped_owner_user_id'::text, v_n;
END;
$$;

-- REVERSE Unit D stamp:
--   UPDATE public.touchpoint_cadence
--      SET owner_user_id = NULL,
--          metadata = metadata - 'rep_source' - 'rep_stamped_at'
--    WHERE metadata->>'rep_source' = 'entity_owner_override';


-- ============================================================================
-- UNIT A — reversible auto-retire of the un-workable cadence population
-- ----------------------------------------------------------------------------
-- Mirrors the TIGHTENED JS gate (`cadence-engine.js::bdSignalFromFacts` +
-- `cadenceReachableFromFacts`) so the producer gate and this sweep agree on
-- what "workable" means — the same discipline R63 established.
--
-- Two retire reasons, BOTH requiring the row was never worked (a touched row
-- carries real history and is never swept, even if it now fails the gate):
--   'no_bd_signal_p112'            — fails the tightened value gate
--   'unreachable_no_contact_method'— passes value, but cannot be contacted
--
-- Reversible: phase='paused' + metadata.pause_reason + prior phase stashed.
-- Never a delete. `lcc_p112_resume_workable_cadences` brings a row back
-- automatically once the owner becomes reachable / earns a signal.
-- ============================================================================

-- ── The SQL mirror of `cadence-engine.js::cadenceReachableFromFacts`.
-- Same three routes as `v_lcc_owner_reachability.reachable_hero_effective` (the
-- definition CLAUDE.md instructs us to quote, and the one the owner-panel hero
-- actually renders):
--   1. the org's own email/phone
--   2. a unified_contacts email on the org
--   3. a linked PERSON with email/phone whose role survives the guards
--
-- ⚠️ The broker-ish role list is duplicated between this function, the SQL
-- `via_person_selectable` arm, and JS `NON_REACHABLE_ROLES`. CLAUDE.md warns
-- that adding a role to one and not the others makes measurement and the UI
-- drift apart — change all three together.
CREATE OR REPLACE FUNCTION public.lcc_entity_cadence_reachable(p_entity_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    EXISTS (SELECT 1 FROM public.entities e
             WHERE e.id = p_entity_id
               AND COALESCE(NULLIF(btrim(e.email),''), NULLIF(btrim(e.phone),'')) IS NOT NULL)
 OR EXISTS (SELECT 1 FROM public.unified_contacts uc
             WHERE uc.entity_id = p_entity_id AND NULLIF(btrim(uc.email),'') IS NOT NULL)
 OR EXISTS (SELECT 1
              FROM public.entity_relationships r
              JOIN public.entities p
                ON p.id = CASE WHEN r.to_entity_id = p_entity_id
                               THEN r.from_entity_id ELSE r.to_entity_id END
             WHERE (r.to_entity_id = p_entity_id OR r.from_entity_id = p_entity_id)
               AND p.entity_type = 'person'
               AND COALESCE(NULLIF(btrim(p.email),''), NULLIF(btrim(p.phone),'')) IS NOT NULL
               AND lower(btrim(COALESCE(r.metadata->>'role',''))) <> ALL (ARRAY[
                     'broker','broker_of_record','listing_broker','purchasing_broker',
                     'l_broker','p_broker','agent','tenant','operator']));
$function$;

GRANT EXECUTE ON FUNCTION public.lcc_entity_cadence_reachable(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.lcc_p112_retire_unworkable_cadences(
  p_dry_run boolean DEFAULT true,
  p_floor   numeric DEFAULT 500000
) RETURNS TABLE(action text, n bigint)
LANGUAGE plpgsql
AS $$
DECLARE
  v_no_signal uuid[];
  v_unreach   uuid[];
BEGIN
  WITH cand AS (
  SELECT c.id,
         c.phase,
         -- tightened BD signal (bare SF identity deliberately NOT an arm)
         (EXISTS (SELECT 1 FROM public.bd_opportunities o
                   WHERE o.entity_id = c.entity_id AND o.is_open)
          OR EXISTS (SELECT 1 FROM public.activity_events ae
                      WHERE ae.entity_id = c.entity_id AND ae.source_type = 'salesforce')
          OR COALESCE((SELECT cv.connected_property_value
                         FROM public.lcc_entity_connected_value cv
                        WHERE cv.entity_id = c.entity_id), 0) >= p_floor
          OR COALESCE((SELECT pf.current_annual_rent_total
                         FROM public.v_entity_portfolio_all pf
                        WHERE pf.entity_id = c.entity_id), 0) >= p_floor
         ) AS has_signal,
         public.lcc_entity_cadence_reachable(c.entity_id) AS reachable
  FROM public.touchpoint_cadence c
  WHERE c.entity_id IS NOT NULL
    AND c.phase NOT IN ('paused','unsubscribed','converted','buy_side')
    -- never sweep a row that was actually worked: no touch, no counters, and
    -- no activity of ANY kind on the entity.
    AND c.last_touch_at IS NULL
    AND COALESCE(c.current_touch,0) = 0
    AND COALESCE(c.emails_sent,0) = 0
    AND COALESCE(c.calls_made,0) = 0
    AND COALESCE(c.meetings_scheduled,0) = 0
    AND NOT EXISTS (SELECT 1 FROM public.activity_events ae WHERE ae.entity_id = c.entity_id)
  )
  SELECT array_agg(id) FILTER (WHERE NOT has_signal),
         array_agg(id) FILTER (WHERE has_signal AND NOT reachable)
    INTO v_no_signal, v_unreach
  FROM cand;

  IF p_dry_run THEN
    RETURN QUERY SELECT 'would_pause_no_bd_signal'::text, COALESCE(array_length(v_no_signal,1),0)::bigint;
    RETURN QUERY SELECT 'would_pause_unreachable'::text,  COALESCE(array_length(v_unreach,1),0)::bigint;
    RETURN QUERY SELECT 'would_keep'::text,
      (SELECT count(*) FROM public.touchpoint_cadence
        WHERE phase NOT IN ('paused','unsubscribed'))
      - COALESCE(array_length(v_no_signal,1),0)
      - COALESCE(array_length(v_unreach,1),0);
    RETURN;
  END IF;

  UPDATE public.touchpoint_cadence
  SET phase = 'paused',
      metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object(
        'pause_reason','no_bd_signal_p112','paused_phase',phase,
        'paused_at',now(),'paused_by','lcc_p112_retire_unworkable_cadences'),
      updated_at = now()
  WHERE id = ANY(COALESCE(v_no_signal, '{}'::uuid[]));
  RETURN QUERY SELECT 'paused_no_bd_signal'::text, COALESCE(array_length(v_no_signal,1),0)::bigint;

  UPDATE public.touchpoint_cadence
  SET phase = 'paused',
      metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object(
        'pause_reason','unreachable_no_contact_method','paused_phase',phase,
        'paused_at',now(),'paused_by','lcc_p112_retire_unworkable_cadences'),
      updated_at = now()
  WHERE id = ANY(COALESCE(v_unreach, '{}'::uuid[]));
  RETURN QUERY SELECT 'paused_unreachable'::text, COALESCE(array_length(v_unreach,1),0)::bigint;
END;
$$;

-- REVERSE the sweep (un-pause everything it paused):
--   UPDATE public.touchpoint_cadence
--      SET phase = COALESCE(metadata->>'paused_phase','prospecting'),
--          metadata = (metadata - 'pause_reason' - 'paused_phase'
--                               - 'paused_at' - 'paused_by'),
--          updated_at = now()
--    WHERE phase = 'paused'
--      AND metadata->>'paused_by' = 'lcc_p112_retire_unworkable_cadences';


-- ── AUTO-RESOLVE: a paused row returns the moment it becomes workable again.
-- This is the doctrine's "auto-retire + auto-resolve" pair: the retire is not a
-- one-way trip, so a genuine target that later earns a contact method or a BD
-- signal re-enters the surface without anyone remembering to look.
CREATE OR REPLACE FUNCTION public.lcc_p112_resume_workable_cadences(
  p_dry_run boolean DEFAULT true,
  p_floor   numeric DEFAULT 500000
) RETURNS TABLE(action text, n bigint)
LANGUAGE plpgsql
AS $$
DECLARE v_ids uuid[];
BEGIN
  SELECT array_agg(c.id) INTO v_ids
  FROM public.touchpoint_cadence c
  WHERE c.phase = 'paused'
    AND c.metadata->>'paused_by' = 'lcc_p112_retire_unworkable_cadences'
    AND c.entity_id IS NOT NULL
    AND (EXISTS (SELECT 1 FROM public.bd_opportunities o
                  WHERE o.entity_id = c.entity_id AND o.is_open)
         OR EXISTS (SELECT 1 FROM public.activity_events ae
                     WHERE ae.entity_id = c.entity_id AND ae.source_type = 'salesforce')
         OR COALESCE((SELECT cv.connected_property_value FROM public.lcc_entity_connected_value cv
                       WHERE cv.entity_id = c.entity_id),0) >= p_floor
         OR COALESCE((SELECT pf.current_annual_rent_total FROM public.v_entity_portfolio_all pf
                       WHERE pf.entity_id = c.entity_id),0) >= p_floor)
    AND public.lcc_entity_cadence_reachable(c.entity_id);

  IF p_dry_run THEN
    RETURN QUERY SELECT 'would_resume'::text, COALESCE(array_length(v_ids,1),0)::bigint; RETURN;
  END IF;

  UPDATE public.touchpoint_cadence
  SET phase = COALESCE(metadata->>'paused_phase','prospecting'),
      -- next touch is due NOW, not at the stale pre-pause date, so a resumed
      -- row surfaces as genuinely actionable rather than instantly "overdue".
      next_touch_due = now(),
      metadata = (COALESCE(metadata,'{}'::jsonb)
                  - 'pause_reason' - 'paused_phase' - 'paused_at' - 'paused_by')
                 || jsonb_build_object('p112_resumed_at', now()),
      updated_at = now()
  WHERE id = ANY(COALESCE(v_ids,'{}'::uuid[]));

  RETURN QUERY SELECT 'resumed'::text, COALESCE(array_length(v_ids,1),0)::bigint;
END;
$$;
