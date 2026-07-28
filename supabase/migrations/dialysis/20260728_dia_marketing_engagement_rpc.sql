-- ============================================================================
-- Dia — commit the dia_marketing_engagement RPC (durability fix)
--
-- Target: dialysis Supabase (DIA_SUPABASE_URL / zqzrriwuavgrquhisnoa)
--
-- WHY: dia_marketing_engagement was created live (Marketing tab Slice 3b) but had
-- NO committed source, so a DB replay/rebuild would silently lose the engagement
-- section that api/operations.js getMarketingEngagement() calls
-- (domainRpc('dia','dia_marketing_engagement',{p_listing_id,p_opp_id,p_limit})).
-- This captures the exact live definition (pg_get_functiondef, 2026-07-28) as an
-- idempotent CREATE OR REPLACE. NO behavior change.
--
-- Rolls up marketing_leads (RCM om_download / exec_summary_view + inquiries) per
-- engaged contact for one listing/opportunity. Reversible: DROP FUNCTION.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.dia_marketing_engagement(
  p_listing_id text DEFAULT NULL::text,
  p_opp_id text DEFAULT NULL::text,
  p_limit integer DEFAULT 100)
 RETURNS TABLE(contact_key text, lead_name text, lead_company text, lead_email text, lead_phone text, sf_contact_id text, sf_company_id text, assigned_to text, event_types text[], event_count bigint, last_activity timestamp with time zone, activity_detail text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with rows as (
    select *
    from marketing_leads
    where source in ('rcm_engagement','rcm','loopnet','property_flow')
      and (
        (p_listing_id is not null and p_listing_id <> '' and listing_id = p_listing_id)
        or (p_opp_id is not null and p_opp_id <> '' and sf_opportunity_id = p_opp_id)
      )
  ),
  keyed as (
    select
      coalesce(
        nullif(sf_contact_id, ''),
        nullif(lower(lead_email), ''),
        nullif(lead_name, ''),
        lead_id::text
      ) as contact_key,
      coalesce(last_touchpoint_date, lead_date, ingested_at) as ts,
      *
    from rows
  )
  select
    contact_key,
    max(lead_name)                                as lead_name,
    max(lead_company)                             as lead_company,
    max(lead_email)                               as lead_email,
    max(lead_phone)                               as lead_phone,
    max(sf_contact_id)                            as sf_contact_id,
    max(sf_company_id)                            as sf_company_id,
    max(assigned_to)                              as assigned_to,
    array_agg(distinct activity_type)             as event_types,
    count(*)                                      as event_count,
    max(ts)                                       as last_activity,
    (array_agg(activity_detail order by ts desc nulls last))[1] as activity_detail
  from keyed
  group by contact_key
  order by max(ts) desc nulls last
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$function$;

GRANT EXECUTE ON FUNCTION public.dia_marketing_engagement(text, text, integer)
  TO anon, authenticated, service_role;
