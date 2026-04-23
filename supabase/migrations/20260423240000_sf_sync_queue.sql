-- ============================================================================
-- Migration: sf_sync_queue — outbound queue of Salesforce writes that LCC
--            wants a Power Automate flow to execute on its behalf.
--
-- Target:    LCC Opps Supabase (OPS_SUPABASE_URL)
--
-- Why: Scott's SF org uses SSO and he can't register a Connected App for
-- OAuth writes. Reads go through a PA proxy (sf_lookup flow). Writes need
-- the same plumbing, but kicking a write off from the LCC UI happens in
-- real time, whereas the PA flow that performs it runs on a schedule.
-- Decouple them via a queue table: LCC writes a row, PA polls / triggers
-- on-insert, writes to SF, and updates the row's status.
--
-- Schema:
--   id              — PK
--   workspace_id    — multi-tenant scope
--   kind            — enum-ish: 'create_account' | 'create_opportunity' | ...
--   payload         — jsonb with the operation-specific fields
--   status          — 'pending' | 'processing' | 'done' | 'failed'
--   result          — jsonb (sf_id, error detail, etc.) once resolved
--   requested_by    — display name of the LCC user who clicked the button
--   requested_at, processed_at — timestamps
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.sf_sync_queue (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid,
  kind          text NOT NULL CHECK (kind IN ('create_account','create_opportunity','update_account','find_account','link_contact')),
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','done','failed')),
  result        jsonb,
  requested_by  text,
  requested_at  timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz
);

CREATE INDEX IF NOT EXISTS sf_sync_queue_status_idx   ON public.sf_sync_queue (status, requested_at);
CREATE INDEX IF NOT EXISTS sf_sync_queue_workspace_idx ON public.sf_sync_queue (workspace_id, requested_at DESC);

COMMENT ON TABLE public.sf_sync_queue IS
  'Outbound queue of SF writes (create Account, create Opportunity, etc.). LCC UI pushes rows here; a Power Automate flow polls and executes them against Salesforce, then updates status/result. Use when a click in the LCC needs to become a write in an SF org that LCC cannot authenticate to directly.';
