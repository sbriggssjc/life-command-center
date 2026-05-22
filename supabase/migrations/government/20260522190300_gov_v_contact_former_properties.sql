-- ============================================================================
-- 20260522190300_gov_v_contact_former_properties.sql
-- DEVELOPER_BD_AUDIT_v3 — Phase A Topic 4 (Former-properties view, gov)
--
-- Gov adaptation. Gov OH uses single-event semantics (transfer_date +
-- new_owner + prior_owner) rather than dia's interval (start/end_date)
-- model. A "former owner" is identified by a transfer where the entity
-- appears as prior_owner — their tenure ended at that transfer.
--
-- Gov contacts link to true_owners directly via contacts.true_owner_id
-- (no contact_links table). Gov recorded_owners has no true_owner_id FK,
-- so the prior_owner text is resolved directly to true_owners by name.
--
-- 1,306 rows / 546 contacts populate on gov immediately (validated 2026-05-22).
-- ============================================================================

CREATE OR REPLACE VIEW public.v_contact_former_properties AS
WITH transfers_with_prior AS (
  SELECT oh.ownership_id, oh.property_id, oh.transfer_date,
    oh.prior_owner, oh.new_owner, oh.sale_price, oh.transfer_price, oh.data_source,
    public.gov_normalize_for_match(oh.prior_owner) AS prior_owner_norm
  FROM public.ownership_history oh
  WHERE oh.transfer_date IS NOT NULL AND oh.transfer_date <= CURRENT_DATE
    AND oh.prior_owner IS NOT NULL AND TRIM(oh.prior_owner) <> ''
),
prior_resolved AS (
  SELECT DISTINCT ON (twp.ownership_id)
    twp.*, tt.true_owner_id AS prior_true_owner_id
  FROM transfers_with_prior twp
  LEFT JOIN public.true_owners tt
    ON public.gov_normalize_for_match(tt.name) = twp.prior_owner_norm
  ORDER BY twp.ownership_id, tt.true_owner_id
)
SELECT DISTINCT
  c.contact_id, c.name AS contact_name, c.email AS contact_email,
  p.property_id, p.address, p.city, p.state, p.zip_code,
  p.agency AS current_tenant, p.year_built,
  pr.transfer_date AS exited_on,
  pr.sale_price AS exit_price, pr.transfer_price, pr.new_owner AS sold_to,
  pr.data_source AS exit_data_source,
  COALESCE(t.merged_into_true_owner_id, t.true_owner_id) AS true_owner_id_canonical,
  t.name AS true_owner_name, pr.prior_owner AS recorded_owner_name
FROM prior_resolved pr
JOIN public.true_owners t ON t.true_owner_id = pr.prior_true_owner_id
JOIN public.contacts c    ON c.true_owner_id = t.true_owner_id
JOIN public.properties p  ON p.property_id = pr.property_id
ORDER BY c.contact_id, pr.transfer_date DESC;

ALTER VIEW public.v_contact_former_properties SET (security_invoker = true);

COMMENT ON VIEW public.v_contact_former_properties IS
  'DEVELOPER_BD_AUDIT_v3 §7.1 A4 Topic 4 (gov adaptation). A "former '
  'owner" is the prior_owner on any transfer. Resolves prior_owner text '
  'to a true_owner via gov_normalize_for_match name match. Merge-aware.';
