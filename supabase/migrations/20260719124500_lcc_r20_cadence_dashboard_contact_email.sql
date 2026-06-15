-- ============================================================================
-- R20 — surface the cadence's contact email on the dashboard (draft recipient)
-- ----------------------------------------------------------------------------
-- The cadence dashboard's "Draft email →" flow builds a mailto: with an empty
-- to: (R10 Unit 4 follow-up: recipient resolution was deferred). R20 closes it:
-- v_bd_cadence_dashboard now exposes the cadence's contact_id and the resolved
-- contact email so the draft path can populate the recipient from the contact
-- entity (= the person).
--
-- This resolves identically whether the contact is a separately-linked person
-- OR the cadence's own person entity self-stamped as its own contact (R20:
-- contact_id = entity_id) — the draft "just works" without assuming a separate
-- contact row.
--
-- Append-only column change (CREATE OR REPLACE VIEW appends contact_id +
-- contact_email at the END; all existing columns keep their position/order).
-- security_invoker preserved. Additive + cache-or-live safe. Apply on LCC Opps.
-- ============================================================================

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
  p.is_cross_vertical,
  -- R20: cadence contact + resolved recipient email for the draft mailto:
  c.contact_id,
  ce.email                                            AS contact_email
FROM public.touchpoint_cadence c
JOIN public.entities e
  ON e.id = c.entity_id
 AND e.merged_into_entity_id IS NULL
LEFT JOIN public.v_entity_portfolio_all p
  ON p.entity_id = c.entity_id
LEFT JOIN public.entities ce
  ON ce.id = c.contact_id;

GRANT SELECT ON public.v_bd_cadence_dashboard TO authenticated;
