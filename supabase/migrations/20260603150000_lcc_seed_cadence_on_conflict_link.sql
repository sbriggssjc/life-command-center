-- E2E#6 BLOCKER (2026-06-03): bd_opportunity_auto_seed_cadence dies on
-- pre-existing cadences, silently rolling back the whole opportunity insert.
--
-- Chain: bd_opportunities INSERT → bd_opportunity_auto_seed_cadence trigger
-- → lcc_seed_onboarding_cadence() → touchpoint_cadence INSERT →
-- 23505 duplicate key on uq_cadence_contact_property.
--
-- Root cause: lcc_seed_onboarding_cadence's idempotency probe keys on
-- (entity_id, bd_opportunity_id), but the table's unique key is the index
-- uq_cadence_contact_property on
--   (COALESCE(entity_id, zero_uuid),
--    COALESCE(property_id, zero_uuid),
--    COALESCE(sf_contact_id, '')).
-- Any entity that already carries one of the ~305 pre-seeded BD-engine
-- cadence rows (entity_id set, property_id/sf_contact_id NULL, and a
-- DIFFERENT/NULL bd_opportunity_id) is invisible to the probe but collides
-- on the unique index → the seed INSERT raises 23505 → the AFTER-INSERT
-- trigger aborts the parent bd_opportunities INSERT. Blast radius: every
-- entity with a pre-existing cadence row can never get an opportunity via
-- create_lead or open_opportunity — a wide, silent class.
--
-- Fix: add an ON CONFLICT clause to the seed INSERT inferred from the
-- uq_cadence_contact_property index expression (the index is a UNIQUE INDEX,
-- NOT a table constraint, so ON CONFLICT ON CONSTRAINT would error 42704 —
-- we must use the index-inference / expression form). On conflict we
-- REACTIVATE-AND-LINK the pre-existing cadence: point its bd_opportunity_id
-- at the new opportunity, revive phase to 'onboarding', reset the touch
-- counter, and recompute next_touch_due to now() so the pre-existing row
-- becomes the live cadence for the new opportunity.
--
-- Idempotent: CREATE OR REPLACE FUNCTION. DB-only change — safe to apply
-- immediately, independent of any Vercel deploy.

BEGIN;

CREATE OR REPLACE FUNCTION public.lcc_seed_onboarding_cadence(
  p_entity_id         uuid,
  p_contact_id        uuid     DEFAULT NULL,
  p_owner_user_id     uuid     DEFAULT NULL,
  p_bd_opportunity_id uuid     DEFAULT NULL,
  p_domain            text     DEFAULT NULL,
  p_priority_tier     text     DEFAULT 'B'
) RETURNS uuid AS $function$
DECLARE
  v_cadence_id uuid;
  v_step1 record;
  v_domain text;
BEGIN
  -- Canonicalize the vertical (dialysis→dia / government→gov) so the cadence
  -- row matches v_priority_queue_enriched's short-form expectation.
  v_domain := CASE p_domain
                WHEN 'dialysis'   THEN 'dia'
                WHEN 'government' THEN 'gov'
                ELSE p_domain
              END;

  SELECT * INTO v_step1 FROM public.lcc_onboarding_schedule WHERE step_number = 1;

  -- Fast path idempotency: a cadence already linked to THIS (entity, opp).
  SELECT id INTO v_cadence_id
  FROM public.touchpoint_cadence
  WHERE entity_id = p_entity_id
    AND COALESCE(bd_opportunity_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = COALESCE(p_bd_opportunity_id, '00000000-0000-0000-0000-000000000000'::uuid)
  LIMIT 1;

  IF v_cadence_id IS NULL THEN
    -- INSERT, but defend against the uq_cadence_contact_property unique index:
    -- a pre-existing cadence for this entity (property/sf NULL) with a
    -- different/NULL bd_opportunity_id would otherwise raise 23505 and abort
    -- the parent bd_opportunities INSERT. Reactivate-and-link it instead.
    INSERT INTO public.touchpoint_cadence (
      entity_id, contact_id, owner_user_id, bd_opportunity_id, domain,
      priority_tier, phase, current_touch,
      next_touch_due, next_touch_type, next_touch_template
    ) VALUES (
      p_entity_id, p_contact_id, p_owner_user_id, p_bd_opportunity_id, v_domain,
      COALESCE(p_priority_tier, 'B'), 'onboarding', 0,
      now(), v_step1.touch_type, v_step1.template_name
    )
    ON CONFLICT (
      COALESCE(entity_id,   '00000000-0000-0000-0000-000000000000'::uuid),
      COALESCE(property_id, '00000000-0000-0000-0000-000000000000'::uuid),
      COALESCE(sf_contact_id, ''::text)
    ) DO UPDATE SET
      -- Link the pre-existing cadence to the new opportunity (keep the prior
      -- link only when the caller passed no opportunity, e.g. legacy manual seed).
      bd_opportunity_id   = COALESCE(EXCLUDED.bd_opportunity_id, public.touchpoint_cadence.bd_opportunity_id),
      -- Revive from any dormant/terminal phase back into onboarding.
      phase               = 'onboarding',
      current_touch       = 0,
      next_touch_due      = now(),
      next_touch_type     = EXCLUDED.next_touch_type,
      next_touch_template = EXCLUDED.next_touch_template,
      contact_id          = COALESCE(EXCLUDED.contact_id,    public.touchpoint_cadence.contact_id),
      owner_user_id       = COALESCE(EXCLUDED.owner_user_id, public.touchpoint_cadence.owner_user_id),
      domain              = COALESCE(EXCLUDED.domain,        public.touchpoint_cadence.domain),
      priority_tier       = COALESCE(EXCLUDED.priority_tier, public.touchpoint_cadence.priority_tier),
      updated_at          = now()
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
        domain = COALESCE(v_domain, domain),
        priority_tier = COALESCE(p_priority_tier, priority_tier),
        updated_at = now()
    WHERE id = v_cadence_id;
  END IF;

  RETURN v_cadence_id;
END;
$function$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.lcc_seed_onboarding_cadence(uuid, uuid, uuid, uuid, text, text) FROM PUBLIC;

COMMIT;
