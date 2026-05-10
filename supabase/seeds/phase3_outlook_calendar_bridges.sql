-- ============================================================================
-- Phase 3 — Seed connector_bridges rows for Outlook + Calendar
-- ----------------------------------------------------------------------------
-- Run per workspace (NOT per user — bridges are workspace-scoped; the
-- per-user `source_user_id` is supplied by each user's PA flow at ingest):
--
--   psql "$OPS_SUPABASE_DB_URL" \
--     -v workspace_id="'<workspace-uuid>'" \
--     -f supabase/seeds/phase3_outlook_calendar_bridges.sql
--
-- Two bridges:
--   outlook.messages  — per-user mailbox stream. Each LCC user runs their
--     own Power Automate flow under their delegated M365 connection that
--     posts /me/messages/delta batches here, tagged with their user id.
--
--   calendar.events   — per-user calendar stream. Same pattern using
--     /me/events/delta.
--
-- Privacy: only emails/events touching at least one tracked unified_contact
-- are stored. Untracked traffic is dropped at the worker. Body access is
-- gated to source_user + workspace managers at the API layer (RLS in 3.5).
-- ============================================================================

\set ws :workspace_id

-- ---- outlook.messages ------------------------------------------------------
insert into connector_bridges (
  workspace_id, bridge_key, source_system, direction, ownership,
  schedule, status, allowlist, write_policy, write_allowlist, notes
) values (
  :ws, 'outlook.messages', 'outlook', 'inbound', 'personal',
  '*/15 * * * *', 'active',
  -- Allowlist of Graph message fields the bridge accepts. Body content is
  -- accepted as a unit (`body`) and split into body_text / body_html by
  -- the handler based on body.contentType.
  jsonb_build_object('Message', jsonb_build_array(
    'id','internetMessageId','conversationId',
    'subject','bodyPreview','body',
    'from','toRecipients','ccRecipients',
    'receivedDateTime','sentDateTime',
    'hasAttachments','isDraft','isRead'
  )),
  'none', '{}'::jsonb,
  'Per-user mailbox feed. Each LCC user runs a delegated PA flow that POSTs ' ||
  '/me/messages/delta batches with X-LCC-Source-User-Id header. Only messages ' ||
  'where at least one party is in unified_contacts are stored; other traffic dropped.'
) on conflict (workspace_id, bridge_key) do update set
  allowlist = excluded.allowlist,
  schedule  = excluded.schedule,
  notes     = excluded.notes,
  updated_at = now();

-- ---- calendar.events -------------------------------------------------------
insert into connector_bridges (
  workspace_id, bridge_key, source_system, direction, ownership,
  schedule, status, allowlist, write_policy, write_allowlist, notes
) values (
  :ws, 'calendar.events', 'calendar', 'inbound', 'personal',
  '*/15 * * * *', 'active',
  jsonb_build_object('Event', jsonb_build_array(
    'id','iCalUId','subject','bodyPreview',
    'start','end','location','isOnlineMeeting','onlineMeetingUrl',
    'organizer','attendees',
    'createdDateTime','lastModifiedDateTime'
  )),
  'none', '{}'::jsonb,
  'Per-user calendar feed. Each LCC user runs a delegated PA flow that POSTs ' ||
  '/me/events/delta batches with X-LCC-Source-User-Id. Events with at least one ' ||
  'tracked attendee are upserted to meetings; entity_links resolved best-effort.'
) on conflict (workspace_id, bridge_key) do update set
  allowlist = excluded.allowlist,
  schedule  = excluded.schedule,
  notes     = excluded.notes,
  updated_at = now();
