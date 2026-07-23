-- ============================================================================
-- LoopNet durable listing map (dia CRM backend)
-- Project: zqzrriwuavgrquhisnoa (Dialysis_DB — marketing_leads lives here)
--
-- LoopNet lead emails carry a LoopNet Listing ID (e.g. 38309608) but NOT our SF
-- ids, so marketing_leads.listing_id was always null. This adds a persisted
-- map so a LoopNet listing links to our SF listing/deal exactly once, then every
-- future email for that listing links instantly:
--
--   1. public.loopnet_listing_map — loopnet_listing_id -> sf_listing_id/sf_deal_id.
--      Populated automatically when the lead-ingest address matcher makes a
--      confident 1:1 match, and manually seedable/correctable (a manual row wins
--      because the handler reads the map first and auto-seeds with
--      resolution=ignore-duplicates).
--   2. marketing_leads.loopnet_listing_id — persist the parsed LoopNet id on the
--      lead so the map + backfill can key on it (durable, auditable).
--   3. Backfill loopnet_listing_id from notes for existing loopnet rows.
--   4. Backfill: re-resolve existing loopnet rows (listing_id null) through the
--      map. The map starts empty, so this stamps 0 today; it is re-runnable and
--      becomes effective as the map fills via manual seeds / auto-matches.
--
-- Additive, idempotent, reversible:
--   DROP TABLE IF EXISTS public.loopnet_listing_map;
--   ALTER TABLE public.marketing_leads DROP COLUMN IF EXISTS loopnet_listing_id;
--   -- the two backfills are one-time data fills (no schema change).
-- ============================================================================

-- 1) The durable map.
create table if not exists public.loopnet_listing_map (
  loopnet_listing_id text primary key,
  sf_listing_id      text,
  sf_deal_id         text,
  matched_via        text,
  created_at         timestamptz not null default now()
);

alter table public.loopnet_listing_map enable row level security;

-- Mirror marketing_leads' access posture (edge function uses the DIA key; a
-- single permissive policy + role grants, same as marketing_leads).
do $$
begin
  if not exists (
    select 1 from pg_policy
    where polrelid = 'public.loopnet_listing_map'::regclass
      and polname = 'Allow service role full access'
  ) then
    create policy "Allow service role full access"
      on public.loopnet_listing_map for all using (true) with check (true);
  end if;
end $$;

grant select, insert, update, delete
  on public.loopnet_listing_map
  to anon, authenticated, service_role;

-- 2) Persist the parsed LoopNet listing id on the lead.
alter table public.marketing_leads
  add column if not exists loopnet_listing_id text;

create index if not exists idx_marketing_leads_loopnet_listing_id
  on public.marketing_leads (loopnet_listing_id)
  where loopnet_listing_id is not null;

-- 3) One-time: extract loopnet_listing_id from notes for existing loopnet rows.
--    The "(Listing ID : 38309608)" fragment survives intact in the raw HTML body.
update public.marketing_leads
   set loopnet_listing_id = substring(notes from 'Listing\s*ID\s*[:#]?\s*([0-9]{4,})')
 where source = 'loopnet'
   and loopnet_listing_id is null
   and notes ~* 'Listing\s*ID\s*[:#]?\s*[0-9]{4,}';

-- 4) Backfill: re-resolve loopnet rows with a null listing_id through the map.
--    Re-runnable + idempotent; only touches rows still missing a listing_id.
update public.marketing_leads ml
   set listing_id        = coalesce(m.sf_listing_id, ml.listing_id),
       sf_opportunity_id = coalesce(ml.sf_opportunity_id, m.sf_deal_id),
       sf_match_method   = coalesce(ml.sf_match_method, 'loopnet_map_backfill'),
       updated_at        = now()
  from public.loopnet_listing_map m
 where ml.source = 'loopnet'
   and ml.listing_id is null
   and ml.loopnet_listing_id is not null
   and ml.loopnet_listing_id = m.loopnet_listing_id
   and (m.sf_listing_id is not null or m.sf_deal_id is not null);
