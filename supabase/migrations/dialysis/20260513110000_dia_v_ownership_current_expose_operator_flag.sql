-- Layer C of the ownership-pollution fix series.
--
-- Layer A (DialysisProject b5e93847e): removed process_owner_link from the
--   CMS ingestor so it stops minting operator-as-owner shells.
-- Layer B (DialysisProject c81569046): added is_operator_not_owner /
--   source provenance columns and dia_purge_operator_owner_links() RPC,
--   then cleared 3,401 polluted property links.
-- Layer C (this migration): exposes the new flag through v_ownership_current
--   so the LCC sidebar can hide false "True Owner" cards even if a future
--   data-import bug ever re-stamps an operator as a true_owner on a
--   property. Belt-and-suspenders alongside the data fix.
--
-- Adds two columns to v_ownership_current:
--   true_owner_is_operator BOOLEAN  -- from true_owners.is_operator_not_owner
--   true_owner_source      TEXT     -- from true_owners.source
--
-- Wrapper pattern is unsafe here because v_ownership_current uses
-- SELECT DISTINCT ON (p.property_id) and ordering — must be rewritten
-- in full, preserving every existing column so detail.js / dialysis.js
-- keep working. The column list below was captured from
-- pg_get_viewdef('public.v_ownership_current') on 2026-05-13 before this
-- change.
--
-- Apply on dialysis project (zqzrriwuavgrquhisnoa).

CREATE OR REPLACE VIEW public.v_ownership_current AS
SELECT DISTINCT ON (p.property_id)
  p.property_id,
  norm_text(ro.name)              AS recorded_owner,
  norm_text(ro.normalized_name)   AS recorded_owner_normalized,
  ro.address                      AS recorded_owner_address,
  norm_text(ro.city)              AS recorded_owner_city,
  ro.state                        AS recorded_owner_state,
  norm_text(tru.name)             AS true_owner,
  tru.owner_type,
  tru.city                        AS true_owner_city,
  tru.state                       AS true_owner_state,
  tru.notice_address_1            AS true_owner_address,
  tru.contact_1_name,
  tru.contact_2_name,
  tru.salesforce_id,
  tru.sf_company_id,
  tru.priority_level,
  tru.developer_flag,
  tru.developer_tier,
  tru.total_properties_owned,
  tru.current_property_count,
  tru.is_prospect,
  tru.latest_note_summary,
  c.contact_email,
  c.contact_phone,
  p.recorded_owner_id,
  p.true_owner_id,
  tru.contact_id,
  -- NEW (Layer C):
  COALESCE(tru.is_operator_not_owner, FALSE) AS true_owner_is_operator,
  tru.source                                  AS true_owner_source
FROM properties p
LEFT JOIN recorded_owners ro  ON ro.recorded_owner_id = p.recorded_owner_id
LEFT JOIN true_owners     tru ON tru.true_owner_id    = p.true_owner_id
LEFT JOIN contacts        c   ON c.contact_id         = tru.contact_id
ORDER BY p.property_id;

COMMENT ON VIEW public.v_ownership_current IS
  'Property -> recorded_owner / true_owner / primary contact join. '
  'true_owner_is_operator = TRUE flags rows whose true_owner is a chain '
  'operator (DaVita, Fresenius, ...) rather than a real decision-maker; '
  'the LCC sidebar uses this to hide the True Owner card when set.';
