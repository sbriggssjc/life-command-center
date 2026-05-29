-- ============================================================================
-- Dia — SJC Salesforce deal book (full-book / BD attribution surface)
--
-- Target: dialysis Supabase (DIA_SUPABASE_URL) — where sf_listing_staging lives
-- (synced live from Salesforce; 11k rows, last import current).
--
-- 2026-05-29: answers "pull in which data is a Northmarq/SJC sale on each deal
-- and who did it, automatically." Rather than force SF onto the dialysis comp DB
-- (the two barely overlap — SJC's SF deals are overwhelmingly non-dialysis), this
-- exposes SJC's FULL Salesforce deal book as a clean, attributed, queryable
-- surface. Source of truth = sf_listing_staging.raw_row (the full SF record);
-- the views re-derive on read, so they stay current as the connector syncs.
--
-- Attribution comes straight from Salesforce:
--   sjc_team   = SJC_Broker_Team_sjc__c   (e.g. 'Team Briggs')
--   deal_stage = normalized Deal_Status__c (active_listing / under_loi /
--                in_escrow / closed / terminated)
--   closed sales = Deal_Status__c='Closed IS' (carry Notable_Transaction_Price).
-- v_sjc_deal_book also resolves linked_property_id -> the matching dialysis
-- sales_transaction (matched_sale_id) when one exists, so the SF book and the
-- comp DB can be reconciled.
--
-- Validated: Team Briggs = 1,303 closed sale deals / ~$8.1B; full book ~8,941
-- sale deals + buy-side/co-broke across all teams.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lcc_safe_numeric(p text) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p ~ '^\s*-?\$?[0-9,]*\.?[0-9]+\s*$' THEN NULLIF(regexp_replace(p,'[^0-9.\-]','','g'),'')::numeric END
$$;
CREATE OR REPLACE FUNCTION public.lcc_safe_date(p text) RETURNS date LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p ~ '^\d{4}-\d{2}-\d{2}' THEN left(p,10)::date END
$$;

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
  d.sf_last_modified
FROM d
WHERE d.record_type IN ('Sale Deal - Commercial','IS - Buy Side (CM)','IS - Co-Broke Buyer','IS - Off-Market (CM)');

CREATE OR REPLACE VIEW public.v_sjc_deal_book_summary AS
SELECT COALESCE(sjc_team,'(unassigned)') AS sjc_team, deal_side, deal_stage,
       count(*) AS deals,
       count(*) FILTER (WHERE is_closed) AS closed_deals,
       sum(closed_price) FILTER (WHERE is_closed) AS closed_volume,
       count(*) FILTER (WHERE matched_sale_id IS NOT NULL) AS matched_to_comp
FROM public.v_sjc_deal_book
GROUP BY 1,2,3;
