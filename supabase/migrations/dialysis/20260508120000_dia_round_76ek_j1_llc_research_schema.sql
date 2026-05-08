-- Round 76ek.j Phase 1a (2026-05-08) — dia DB LLC research enrichment schema.
--
-- Mirror of the gov migration. dia.recorded_owners already has
-- registered_agent_name / registered_agent_address / state_of_incorporation
-- columns from an earlier round, so this migration only adds the missing
-- columns plus the queue table.
--
-- See gov migration for full rationale.

BEGIN;

-- ── 1. dia.recorded_owners column extensions ────────────────────────────────
ALTER TABLE public.recorded_owners
  ADD COLUMN IF NOT EXISTS manager_name              text,
  ADD COLUMN IF NOT EXISTS manager_role              text,
  ADD COLUMN IF NOT EXISTS filing_id                 text,
  ADD COLUMN IF NOT EXISTS filing_date               date,
  ADD COLUMN IF NOT EXISTS filing_status             text,
  ADD COLUMN IF NOT EXISTS llc_research_at           timestamptz,
  ADD COLUMN IF NOT EXISTS llc_research_source       text;

-- dia uses state_of_incorporation rather than filing_state. Application code
-- writes to whichever exists per-domain. No additional column added.

CREATE INDEX IF NOT EXISTS recorded_owners_state_of_incorp_idx
  ON public.recorded_owners (state_of_incorporation);

CREATE INDEX IF NOT EXISTS recorded_owners_llc_research_at_idx
  ON public.recorded_owners (llc_research_at)
  WHERE llc_research_at IS NULL;

-- ── 2. dia.llc_research_queue ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.llc_research_queue (
  queue_id            bigserial PRIMARY KEY,
  recorded_owner_id   uuid NOT NULL
                        REFERENCES public.recorded_owners(recorded_owner_id) ON DELETE CASCADE,
  property_id         integer
                        REFERENCES public.properties(property_id) ON DELETE SET NULL,
  search_name         text NOT NULL,
  guessed_state       text,
  status              text NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued','in_progress','done','failed','unsupported_state','no_match')),
  attempts            integer NOT NULL DEFAULT 0,
  last_attempt_at     timestamptz,
  last_error          text,
  found_filing_id     text,
  found_filing_state  text,
  enrichment_payload  jsonb,
  created_at          timestamptz DEFAULT now(),
  resolved_at         timestamptz,
  UNIQUE (recorded_owner_id)
);

CREATE INDEX IF NOT EXISTS llc_research_queue_status_created_idx
  ON public.llc_research_queue (status, created_at)
  WHERE status IN ('queued','failed');

CREATE INDEX IF NOT EXISTS llc_research_queue_state_idx
  ON public.llc_research_queue (guessed_state, status);

COMMIT;
