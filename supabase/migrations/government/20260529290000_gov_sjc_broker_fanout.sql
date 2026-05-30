-- ============================================================================
-- Gov — SJC broker fan-out: salesforce_contacts + v_sjc_deal_book (with broker_name)
--
-- Target: government Supabase (GOV_SUPABASE_URL / scknotsqkcheojiaewwh)
--
-- ⚠️ STAGED — NOT YET APPLIED. This adds a new table to the locked-down gov
-- (compliance) DB, so apply it through the team's normal migration/PR process.
--
-- 2026-05-29: Brings gov to parity with dia for individual-broker attribution.
-- gov.sf_listing_staging already carries SJC government deals (4,984 rows, 29
-- distinct 003* broker Contact Ids across the five *_sjc__c lookup fields, 17
-- teams), but gov had no salesforce_contacts table and no v_sjc_deal_book. This
-- migration creates:
--   1. lcc_safe_numeric() / lcc_safe_date()  — text->num/date guards (the dia
--      deal book depends on these; gov did not have them).
--   2. salesforce_contacts                    — broker/owner Contact landing table,
--      written by Power Automate "Flow 6" (gov branch) via direct PostgREST upsert.
--   3. v_sjc_deal_book (+ broker_name)         — attributed gov deal book, ported
--      from dia 20260529260000 + 20260529270000, joined to salesforce_contacts.
--   4. v_sjc_deal_book_summary                 — per team/side/stage rollup.
--
-- gov.sales_transactions has (sale_id, property_id, sale_date, transaction_state)
-- so the matched_sale_id reconciliation subquery ports unchanged.
-- ============================================================================

-- 1. Text guards (idempotent) ------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_safe_numeric(p text) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p ~ '^\s*-?\$?[0-9,]*\.?[0-9]+\s*$' THEN NULLIF(regexp_replace(p,'[^0-9.\-]','','g'),'')::numeric END
$$;
CREATE OR REPLACE FUNCTION public.lcc_safe_date(p text) RETURNS date LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p ~ '^\d{4}-\d{2}-\d{2}' THEN left(p,10)::date END
$$;

-- 2. Broker/owner Contact landing table (mirrors dia.salesforce_contacts) -----
CREATE TABLE IF NOT EXISTS public.salesforce_contacts (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sf_contact_id  text NOT NULL UNIQUE,
  first_name     text,
  last_name      text,
  email          text,
  phone          text,
  sf_account_id  text,
  updated_at     timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gov_sf_contacts_account ON public.salesforce_contacts (sf_account_id);
CREATE INDEX IF NOT EXISTS idx_gov_sf_contacts_email   ON public.salesforce_contacts (email);

-- gov is RLS-locked-down; service role (Power Automate's key) bypasses RLS.
-- No anon/authenticated policies are added — the table is service-role-only.
ALTER TABLE public.salesforce_contacts ENABLE ROW LEVEL SECURITY;

-- 3. Attributed gov deal book (ported from dia + broker_name) -----------------
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
  (SELECT NULLIF(trim(COALESCE(sc.first_name,'') || ' ' || COALESCE(sc.last_name,'')), '')
     FROM public.salesforce_contacts sc
     WHERE sc.sf_contact_id = d.j->>'Listing_Broker_sjc__c'
     LIMIT 1) AS broker_name
FROM d
-- gov record types verified 2026-05-29; 'Sale Deal - Multifamily' (301 rows, all
-- broker-bearing) is gov-specific and added here vs the dia filter.
WHERE d.record_type IN ('Sale Deal - Commercial','Sale Deal - Multifamily',
                        'IS - Buy Side (CM)','IS - Co-Broke Buyer','IS - Off-Market (CM)');

CREATE OR REPLACE VIEW public.v_sjc_deal_book_summary AS
SELECT COALESCE(sjc_team,'(unassigned)') AS sjc_team, deal_side, deal_stage,
       count(*) AS deals,
       count(*) FILTER (WHERE is_closed) AS closed_deals,
       sum(closed_price) FILTER (WHERE is_closed) AS closed_volume,
       count(*) FILTER (WHERE matched_sale_id IS NOT NULL) AS matched_to_comp
FROM public.v_sjc_deal_book
GROUP BY 1,2,3;

-- Note: gov record_type values may differ from dia's. After apply, verify the
-- WHERE filter captures the intended gov deal sides:
--   SELECT record_type, count(*) FROM public.sf_listing_staging GROUP BY 1 ORDER BY 2 DESC;
-- and widen the IN (...) list above if government deals use other record types.
