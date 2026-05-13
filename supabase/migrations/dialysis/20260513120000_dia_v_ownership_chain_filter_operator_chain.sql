-- Layer D of the ownership-pollution fix series.
--
-- Layer A (DialysisProject b5e93847e): removed process_owner_link from the
--   CMS ingestor so it stops minting operator-as-owner shells.
-- Layer B (DialysisProject c81569046): added is_operator_not_owner /
--   source provenance columns and dia_purge_operator_owner_links() RPC,
--   then cleared 3,401 polluted property links.
-- Layer C (20260513110000): exposed true_owner_is_operator on
--   v_ownership_current so the LCC Current Ownership card hides the
--   chain-operator-as-true-owner case.
-- Layer D (this migration): filter operator-chain shim rows out of
--   v_ownership_chain so every downstream consumer of the chain view
--   (LCC Ownership/CRM tab, Deal History, Activity Log, MCP queries, AI
--   analysis, ad-hoc Supabase queries, future exports) stops seeing them.
--
-- Context (audited 2026-05-13): 7,544 of 11,304 ownership_history rows
-- (~67%) carry ownership_source='cms_operator_chain'. These are synthetic
-- operator-presence shims minted by the CMS chain ingestor (notes prefix
-- "CMS chain org: …"). Round 76aj (20260428030000) tagged them with
-- ownership_source='cms_operator_chain' AND owner_type='operator' so they
-- could be filtered downstream — but the chain view itself was never
-- updated to honor the tag, so the rows leaked into every UI surface that
-- reads v_ownership_chain.
--
-- The LCC detail panel's Ownership/CRM and Deal History tabs ship with a
-- client-side dedup that drops these rows (commits 1bbdc7c, d40c12d). This
-- migration is the defense-in-depth view-level fix that also closes the
-- Activity Log tab, the dialysis sale-detail Owner sub-tab, global search
-- result panes, and any consumer that goes through the view directly.
--
-- Wrapper-WHERE is not supported on a view that has its own ORDER BY, so
-- this rewrites the view in full. The column list and joins below were
-- captured from pg_get_viewdef('public.v_ownership_chain') on 2026-05-13
-- before this change. The only logical addition is the WHERE clause —
-- the column list, joins, and ORDER BY are byte-for-byte preserved.
--
-- Operator-chain rows remain in public.ownership_history for forensics —
-- they are dropped only from the view consumers see, not the source data.
-- If a future workflow needs the raw operator-presence rows (e.g. CMS
-- chain coverage analytics), query ownership_history directly with
-- WHERE ownership_source = 'cms_operator_chain'.
--
-- Apply on dialysis project (zqzrriwuavgrquhisnoa).

CREATE OR REPLACE VIEW public.v_ownership_chain AS
 SELECT oh.id AS ownership_id,
    oh.property_id,
    oh.medicare_id,
    oh.ownership_start AS transfer_date,
    oh.ownership_end,
    oh.sold_price AS sale_price,
    COALESCE(oh.cap_rate, st.cap_rate) AS cap_rate,
    COALESCE(oh.rent, st.rent_at_sale) AS rent,
    oh.ownership_source,
    oh.ownership_type,
    oh.owner_type,
    norm_text(ro.name) AS recorded_owner_name,
    norm_text(COALESCE(tru.name, tru2.name)) AS true_owner_name,
    COALESCE(tru.owner_type, tru2.owner_type) AS true_owner_type,
    COALESCE(tru.true_owner_id, tru2.true_owner_id) AS true_owner_id,
    COALESCE(tru.salesforce_id, tru2.salesforce_id) AS salesforce_id,
    COALESCE(tru.prospecting_status, tru2.prospecting_status) AS prospecting_status,
    COALESCE(tru.last_contact_date, tru2.last_contact_date) AS last_contact_date,
    oh.sale_id,
    st.listing_broker,
    st.procuring_broker,
    st.buyer_name,
    st.seller_name,
    st.stated_cap_rate,
    st.calculated_cap_rate
   FROM ownership_history oh
     LEFT JOIN recorded_owners ro ON ro.recorded_owner_id = oh.recorded_owner_id
     LEFT JOIN true_owners tru ON tru.true_owner_id = oh.true_owner_uuid
     LEFT JOIN true_owners tru2 ON tru2.true_owner_id = ro.true_owner_id AND oh.true_owner_uuid IS NULL
     LEFT JOIN sales_transactions st ON st.sale_id = oh.sale_id
  WHERE COALESCE(oh.ownership_source, '') <> 'cms_operator_chain'
  ORDER BY oh.property_id, oh.ownership_start DESC NULLS LAST;

COMMENT ON VIEW public.v_ownership_chain IS
  'Property ownership chain for the LCC Ownership/CRM, Deal History, and '
  'Activity Log timelines. Filters out ownership_source=cms_operator_chain '
  'rows (synthetic operator-presence shims minted by CMS chain ingestion, '
  'tagged by Round 76aj). Source data remains in ownership_history; query '
  'that table directly if the operator-presence rows are needed for '
  'analytics. See migration 20260513120000 for context.';
