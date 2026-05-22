-- ============================================================================
-- 20260522190300_dia_v_contact_former_properties.sql
-- DEVELOPER_BD_AUDIT_v3 — Phase A Topic 4 (Former-properties view, dia)
--
-- Surfaces former ownership on contact/prospect detail pages. Each row
-- represents a property that an entity (linked to a contact via
-- contact_links) used to own — they bought it, then exited. Useful BD
-- context: brokers can see what a prospect has previously transacted in
-- our target market.
--
-- Definition of "former": ownership_history.end_date IS NOT NULL AND
-- end_date <= CURRENT_DATE. Includes the WS3-b-backfilled seller-exit
-- rows (ownership_source='sales_transactions_seller_exit') when those
-- entities also have contact_links rows.
--
-- Merge-aware via true_owner_id_canonical (COALESCE merged_into).
-- ============================================================================

CREATE OR REPLACE VIEW public.v_contact_former_properties AS
SELECT DISTINCT
  cl.contact_id,
  c.contact_name,
  c.contact_email,
  p.property_id,
  p.address, p.city, p.state, p.zip_code,
  p.tenant         AS current_tenant,
  p.year_built,
  oh.start_date    AS owned_from,
  oh.end_date      AS exited_on,
  oh.sold_price    AS exit_price,
  oh.ownership_source,
  oh.notes         AS exit_notes,
  CASE
    WHEN oh.start_date IS NOT NULL AND oh.end_date IS NOT NULL
    THEN ROUND(((oh.end_date - oh.start_date) / 365.25)::numeric, 1)
    ELSE NULL
  END              AS holding_period_years,
  COALESCE(t.merged_into_true_owner_id, t.true_owner_id) AS true_owner_id_canonical,
  t.name           AS true_owner_name,
  ro.name          AS recorded_owner_name
FROM public.contact_links cl
JOIN public.contacts c              ON c.contact_id = cl.contact_id
JOIN public.true_owners t           ON t.true_owner_id = cl.entity_id
                                    AND cl.entity_type = 'true_owner'
JOIN public.recorded_owners ro      ON ro.true_owner_id = t.true_owner_id
JOIN public.ownership_history oh    ON oh.recorded_owner_id = ro.recorded_owner_id
JOIN public.properties p            ON p.property_id = oh.property_id
WHERE oh.end_date IS NOT NULL
  AND oh.end_date <= CURRENT_DATE
ORDER BY cl.contact_id, oh.end_date DESC;

ALTER VIEW public.v_contact_former_properties SET (security_invoker = true);

COMMENT ON VIEW public.v_contact_former_properties IS
  'DEVELOPER_BD_AUDIT_v3 §7.1 A4 Topic 4. Properties an entity (linked '
  'to a contact via contact_links) formerly owned. Merge-aware via '
  'true_owner_id_canonical. Populates as brokers link contacts → owners.';
