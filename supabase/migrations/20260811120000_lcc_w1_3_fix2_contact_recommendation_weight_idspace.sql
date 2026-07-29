-- ============================================================================
-- W1.3 Fix 2 — get_contact_recommendation_weight ID-space bug (audit finding)
-- Life Command Center (LCC Opps xengecqvemvfknjvbvrq)
-- ----------------------------------------------------------------------------
-- The self-improvement weight function keys on `signals.entity_id`, which stores
-- `entities.id`. But every caller passes a CONTACT id taken from
-- `unified_contacts.unified_id` (briefing-data.js:608, daily-briefing/index.ts:749
-- both do `id: c.unified_id`). unified_id != entities.id, so the WHERE never
-- matched a signal and the function ALWAYS returned the neutral 1.0 — the
-- deprioritize/boost loop was dead. Verified live: 66/66 contact signals match an
-- entities.id row, 0 match a unified_id.
--
-- DECISION (documented here, per the audit prompt): change the FUNCTION to accept
-- EITHER id-space rather than touching every call site. Resolution happens on
-- LCC Opps, where `unified_contacts` carries the `entity_id` back-link
-- (5,696 populated today); the gov mirror lacks that column, so a call-site
-- resolve couldn't work when CONTACTS_HUB='gov' (the default) — the function is
-- the one place that always has the mapping.
--
-- Behavior:
--   * If the argument resolves to a `unified_contacts.unified_id` with a non-null
--     entity_id, use that entity_id.
--   * Otherwise use the argument verbatim (already an entities.id, or an
--     unmapped id — falls through to the neutral 1.0, exactly as before: no
--     regression).
-- Additive/reversible: prior body is in schema/027_signal_feedback_rules.sql.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_contact_recommendation_weight(p_entity_id uuid)
RETURNS numeric AS $$
DECLARE
  v_entity_id uuid;
  v_ignored int;
  v_acted int;
BEGIN
  -- Accept either id-space: callers historically pass unified_contacts.unified_id
  -- but signals.entity_id stores entities.id. Resolve unified_id -> entity_id when
  -- the argument is a mapped unified_id; otherwise use it directly.
  SELECT uc.entity_id
    INTO v_entity_id
    FROM public.unified_contacts uc
   WHERE uc.unified_id = p_entity_id
     AND uc.entity_id IS NOT NULL
   LIMIT 1;

  v_entity_id := COALESCE(v_entity_id, p_entity_id);

  SELECT
    COUNT(*) FILTER (WHERE signal_type = 'recommendation_ignored'),
    COUNT(*) FILTER (WHERE signal_type = 'recommendation_acted_on')
  INTO v_ignored, v_acted
  FROM public.signals
  WHERE entity_id = v_entity_id
    AND entity_type = 'contact'
    AND created_at > now() - interval '90 days';

  IF v_ignored >= 3 AND v_acted = 0 THEN RETURN 0.5; END IF;
  IF v_acted >= 3 AND v_ignored = 0 THEN RETURN 1.5; END IF;
  RETURN 1.0;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Verification (run after apply):
--   -- A unified_id with recommendation signals now resolves to its entity_id.
--   -- Should return the same value as calling with the resolved entity_id.
--   SELECT get_contact_recommendation_weight(uc.unified_id)      AS via_unified,
--          get_contact_recommendation_weight(uc.entity_id)       AS via_entity
--   FROM unified_contacts uc
--   WHERE uc.entity_id IN (SELECT entity_id FROM signals
--                          WHERE entity_type='contact'
--                            AND signal_type IN ('recommendation_ignored','recommendation_acted_on'))
--   LIMIT 5;
--   -- via_unified must equal via_entity (previously via_unified was always 1.0).
-- ---------------------------------------------------------------------------
