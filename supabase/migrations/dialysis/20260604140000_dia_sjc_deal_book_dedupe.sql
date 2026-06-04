-- R4-B: collapse v_sjc_deal_book to one row per Salesforce listing.
--
-- sf_listing_staging is an append-style staging table: every Salesforce import
-- snapshot of a listing writes a new row. 13,940 staging rows represent only
-- 161 distinct listings (sf_listing_id, 0 nulls). The view selected them all,
-- so the same closed deal surfaced 37-205 times — "Recent closed sales" showed
-- the identical DaVita deal ~10x, and v_sjc_deal_book_by_year (which aggregates
-- this view) inflated every year's closed_deals/closed_volume by the per-deal
-- snapshot factor. That inflation is also why 2024 looked like a "sync gap":
-- deduped, real closed commercial deals are 2023=6, 2024=1, 2025=3 — 2024 is a
-- genuinely low year, not a missing sync.
--
-- Fix at the source layer: DISTINCT ON (sf_listing_id), keeping the most
-- recently modified staging snapshot per listing. v_sjc_deal_book_by_year and
-- the recent-closed-sales loader self-correct (no rendering change needed).
--
-- Idempotent: CREATE OR REPLACE VIEW (column list unchanged, so no 42P16).

CREATE OR REPLACE VIEW public.v_sjc_deal_book AS
WITH d AS (
  SELECT DISTINCT ON (s.sf_listing_id)
    s.staging_id, s.sf_listing_id, s.source_system, s.import_batch, s.raw_row,
    s.payload_hash, s.sf_last_modified, s.sf_property_id, s.sf_deal_id,
    s.listing_name, s.record_type, s.listing_status, s.marketing_status,
    s.listing_price, s.first_broadcast_date, s.has_thumbnail, s.normalized_address,
    s.linked_property_id, s.linked_listing_id, s.match_method, s.match_confidence,
    s.imported_at, s.processed, s.processed_at, s.process_status, s.process_notes,
    s.created_at, s.updated_at, s.asking_list_price, s.marketing_cap_rate,
    s.time_on_market_days, s.listing_expiration_date, s.lease_expiration,
    s.property_address, s.property_subtype, s.building_sf, s.year_built, s.noi,
    s.tenant_names, s.primary_use,
    s.raw_row AS j
  FROM sf_listing_staging s
  ORDER BY s.sf_listing_id,
           s.sf_last_modified DESC NULLS LAST,
           s.imported_at DESC NULLS LAST,
           s.updated_at DESC NULLS LAST,
           s.staging_id DESC
)
SELECT d.sf_deal_id, d.sf_listing_id, d.staging_id,
  COALESCE(d.j ->> 'Deal_Name_sjc__c', d.j ->> 'Name', d.listing_name) AS deal_name,
  d.record_type AS deal_side,
  d.j ->> 'SJC_Broker_Team_sjc__c' AS sjc_team,
  d.j ->> 'Listing_Broker_sjc__c' AS listing_broker_sf_id,
  d.j ->> 'Deal_Status__c' AS deal_status,
  CASE d.j ->> 'Deal_Status__c'
    WHEN 'Closed IS' THEN 'closed'
    WHEN 'Terminated IS' THEN 'terminated'
    WHEN 'Listing Signed' THEN 'active_listing'
    WHEN 'LOI Executed' THEN 'under_loi'
    WHEN 'In Escrow' THEN 'in_escrow'
    WHEN 'Non-refundable' THEN 'in_escrow'
    ELSE 'other'
  END AS deal_stage,
  (d.j ->> 'Deal_Status__c') = 'Closed IS' AS is_closed,
  d.j ->> 'Marketing_Status_sjc__c' AS marketing_status,
  lcc_safe_numeric(d.j ->> 'Notable_Transaction_Price_sjc__c') AS closed_price,
  lcc_safe_numeric(COALESCE(d.j ->> 'Asking_List_Price_sjc__c', d.j ->> 'Asking_List_Price2_sjc__c')) AS asking_price,
  lcc_safe_numeric(COALESCE(d.j ->> 'Marketing_Cap_Rate_sjc__c', d.j ->> 'Cap_Rate_sjc__c')) AS cap_rate,
  lcc_safe_numeric(d.j ->> 'NOI_sjc__c') AS noi,
  lcc_safe_date(d.j ->> 'Est_Act_Close_Date_sjc__c') AS est_close_date,
  d.first_broadcast_date,
  COALESCE(d.j ->> 'Property_Address__c', d.property_address, d.normalized_address) AS property_address,
  d.j ->> 'City_sjc__c' AS city,
  d.j ->> 'State_sjc__c' AS state,
  COALESCE(d.j ->> 'Primary_Use_sjc__c', d.primary_use) AS primary_use,
  d.j ->> 'Seller_Company_sjc__c' AS seller_company,
  d.linked_property_id,
  d.match_confidence,
  ( SELECT st.sale_id
      FROM sales_transactions st
     WHERE st.property_id = d.linked_property_id AND st.transaction_state = 'live'
     ORDER BY abs(st.sale_date - COALESCE(lcc_safe_date(d.j ->> 'Est_Act_Close_Date_sjc__c'), st.sale_date))
     LIMIT 1) AS matched_sale_id,
  d.sf_last_modified
FROM d
WHERE d.record_type = ANY (ARRAY['Sale Deal - Commercial','IS - Buy Side (CM)','IS - Co-Broke Buyer','IS - Off-Market (CM)']);
