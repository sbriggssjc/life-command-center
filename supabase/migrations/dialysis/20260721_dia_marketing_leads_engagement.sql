-- ============================================================================
-- Topic A — Listing_Activity engagement ingest support (dia CRM backend)
-- Project: zqzrriwuavgrquhisnoa (Dialysis_DB / marketing_leads lives here)
--
-- 1. Idempotency for the new source='rcm_engagement' channel: a partial unique
--    index on (source_ref) WHERE source='rcm_engagement' so a re-POSTed
--    Listing_Activity (source_ref = sf_activity_id) updates, never duplicates.
--    Mirrors the salesforce_activities sf_task_id idempotency fix.
--    (A composite unique index idx_marketing_leads_source_ref on
--     (source, source_ref) already exists and also backstops uniqueness; this
--     narrower, source-scoped index documents intent + provides a targeted
--     arbiter for the engagement channel.)
--
-- 2. Backfill lead_date = ingested_at for existing rows where it was never set
--    (lead_date was never written by any prior ingest path).
--
-- Additive + reversible:
--   DROP INDEX IF EXISTS public.marketing_leads_engagement_uidx;
--   -- the lead_date backfill is a one-time data fill (no schema change).
-- ============================================================================

-- Guard: refuse to create the unique index if a duplicate rcm_engagement
-- source_ref already exists (surface it instead of a cryptic CREATE failure).
do $$
declare
  dup_count integer;
begin
  select count(*) into dup_count
  from (
    select source_ref
    from public.marketing_leads
    where source = 'rcm_engagement' and source_ref is not null
    group by source_ref
    having count(*) > 1
  ) d;
  if dup_count > 0 then
    raise exception 'marketing_leads has % duplicate rcm_engagement source_ref value(s) — resolve before creating marketing_leads_engagement_uidx', dup_count;
  end if;
end $$;

create unique index if not exists marketing_leads_engagement_uidx
  on public.marketing_leads (source_ref)
  where source = 'rcm_engagement';

-- One-time backfill: stamp lead_date from the ingest timestamp for legacy rows.
update public.marketing_leads
   set lead_date = ingested_at
 where lead_date is null
   and ingested_at is not null;
