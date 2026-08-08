-- ============================================================================
-- W9.3 (gov) — reversible ledgers for the SF-link re-score (WS2) + donor
-- handoff (WS3). Applied live to gov (scknotsqkcheojiaewwh).
--
-- The re-score re-dispositions sf_link_research_queue no_match rows and (on an
-- auto_link) writes true_owners/recorded_owners.sf_account_id null-guarded, with a
-- provenance_event_log source='splink_v2' row (drained to LCC field_provenance by
-- the W2.5 flush). The donor handoff fills contacts.sf_contact_id from the SF
-- account->contacts bridge. Both are reversible by these ledgers + batch tag.
--
-- Additive only. Doctrine: fill-blanks · conservative/unambiguous · provenance ·
-- reversible · idempotent · dry-run-able.
--
-- REVERSAL (WS2):
--   -- restore no_match on rows this batch moved (and clear a machine-written link):
--   UPDATE public.true_owners t SET sf_account_id = NULL
--     FROM public.w9_3_rescore_log l
--    WHERE l.batch_tag = '<tag>' AND l.applied AND l.new_status='linked'
--      AND l.source_table='true_owners' AND t.true_owner_id = l.source_id;
--   -- (same for recorded_owners); then:
--   UPDATE public.sf_link_research_queue q SET status = l.prior_status
--     FROM public.w9_3_rescore_log l WHERE l.batch_tag='<tag>' AND q.queue_id = l.queue_id;
-- REVERSAL (WS3):
--   UPDATE public.contacts c SET sf_contact_id = NULL
--     FROM public.w9_3_donor_handoff_log l
--    WHERE l.batch_tag='<tag>' AND l.applied AND c.contact_id = l.contact_id;
-- ============================================================================

BEGIN;

-- WS2 re-score ledger: one row per re-scored queue row that changed disposition
-- (or was auto-linked). Fully reversible: prior_status + prior_sf_value captured.
CREATE TABLE IF NOT EXISTS public.w9_3_rescore_log (
  id               bigserial PRIMARY KEY,
  queue_id         uuid,
  source_table     text,          -- true_owners | recorded_owners
  source_id        uuid,          -- the owner pk
  prior_status     text,          -- was 'no_match'
  new_status       text,          -- linked | needs_review | no_match
  band             text,          -- auto_link | needs_review | no_match
  probability      numeric,
  sf_account_id    text,          -- the resolved candidate
  sf_account_name  text,
  prior_sf_value   text,          -- owner's sf col value before an auto-link write (null on clean)
  conflict         boolean DEFAULT false,
  applied          boolean DEFAULT false,   -- true when an owner sf-col write actually happened
  batch_tag        text,
  source_run_id    text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_w9_3_rescore_log_batch ON public.w9_3_rescore_log (batch_tag);
CREATE INDEX IF NOT EXISTS idx_w9_3_rescore_log_queue ON public.w9_3_rescore_log (queue_id);

-- WS3 donor-handoff ledger: one row per contact stamped with a person-level
-- sf_contact_id from the account->contacts bridge (fill-blanks, unique name match).
CREATE TABLE IF NOT EXISTS public.w9_3_donor_handoff_log (
  id               bigserial PRIMARY KEY,
  contact_id       uuid,
  sf_contact_id    text,
  owner_table      text,          -- true_owners | recorded_owners
  owner_id         uuid,
  sf_account_id    text,          -- the account the id was expanded from
  matched_by       text,          -- 'unique_name_match'
  applied          boolean DEFAULT false,
  batch_tag        text,
  source_run_id    text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_w9_3_donor_handoff_log_batch ON public.w9_3_donor_handoff_log (batch_tag);
CREATE INDEX IF NOT EXISTS idx_w9_3_donor_handoff_log_contact ON public.w9_3_donor_handoff_log (contact_id);

COMMIT;
