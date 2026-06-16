-- ============================================================================
-- R28 Unit 2 — value-ranked contact-qualify worklist (LCC Opps)
-- 2026-06-16  (xengecqvemvfknjvbvrq)
-- ----------------------------------------------------------------------------
-- The ~421 `new_contact_qualify` inbox rows are real CoStar-captured contacts,
-- connected to the entity graph but never ACTIVATED — they sit as an inbox pile
-- instead of feeding the (contact-starved) outreach engine. This view turns
-- them into a bounded, value-ranked worklist (Decision-Center-lane style):
--
--   * EXCLUDES junk_name_flagged / orphan_flagged entities — those route to the
--     existing junk_entity_name Decision Center lane (classify, don't bury).
--   * surfaces the captured contact's email/phone (entity record first, then the
--     inbox metadata fallback the sidebar writer stamped).
--   * ranks by the VALUE of the property the contact was captured on, resolved
--     through the same machinery as the priority queue: the property entity's
--     `asset` external identity → `lcc_property_attributes.annual_rent`. The API
--     orders persons-with-email first, then by this value DESC NULLS LAST.
--
-- The qualify ACTION (api/operations.js ?action=qualify_contact) links the
-- captured person to the property's owner (associated_with) and, where the owner
-- has a contactless active cadence, stamps it as the prospecting contact — the
-- R16/R20 contact-attach machinery — then dispositions the inbox row terminal so
-- it leaves the pile. This view is the read side; the action is the write side.
--
-- Additive, read-only, cache-or-live safe. security_invoker so it runs with the
-- caller's RLS (workspace-scoped reads). Apply on LCC Opps.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_lcc_contact_qualify_worklist
WITH (security_invoker = true) AS
SELECT
  i.id                                                  AS inbox_item_id,
  i.workspace_id,
  i.entity_id,
  i.received_at,
  i.title,
  i.domain,
  e.name                                                AS contact_name,
  e.entity_type,
  COALESCE(e.email, NULLIF(i.metadata->>'contact_email',''))   AS contact_email,
  COALESCE(e.phone, NULLIF(i.metadata->>'contact_phone',''))   AS contact_phone,
  NULLIF(i.metadata->>'contact_company','')             AS contact_company,
  NULLIF(i.metadata->>'role','')                        AS role,
  CASE WHEN (i.metadata->>'property_entity_id') ~ '^[0-9a-fA-F-]{36}$'
       THEN (i.metadata->>'property_entity_id')::uuid END AS property_entity_id,
  (COALESCE(e.email, NULLIF(i.metadata->>'contact_email','')) IS NOT NULL) AS has_email,
  pv.rank_value,
  pv.property_id,
  pv.source_domain
FROM public.inbox_items i
JOIN public.entities e
  ON e.id = i.entity_id
 AND e.merged_into_entity_id IS NULL
LEFT JOIN LATERAL (
  -- Resolve the captured property's value via its `asset` external identity →
  -- lcc_property_attributes. NULLS-LAST in the API order keeps property-less /
  -- value-less captures at the bottom (honest, never a faked rank).
  SELECT pa.annual_rent AS rank_value,
         xi.external_id  AS property_id,
         xi.source_system AS source_domain
  FROM public.external_identities xi
  JOIN public.lcc_property_attributes pa
    ON pa.source_domain = xi.source_system
   AND pa.source_property_id = xi.external_id
  WHERE (i.metadata->>'property_entity_id') ~ '^[0-9a-fA-F-]{36}$'
    AND xi.entity_id = (i.metadata->>'property_entity_id')::uuid
    AND xi.source_type = 'asset'
  ORDER BY pa.annual_rent DESC NULLS LAST
  LIMIT 1
) pv ON true
WHERE i.source_type = 'new_contact_qualify'
  AND i.status = 'new'
  AND COALESCE((e.metadata->>'junk_name_flagged')::boolean, false) = false
  AND COALESCE((e.metadata->>'orphan_flagged')::boolean, false)   = false;

GRANT SELECT ON public.v_lcc_contact_qualify_worklist TO authenticated;
