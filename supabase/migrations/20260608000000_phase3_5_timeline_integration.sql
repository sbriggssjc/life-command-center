-- ============================================================================
-- Phase 3.5 — Timeline integration
-- ----------------------------------------------------------------------------
-- Wires Salesforce / Outlook / Calendar / Teams touches into the canonical
-- `activity_events` timeline so the entity sidebar can render "Bob emailed
-- you yesterday" without the UI having to query each per-source table.
--
-- Two changes:
--
--   1. unified_contacts.entity_id  — direct link to the canonical
--      entities row. Lets handlers resolve entity_id with a single SELECT
--      instead of walking external_identities. Backfilled here from
--      existing SF Contact external_identities.
--
--   2. ux_activity_events_source_external  — partial unique index
--      providing idempotency for ingest handlers. Retried SF batches and
--      replayed Outlook delta pages won't double-insert timeline rows.
-- ============================================================================

-- ---- unified_contacts.entity_id -------------------------------------------

alter table unified_contacts
  add column if not exists entity_id uuid;

create index if not exists ix_unified_contacts_entity_id
  on unified_contacts (entity_id)
  where entity_id is not null;

-- Backfill from SF Contact external_identities. Idempotent — only fills
-- rows where entity_id is currently null AND we have a sf_contact_id that
-- matches an existing external_identities row.
update unified_contacts uc
set entity_id = ei.entity_id
from external_identities ei
where uc.entity_id is null
  and uc.sf_contact_id is not null
  and ei.source_system = 'salesforce'
  and ei.source_type   = 'Contact'
  and ei.external_id   = uc.sf_contact_id;

-- ---- activity_events idempotency idx --------------------------------------
-- Partial — only enforces uniqueness when both source_type and external_id
-- are present. Existing rows with NULLs in either column are unaffected.
-- This is the right shape because manually-logged activity_events (from the
-- existing system) don't carry source_type/external_id and shouldn't dedup.

create unique index if not exists ux_activity_events_source_external
  on activity_events (workspace_id, source_type, external_id)
  where source_type is not null and external_id is not null;
