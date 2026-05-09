-- ============================================================================
-- Phase 1 — Salesforce bridges schema
-- ----------------------------------------------------------------------------
-- Adds the storage layer for the four sf.* bridges:
--
--   sf.accounts      → entities + external_identities (existing pattern)
--   sf.contacts      → entities + external_identities + unified_contacts.sf_*
--   sf.opportunities → entities.metadata.salesforce.opportunities[] on Account
--   sf.activities    → salesforce_activity_log (this migration) +
--                      unified_contacts.last_*_date / total_* counters
--
-- The headline payoff is `v_competitive_touches`: "who else at Northmarq is
-- touching this account/contact in the last 90 days?" — answerable as soon
-- as sf.activities starts flowing in.
--
-- Bridge rows themselves are seeded via supabase/seeds/phase1_salesforce_bridges.sql
-- (parameterized by workspace) rather than this migration, since workspace
-- ids are install-specific.
-- ============================================================================

-- ---- salesforce_activity_log -----------------------------------------------
-- Mirror of SF Task + Event records that touch tracked accounts/contacts.
-- Stored separately from `activity_events` because activity_events.actor_id
-- is NOT NULL → users(id), and the SF OwnerId rarely maps to an LCC users
-- row. We capture the SF owner identity here as text + nullable
-- actor_user_id for future backfill once a sf-user-mapping table exists.

create table if not exists salesforce_activity_log (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references workspaces(id) on delete cascade,

  -- Raw SF identifiers
  sf_activity_id      text not null,
  sf_activity_type    text not null
    check (sf_activity_type in ('Task','Event')),
  sf_subject          text,
  sf_call_type        text,           -- TaskCallType for calls (Inbound/Outbound)
  sf_status           text,
  sf_priority         text,
  sf_activity_date    date,

  -- Who did it (Northmarq side)
  sf_owner_id         text not null,  -- the Northmarq employee's SF user id
  sf_owner_name       text,
  sf_owner_email      text,
  -- Optional mapping back to an LCC user — null until a mapping exists.
  actor_user_id       uuid references users(id) on delete set null,

  -- Who/What it touched (SF ids + resolved LCC entity ids)
  sf_who_id           text,           -- Contact id
  sf_what_id          text,           -- Account/Opportunity id
  contact_entity_id   uuid,           -- resolved via external_identities
  account_entity_id   uuid,

  -- Categorization derived by the bridge handler from Type/CallType/IsTask
  category            text not null
    check (category in ('call','email','meeting','task','note','other')),

  description         text,           -- truncated to 4kB by the handler
  occurred_at         timestamptz not null,   -- ActivityDate or LastModifiedDate
  sf_last_modified_at timestamptz,

  metadata            jsonb not null default '{}'::jsonb,

  ingested_at         timestamptz not null default now(),
  unique (workspace_id, sf_activity_id)
);

create index if not exists ix_sf_activity_log_workspace_occurred
  on salesforce_activity_log (workspace_id, occurred_at desc);
create index if not exists ix_sf_activity_log_owner
  on salesforce_activity_log (workspace_id, sf_owner_id, occurred_at desc);
create index if not exists ix_sf_activity_log_account
  on salesforce_activity_log (workspace_id, account_entity_id, occurred_at desc)
  where account_entity_id is not null;
create index if not exists ix_sf_activity_log_contact
  on salesforce_activity_log (workspace_id, contact_entity_id, occurred_at desc)
  where contact_entity_id is not null;
create index if not exists ix_sf_activity_log_what
  on salesforce_activity_log (workspace_id, sf_what_id);

-- ---- v_competitive_touches -------------------------------------------------
-- Per-(account, owner) rollup over the last 90 days. The UI passes
-- account_entity_id and gets back a list of fellow Northmarq employees
-- with their touch counts and most-recent touch date. Light-weight by
-- design — no joins beyond the activity log itself, so it's safe to query
-- inline from the entity sidebar.

create or replace view v_competitive_touches as
  select
    workspace_id,
    account_entity_id,
    contact_entity_id,
    sf_owner_id,
    sf_owner_name,
    sf_owner_email,
    actor_user_id,
    count(*) filter (where category = 'call')    as calls_90d,
    count(*) filter (where category = 'email')   as emails_90d,
    count(*) filter (where category = 'meeting') as meetings_90d,
    count(*) filter (where category = 'task')    as tasks_90d,
    count(*)                                     as touches_90d,
    max(occurred_at)                             as last_touch_at
  from salesforce_activity_log
  where occurred_at >= (now() - interval '90 days')
  group by workspace_id, account_entity_id, contact_entity_id,
           sf_owner_id, sf_owner_name, sf_owner_email, actor_user_id;

-- ============================================================================
-- End Phase 1 schema. Bridge row seed (sf.accounts, sf.contacts,
-- sf.opportunities, sf.activities) is in supabase/seeds/phase1_salesforce_bridges.sql.
-- ============================================================================
