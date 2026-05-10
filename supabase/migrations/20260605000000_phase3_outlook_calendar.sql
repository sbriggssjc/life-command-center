-- ============================================================================
-- Phase 3 — Outlook + Calendar bridge schema
-- ----------------------------------------------------------------------------
-- The Phase 0 scaffold of `email_bodies` and `meetings` was body/event-only.
-- Phase 3 adds the metadata fields the worker needs to land messages without
-- a separate metadata table:
--
--   email_bodies:  + subject, from_email, from_name, to_emails, cc_emails,
--                  + has_attachments, is_sent, sent_at
--   email_bodies:  unique idx on (workspace_id, internet_message_id) so PA
--                  retries are idempotent
--
-- Adds `v_contact_engagement` — combines last_call_date / last_email_date /
-- last_meeting_date / total_* counters into a single row per business contact
-- with a `days_since_last_touch` int. Powers the "going cold" alert and the
-- engagement column in the contact list view.
--
-- meetings already has the right shape from Phase 0; nothing to alter.
-- ============================================================================

-- ---- email_bodies metadata expansion --------------------------------------

alter table email_bodies
  add column if not exists subject         text,
  add column if not exists from_email      text,
  add column if not exists from_name       text,
  add column if not exists to_emails       jsonb not null default '[]'::jsonb,
  add column if not exists cc_emails       jsonb not null default '[]'::jsonb,
  add column if not exists has_attachments boolean not null default false,
  add column if not exists is_sent         boolean,
  add column if not exists sent_at         timestamptz;

-- Idempotent upsert key. PA flows replay batches when they recover from
-- transient failures; the partial unique index lets the handler use
-- on_conflict=workspace_id,internet_message_id without requiring a value.
create unique index if not exists ux_email_bodies_workspace_message_id
  on email_bodies (workspace_id, internet_message_id)
  where internet_message_id is not null;

-- Cheap "who has emailed bob@example.com" lookup.
create index if not exists ix_email_bodies_from_email
  on email_bodies (workspace_id, lower(from_email))
  where from_email is not null;

-- "Recent emails involving this conversation" surface.
create index if not exists ix_email_bodies_received
  on email_bodies (workspace_id, received_at desc)
  where received_at is not null;

-- ---- v_contact_engagement -------------------------------------------------
-- One row per business contact with their cross-channel last-touch + days
-- since. Powers the "going cold" alert (where days_since_last_touch > N)
-- and the contact list's engagement column. Only contacts with at least
-- one recorded touch appear (NULL in all three last_*_date columns →
-- excluded; means we have no signal to go on).

create or replace view v_contact_engagement as
  with rolled as (
    select
      unified_id,
      full_name,
      email,
      company_name,
      sf_contact_id,
      contact_class,
      last_call_date,
      last_email_date,
      last_meeting_date,
      total_calls,
      total_emails_sent,
      engagement_score,
      greatest(
        coalesce(last_call_date,    'epoch'::timestamptz),
        coalesce(last_email_date,   'epoch'::timestamptz),
        coalesce(last_meeting_date, 'epoch'::timestamptz)
      ) as last_touch_at
    from unified_contacts
  )
  select
    unified_id,
    full_name,
    email,
    company_name,
    sf_contact_id,
    last_call_date,
    last_email_date,
    last_meeting_date,
    last_touch_at,
    (extract(epoch from (now() - last_touch_at)) / 86400)::int as days_since_last_touch,
    total_calls,
    total_emails_sent,
    engagement_score
  from rolled
  where contact_class = 'business'
    and last_touch_at > 'epoch'::timestamptz;

-- ---- privacy note ---------------------------------------------------------
-- email_bodies is intentionally NOT row-level-secured in this migration.
-- The existing API layer (api/_shared/auth.js) connects with the service
-- role and enforces workspace + role gates in code. Phase 3.5 should add
-- RLS policies on email_bodies so the body columns are only readable by
-- (a) the source_user_id owner and (b) workspace managers, as a
-- defense-in-depth measure once we move toward per-user JWT routing.
