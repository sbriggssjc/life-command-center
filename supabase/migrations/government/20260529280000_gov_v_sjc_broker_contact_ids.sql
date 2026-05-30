-- ============================================================================
-- Gov — v_sjc_broker_contact_ids: live broker-Id list for Flow 6 (gov branch)
--
-- Target: government Supabase (GOV_SUPABASE_URL / scknotsqkcheojiaewwh)
-- APPLIED LIVE 2026-05-29 (read-only view, non-breaking).
--
-- Government-tenanted SJC deals route to gov.sf_listing_staging (4,984 rows,
-- 29 distinct 003* brokers). This view is the gov-side source for the Power
-- Automate broker-contact sync's self-refreshing SOQL list. Excludes a1s*
-- junction-object Ids (not Contacts).
-- ============================================================================

CREATE OR REPLACE VIEW public.v_sjc_broker_contact_ids AS
WITH ids AS (
  SELECT unnest(ARRAY[
    raw_row->>'Listing_Broker_sjc__c',
    raw_row->>'Listing_Broker_2_sjc__c',
    raw_row->>'Listing_Broker_3_sjc__c',
    raw_row->>'Listing_Broker_4_sjc__c',
    raw_row->>'Compliance_Broker_sjc__c']) AS sf_contact_id,
    raw_row->>'SJC_Broker_Team_sjc__c' AS team
  FROM public.sf_listing_staging
)
SELECT sf_contact_id,
       count(*)                                              AS deal_field_refs,
       count(DISTINCT team) FILTER (WHERE team IS NOT NULL)  AS teams
FROM ids
WHERE sf_contact_id LIKE '003%'
GROUP BY sf_contact_id;

COMMENT ON VIEW public.v_sjc_broker_contact_ids IS
  'Distinct SJC broker Salesforce Contact Ids (003*) referenced on gov deals, across the five *_sjc__c broker lookup fields. Source for Power Automate Flow 6 (SJC Broker Contact Sync, gov branch). Excludes a1s* junction-object Ids.';
