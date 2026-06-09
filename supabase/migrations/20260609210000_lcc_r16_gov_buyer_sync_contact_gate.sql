-- ============================================================================
-- R16 — gov-buyer SF sync: gate on a resolved primary CONTACT (LCC Opps)
-- ============================================================================
-- R16 corrects the Salesforce write model: a NorthMarq "opportunity" is an OPEN
-- Task on a CONTACT (NMType picklist), not a standard SF Opportunity record. A
-- government buyer Task is created on the primary CONTACT (WhoId) — so the sync
-- can only run once a contact is resolved. The Task is created INLINE at
-- contact-selection time (operations.js select_buyer_contact); the gov-buyer
-- sync (api/admin.js handleGovBuyerSync) is now a retry safety-net.
--
-- This redefines v_lcc_government_buyer_sync_health to:
--   * compute the primary CONTACT (sf_contact_id) from
--     metadata.primary_contact.sf_contact_id OR the buy-side cadence row;
--   * add a `hold_no_contact` sync_status (mapped account but no contact yet —
--     the operator's next action is the P-BUYER contact step, NOT a failure);
--   * narrow `ready_to_sync` to "mapped account AND primary contact present AND
--     sf_opp_id NULL".
--
-- Additive + cache-or-live-safe: CREATE OR REPLACE keeps the leading 8 columns
-- (incl. sync_status) in place and APPENDS primary_sf_contact_id /
-- primary_contact_name at the end (Postgres CREATE OR REPLACE is append-only
-- for columns). Read-only view; no auth-schema contact. Idempotent.
-- Apply on LCC Opps (xengecqvemvfknjvbvrq).
-- ============================================================================

BEGIN;

CREATE OR REPLACE VIEW public.v_lcc_government_buyer_sync_health
WITH (security_invoker = true) AS
SELECT o.id AS opportunity_id, o.entity_id AS parent_entity_id, e.name AS parent_name,
  o.vertical, bp.sf_account_id, o.sf_opp_id, o.opened_at,
  CASE
    WHEN bp.sf_account_id IS NULL THEN 'hold_unmapped'
    WHEN o.sf_opp_id IS NOT NULL  THEN 'synced'
    WHEN COALESCE(NULLIF(o.metadata->'primary_contact'->>'sf_contact_id', ''), c.sf_contact_id) IS NULL
      THEN 'hold_no_contact'
    ELSE 'ready_to_sync'
  END AS sync_status,
  COALESCE(NULLIF(o.metadata->'primary_contact'->>'sf_contact_id', ''), c.sf_contact_id) AS primary_sf_contact_id,
  NULLIF(o.metadata->'primary_contact'->>'name', '') AS primary_contact_name
FROM public.bd_opportunities o
JOIN public.entities e ON e.id = o.entity_id
LEFT JOIN public.lcc_buyer_parents bp ON bp.parent_entity_id = o.entity_id
LEFT JOIN LATERAL (
  SELECT tc.sf_contact_id
  FROM public.touchpoint_cadence tc
  WHERE tc.bd_opportunity_id = o.id
    AND tc.sf_contact_id IS NOT NULL
    AND tc.sf_contact_id <> ''
  ORDER BY tc.updated_at DESC NULLS LAST
  LIMIT 1
) c ON true
WHERE o.type = 'government_buyer' AND o.is_open = true;

GRANT SELECT ON public.v_lcc_government_buyer_sync_health TO authenticated;

COMMIT;
