-- Round 76ek.j Phase 1a (2026-05-08) — gov DB LLC research enrichment schema.
--
-- Foundation for automated owner-LLC research. When the sidebar pipeline
-- captures a private-LLC owner ("Martek Ice IDF LLC", "Kirts West LLC",
-- etc.), we want to independently verify it via state Secretary of State
-- records — registered agent, manager, filing status, principal addresses
-- — so the LCC can flag mismatches between CoStar's "true owner" / "true
-- buyer" attribution and the actual filing record.
--
-- Phase 1a (this migration): data model only.
--   - Extend gov.recorded_owners with the LLC-research columns.
--   - Add gov.llc_research_queue for the work-list.
--
-- Phase 1b (next round): writer hook in upsertDomainOwners that enqueues
--   newly-created private-LLC recorded_owners with llc_research_at IS NULL.
--   Plus a manual-trigger admin endpoint to drain the queue for testing.
--
-- Phase 2 (later round): Michigan SOS (LARA) research handler + per-state
--   handlers + cron schedule.

BEGIN;

-- ── 1. gov.recorded_owners column extensions ────────────────────────────────
ALTER TABLE public.recorded_owners
  ADD COLUMN IF NOT EXISTS manager_name              text,
  ADD COLUMN IF NOT EXISTS manager_role              text,        -- 'manager' | 'member' | 'president' | etc
  ADD COLUMN IF NOT EXISTS registered_agent_name     text,
  ADD COLUMN IF NOT EXISTS registered_agent_address  text,
  ADD COLUMN IF NOT EXISTS filing_state              text,        -- 'MI', 'DE', 'NV', etc (canonical 2-letter)
  ADD COLUMN IF NOT EXISTS filing_id                 text,        -- state SOS filing/ID number
  ADD COLUMN IF NOT EXISTS filing_date               date,
  ADD COLUMN IF NOT EXISTS filing_status             text,        -- 'active' | 'dissolved' | 'in_default'
  ADD COLUMN IF NOT EXISTS llc_research_at           timestamptz,
  ADD COLUMN IF NOT EXISTS llc_research_source       text;        -- 'mi_lara' | 'opencorporates' | 'manual'

CREATE INDEX IF NOT EXISTS recorded_owners_filing_state_idx
  ON public.recorded_owners (filing_state);

CREATE INDEX IF NOT EXISTS recorded_owners_llc_research_at_idx
  ON public.recorded_owners (llc_research_at)
  WHERE llc_research_at IS NULL;     -- partial index: speeds the "needs research" query

-- ── 2. gov.llc_research_queue ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.llc_research_queue (
  queue_id            bigserial PRIMARY KEY,
  recorded_owner_id   uuid NOT NULL
                        REFERENCES public.recorded_owners(recorded_owner_id) ON DELETE CASCADE,
  property_id         bigint
                        REFERENCES public.properties(property_id) ON DELETE SET NULL,
  search_name         text NOT NULL,           -- LLC name to look up
  guessed_state       text,                    -- best-effort state from address/sales
  status              text NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued','in_progress','done','failed','unsupported_state','no_match')),
  attempts            integer NOT NULL DEFAULT 0,
  last_attempt_at     timestamptz,
  last_error          text,
  found_filing_id     text,
  found_filing_state  text,
  enrichment_payload  jsonb,                   -- raw response for audit
  created_at          timestamptz DEFAULT now(),
  resolved_at         timestamptz,
  UNIQUE (recorded_owner_id)                   -- one queue entry per owner
);

CREATE INDEX IF NOT EXISTS llc_research_queue_status_created_idx
  ON public.llc_research_queue (status, created_at)
  WHERE status IN ('queued','failed');         -- partial: drives the worker pull

CREATE INDEX IF NOT EXISTS llc_research_queue_state_idx
  ON public.llc_research_queue (guessed_state, status);

COMMIT;

-- Verification:
--   SELECT to_regclass('public.llc_research_queue');
--   SELECT count(*) FROM information_schema.columns
--     WHERE table_name='recorded_owners' AND column_name LIKE 'filing_%';
