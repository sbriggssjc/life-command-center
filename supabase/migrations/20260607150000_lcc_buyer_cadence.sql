-- ============================================================================
-- R7 Phase 2.4 — buy-side cadence for repeat-buyer parents (LCC Opps)
-- ============================================================================
-- After "Open Government Buyer" succeeds on a mapped parent, the next action is
-- selecting the prospecting CONTACT, then a BUY-SIDE cadence (showings +
-- buy-side outreach) — NOT the onboarding ladder (R5 deliberately excludes
-- buyer opps from the prospect auto-seed trigger). This adds an explicit
-- buy-side cadence seed, invoked only when a contact is chosen.
--
-- touchpoint_cadence already carries contact_id / sf_contact_id / entity_id /
-- bd_opportunity_id / phase — the right home. We widen the phase vocabulary
-- with 'buy_side' (widening only — deploy-safe) and add lcc_seed_buyer_cadence,
-- which ON CONFLICTs on the real uniqueness (the uq_cadence_contact_property
-- INDEX expression — the E2E#6 gotcha: must use the index-inference form, not a
-- constraint name) so re-selecting a contact relinks the existing row instead
-- of 23505'ing. Additive + idempotent. No auth-schema contact.
-- ============================================================================

ALTER TABLE public.touchpoint_cadence DROP CONSTRAINT IF EXISTS touchpoint_cadence_phase_check;
ALTER TABLE public.touchpoint_cadence ADD CONSTRAINT touchpoint_cadence_phase_check
  CHECK (phase = ANY (ARRAY['prospecting','onboarding','steady_state','maintenance',
                            'paused','dormant','converted','unsubscribed','buy_side']));

CREATE OR REPLACE FUNCTION public.lcc_seed_buyer_cadence(
  p_bd_opportunity_id uuid,
  p_entity_id         uuid,
  p_contact_id        uuid    DEFAULT NULL,
  p_sf_contact_id     text    DEFAULT NULL,
  p_contact_name      text    DEFAULT NULL,
  p_owner_user_id     uuid    DEFAULT NULL,
  p_domain            text    DEFAULT NULL,
  p_interval_days     integer DEFAULT 14
) RETURNS public.touchpoint_cadence
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_row public.touchpoint_cadence;
  v_notes text := 'Buy-side cadence (showings + buy-side outreach)'
                  || COALESCE(' — ' || p_contact_name, '');
BEGIN
  INSERT INTO public.touchpoint_cadence
    (entity_id, bd_opportunity_id, contact_id, sf_contact_id, domain, owner_user_id,
     phase, priority_tier, current_touch, next_touch_due, next_touch_type,
     next_touch_template, unsubscribe_status, notes)
  VALUES
    (p_entity_id, p_bd_opportunity_id, p_contact_id, p_sf_contact_id, p_domain, p_owner_user_id,
     'buy_side', 'A', 0, now(), 'outreach', 'buy_side_intro', 'active', v_notes)
  ON CONFLICT (COALESCE(entity_id,   '00000000-0000-0000-0000-000000000000'::uuid),
               COALESCE(property_id, '00000000-0000-0000-0000-000000000000'::uuid),
               COALESCE(sf_contact_id, ''::text))
  DO UPDATE SET
    bd_opportunity_id = EXCLUDED.bd_opportunity_id,
    contact_id        = EXCLUDED.contact_id,
    domain            = COALESCE(EXCLUDED.domain, public.touchpoint_cadence.domain),
    owner_user_id     = COALESCE(EXCLUDED.owner_user_id, public.touchpoint_cadence.owner_user_id),
    phase             = 'buy_side',
    priority_tier     = 'A',
    next_touch_due    = now(),
    next_touch_type   = 'outreach',
    next_touch_template = 'buy_side_intro',
    unsubscribe_status = CASE WHEN public.touchpoint_cadence.unsubscribe_status='opt_out'
                              THEN 'opt_out' ELSE 'active' END,
    notes             = EXCLUDED.notes,
    updated_at        = now()
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$fn$;
