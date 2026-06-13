-- ============================================================================
-- R16 Unit 1 — touchpoint_cadence.metadata (LCC Opps)
-- 2026-06-13
--
-- The contact-acquisition worker (api/_handlers/contact-acquisition.js) needs a
-- per-cadence mark so an entity whose Salesforce account returns no contacts
-- isn't re-hammered (re-queried against the SF flow) every tick. It records
-- that on the cadence under metadata.contact_acquisition:
--   { status: 'acquired' | 'no_contacts' | 'no_usable_contacts' | 'unavailable',
--     attempts, last_attempt_at, ... }
-- An 'acquired' cadence also carries contact_id/sf_contact_id, so it naturally
-- drops out of the contactless working set; the marker is what stops the
-- definitively-empty (no_contacts) and capped-transient (unavailable) rows from
-- recycling.
--
-- Additive + nullable + no default rewrite (instant DDL). Cache-or-live safe:
-- nothing reads this column except the worker's own selection filter, so apply
-- order vs the JS deploy is irrelevant (an unset column reads as "not yet
-- attempted", the correct starting state).
-- Apply on LCC Opps (xengecqvemvfknjvbvrq).
-- ============================================================================

ALTER TABLE public.touchpoint_cadence
  ADD COLUMN IF NOT EXISTS metadata jsonb;
