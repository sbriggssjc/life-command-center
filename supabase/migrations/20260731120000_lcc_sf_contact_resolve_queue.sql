-- ============================================================================
-- SF-CONTACT-RECONCILE Unit 1 — the WhoId resolve queue (LCC Opps)
-- 2026-07-15
--
-- The SF Activity Sync PA flow sends each Task's WhoId (Contact id) + WhatId,
-- but the Salesforce connector cannot return relationship fields (Who.Name is
-- rejected), and per-record lookups inside the recurring flow are far too slow.
-- So the flow stays simple/fast (WhoId/WhatId only), and LCC resolves only the
-- handful of WhoIds it actually wants to mint — a few new contacts per sync, not
-- every Task — via a tiny, reliable "SF Get Contact By Id" flow.
--
-- This table is the bounded backlog of WhoIds the ingest saw on an activity but
-- could NOT resolve to an LCC entity (and that aren't already an entity). The
-- resolver worker (api/_handlers/sf-contact-resolve.js →
-- ?_route=sf-contact-resolve-tick) drains it: get-by-id → mint (or attach-by-
-- email via ensureEntityLink's R39 tier) → run the SF account/email mismatch
-- detector → mark the row.
--
--   status:
--     seen       — enqueued, not yet resolved (the drain set)
--     resolved   — minted/attached an LCC entity (resolved_entity_id set)
--     no_data    — the by-id flow returned nothing (Lead / blank / deleted)
--     dead       — exceeded SF_RESOLVE_MAX_ATTEMPTS (dead-letter, stop retrying)
--
-- Idempotent on who_id (PK): the ingest upserts with ignore-duplicates, so a
-- re-POST of the same Task never resets an existing row's attempts/status.
-- Additive + reversible (DROP TABLE → zero trace). Nothing else reads it, so
-- apply order vs the JS deploy is irrelevant (the worker no-ops on an empty /
-- absent table; a missing table just means the ingest enqueue is a soft no-op).
-- Apply on LCC Opps (xengecqvemvfknjvbvrq).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.sf_contact_resolve_queue (
  who_id             text PRIMARY KEY,
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  attempts           int         NOT NULL DEFAULT 0,
  status             text        NOT NULL DEFAULT 'seen'
                       CHECK (status IN ('seen', 'resolved', 'no_data', 'dead')),
  last_attempt_at    timestamptz,
  workspace_id       uuid,
  resolved_entity_id uuid,
  detail             text
);

-- The drain selects the workable set (status='seen') oldest-first; keep it cheap.
CREATE INDEX IF NOT EXISTS idx_sf_contact_resolve_queue_seen
  ON public.sf_contact_resolve_queue (first_seen_at)
  WHERE status = 'seen';
