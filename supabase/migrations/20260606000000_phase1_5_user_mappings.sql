-- ============================================================================
-- Phase 1.5 — Generic external user mappings + activity backfill view
-- ----------------------------------------------------------------------------
-- Phase 1's sf.activities bridge stored sf_owner_id/sf_owner_name as text
-- with actor_user_id always NULL. Phase 3's outlook/calendar bridges have
-- source_user_id resolved at ingest because the PA flow tags every batch
-- with the LCC user UUID — but we still need a way to map the OTHER
-- direction: an SF Owner / SharePoint lastModifiedBy / Teams user back to
-- an LCC user.
--
-- This migration introduces a single `external_user_mappings` table that
-- serves all sources. Auto-matched by email at first sight; manually
-- overridable. The SF activity handler is updated in this phase to call
-- the resolver inline, and a backfill admin action re-resolves rows that
-- landed before the resolver existed.
-- ============================================================================

create table if not exists external_user_mappings (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  source_system   text not null
    check (source_system in (
      'salesforce','sharepoint','onedrive','outlook',
      'calendar','teams','other'
    )),
  external_id     text not null,         -- SF user 18-char id, Graph user id, etc.
  external_email  text,                  -- preserved so we can re-resolve later
  external_name   text,
  user_id         uuid references users(id) on delete set null,
  -- 'auto'      = matched by email at backfill time
  -- 'manual'    = operator confirmed/overrode in the UI
  -- 'unmatched' = no LCC user found (placeholder so we don't keep retrying)
  match_method    text not null default 'auto'
    check (match_method in ('auto','manual','unmatched')),
  confidence      numeric,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (workspace_id, source_system, external_id)
);

create index if not exists ix_external_user_mappings_user
  on external_user_mappings (user_id) where user_id is not null;
create index if not exists ix_external_user_mappings_email
  on external_user_mappings (workspace_id, lower(external_email))
  where external_email is not null;
create index if not exists ix_external_user_mappings_unmatched
  on external_user_mappings (workspace_id, source_system)
  where match_method = 'unmatched' or user_id is null;

drop trigger if exists trg_external_user_mappings_updated_at on external_user_mappings;
create trigger trg_external_user_mappings_updated_at
  before update on external_user_mappings
  for each row execute function bridges_set_updated_at();

-- ---- v_unmapped_sf_owners view --------------------------------------------
-- Surfaces SF owners we've seen in salesforce_activity_log but haven't yet
-- mapped to an LCC user. Used by the backfill admin action and by a UI
-- "review unmapped users" page in the future.

create or replace view v_unmapped_sf_owners as
  select
    al.workspace_id,
    al.sf_owner_id,
    max(al.sf_owner_name)  as sf_owner_name,
    max(al.sf_owner_email) as sf_owner_email,
    count(*)               as activity_count,
    max(al.occurred_at)    as latest_activity_at
  from salesforce_activity_log al
  where al.actor_user_id is null
    and not exists (
      select 1 from external_user_mappings m
      where m.workspace_id = al.workspace_id
        and m.source_system = 'salesforce'
        and m.external_id   = al.sf_owner_id
        and (m.user_id is not null or m.match_method = 'unmatched')
    )
  group by al.workspace_id, al.sf_owner_id;
