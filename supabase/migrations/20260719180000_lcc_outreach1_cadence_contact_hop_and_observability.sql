-- ============================================================================
-- OUTREACH #1 — close the SF-activity → cadence-advance loop (Scott's workflow)
-- Unit 2 (RC3 fix) + observability
-- ----------------------------------------------------------------------------
-- Root cause (grounded live 2026-06-19, receipts in the round write-up):
--   RC3 — the organic-advance trigger lcc_activity_event_advance_cadence
--   resolved a cadence ONLY by NEW.entity_id (+ the R10 Unit-2 asset→owner
--   `owns` hop). It NEVER matched a cadence by contact_id. But the SF activity
--   ingest resolves an event's entity to the SF Contact/Account entity, which
--   is frequently the cadence's CONTACT person (touchpoint_cadence.contact_id),
--   NOT its entity_id (the owner). 22 active cadences carry contact_id <>
--   entity_id, and 6 historical SF outreach events resolved onto an entity that
--   is only a cadence's contact_id — so Scott's SF touch could never advance the
--   owner's cadence.
--
-- This migration adds ONE new lookup tier to the trigger — a cadence whose
-- contact_id = NEW.entity_id — mirroring the existing tiered pattern (single
-- place, conservative). It reproduces the R10 Unit-2 body verbatim (skip-guard,
-- category gate, entity_id tier, bd_opportunity preference, asset→owner owns
-- hop) and appends tier 4 (contact_id) before the advance. The JS reply path
-- (cadence-engine.resolveCadenceForEntity) gets the same tier so the two agree.
--
-- Observability (prompt ask): the trigger's EXCEPTION WHEN OTHERS previously
-- only RAISE WARNING'd — a swallowed throw from lcc_advance_onboarding_cadence
-- was invisible. It now ALSO records the failure in a small bounded table
-- lcc_cadence_advance_failures so a real throw is observable (the activity
-- insert still succeeds — the advance is best-effort, as before).
--
-- Idempotent (CREATE OR REPLACE / IF NOT EXISTS). DB-first safe: the contact
-- tier only ADDS matches, never removes existing behavior; the in-app advance
-- path (advanceCadence, the single advance owner) is untouched. LCC-Opps only;
-- no dia/gov writes; auth schema untouched.
-- ============================================================================

-- Observability: a swallowed advance error is now visible here.
CREATE TABLE IF NOT EXISTS public.lcc_cadence_advance_failures (
  id          bigserial PRIMARY KEY,
  activity_id uuid,
  entity_id   uuid,
  cadence_id  uuid,
  sqlstate    text,
  err         text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

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

  -- 4. OUTREACH #1 (RC3) contact tier: the activity resolved onto the cadence's
  --    CONTACT person (touchpoint_cadence.contact_id), not its owner entity_id.
  --    An SF touch logged against the human at the company must advance the
  --    owner's cadence. This is the precise fix for the entity-mismatch root
  --    cause; reached only when tiers 1-3 found nothing.
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
  -- so the card leaves its band. v_matches is retained for readability; the
  -- advance fn owns the counters either way.
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
    -- OUTREACH #1 observability: make the swallowed throw visible instead of a
    -- WARNING-only no-op. The diagnostic insert is itself guarded so it can
    -- never turn a benign advance failure into a failed activity insert.
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
