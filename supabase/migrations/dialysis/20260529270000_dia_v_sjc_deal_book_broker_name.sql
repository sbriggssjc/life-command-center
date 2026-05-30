-- ============================================================================
-- Dia — v_sjc_deal_book: add broker_name (individual-broker attribution)
--
-- Target: dialysis Supabase (DIA_SUPABASE_URL / zqzrriwuavgrquhisnoa)
--
-- 2026-05-29: Follow-up to 20260529260000_dia_sjc_deal_book_views.sql. The deal
-- book exposes the listing broker only as a Salesforce Contact Id
-- (listing_broker_sf_id = raw_row->>'Listing_Broker_sjc__c'). Until now those
-- broker Contact records were not in public.salesforce_contacts (the contact sync
-- pulled account/owner contacts, not internal SJC brokers), so deals could be
-- attributed by TEAM but not by individual broker.
--
-- Power Automate "Flow 6: SJC Broker Contact Sync" (see .github/PA_FLOWS.md) now
-- direct-upserts those broker Contacts into public.salesforce_contacts. This
-- migration adds a broker_name column that resolves the id to a readable name.
--
-- ⚠️ APPLY ONLY AFTER Flow 6 has run and the broker contacts resolve. Verify:
--     SELECT count(*) FROM salesforce_contacts WHERE sf_contact_id LIKE '0038W%';
-- The view degrades gracefully if a broker is still missing (broker_name = NULL),
-- so applying early is non-breaking — names just fill in as contacts land.
--
-- broker_name is appended as the LAST column (CREATE OR REPLACE VIEW is
-- append-only for columns; everything above is reproduced verbatim from the
-- 20260529260000 baseline).
-- ============================================================================

CREATE OR REPLACE VIEW public.v_sjc_deal_book AS
WITH d AS (SELECT s.*, s.raw_row::jsonb AS j FROM public.sf_listing_staging s)
SELECT
  d.sf_deal_id, d.sf_listing_id, d.staging_id,
  COALESCE(d.j->>'Deal_Name_sjc__c', d.j->>'Name', d.listing_name) AS deal_name,
  d.record_type AS deal_side,
  d.j->>'SJC_Broker_Team_sjc__c' AS sjc_team,
  d.j->>'Listing_Broker_sjc__c'  AS listing_broker_sf_id,
  d.j->>'Deal_Status__c' AS deal_status,
  CASE d.j->>'Deal_Status__c'
    WHEN 'Closed IS'      THEN 'closed'
    WHEN 'Terminated IS'  THEN 'terminated'
    WHEN 'Listing Signed' THEN 'active_listing'
    WHEN 'LOI Executed'   THEN 'under_loi'
    WHEN 'In Escrow'      THEN 'in_escrow'
    WHEN 'Non-refundable' THEN 'in_escrow'
    ELSE 'other' END AS deal_stage,
  (d.j->>'Deal_Status__c' = 'Closed IS') AS is_closed,
  d.j->>'Marketing_Status_sjc__c' AS marketing_status,
  public.lcc_safe_numeric(d.j->>'Notable_Transaction_Price_sjc__c') AS closed_price,
  public.lcc_safe_numeric(COALESCE(d.j->>'Asking_List_Price_sjc__c', d.j->>'Asking_List_Price2_sjc__c')) AS asking_price,
  public.lcc_safe_numeric(COALESCE(d.j->>'Marketing_Cap_Rate_sjc__c', d.j->>'Cap_Rate_sjc__c')) AS cap_rate,
  public.lcc_safe_numeric(d.j->>'NOI_sjc__c') AS noi,
  public.lcc_safe_date(d.j->>'Est_Act_Close_Date_sjc__c') AS est_close_date,
  d.first_broadcast_date,
  COALESCE(d.j->>'Property_Address__c', d.property_address, d.normalized_address) AS property_address,
  d.j->>'City_sjc__c' AS city, d.j->>'State_sjc__c' AS state,
  COALESCE(d.j->>'Primary_Use_sjc__c', d.primary_use) AS primary_use,
  d.j->>'Seller_Company_sjc__c' AS seller_company,
  d.linked_property_id, d.match_confidence,
  (SELECT st.sale_id FROM public.sales_transactions st
     WHERE st.property_id = d.linked_property_id AND st.transaction_state='live'
     ORDER BY abs(st.sale_date - COALESCE(public.lcc_safe_date(d.j->>'Est_Act_Close_Date_sjc__c'), st.sale_date)) LIMIT 1) AS matched_sale_id,
  d.sf_last_modified,
  -- ── NEW: individual-broker name resolved from the synced SJC broker Contact ──
  (SELECT NULLIF(trim(COALESCE(sc.first_name,'') || ' ' || COALESCE(sc.last_name,'')), '')
     FROM public.salesforce_contacts sc
     WHERE sc.sf_contact_id = d.j->>'Listing_Broker_sjc__c'
     LIMIT 1) AS broker_name
FROM d
WHERE d.record_type IN ('Sale Deal - Commercial','IS - Buy Side (CM)','IS - Co-Broke Buyer','IS - Off-Market (CM)');

-- v_sjc_deal_book_summary is unchanged (does not reference broker_name); left as-is.

-- Optional sanity check after apply:
--   SELECT listing_broker_sf_id, broker_name, count(*)
--   FROM public.v_sjc_deal_book
--   WHERE sjc_team = 'Team Briggs'
--   GROUP BY 1,2 ORDER BY 3 DESC;
