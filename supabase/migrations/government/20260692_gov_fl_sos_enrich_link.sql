-- ============================================================================
-- FL SOS enrich → compare → link engine (2026-05-31)
-- ----------------------------------------------------------------------------
-- Authority model (Scott, 2026-05-31):
--   * recorded ownership  = authoritative for WHO OWNS THE REAL ESTATE
--   * SOS entity registration (property state + formation state) = authoritative
--     for THAT ENTITY's own ownership/control (agent, officers, managers)
--   * LCC/Salesforce company+contact = the relationship graph
-- The engine reads the first two together, compares against the third for
-- commonalities (shared agent / officer / address / principal), and links
-- strong matches into the contact structure. Enrichment is ONE-WAY and
-- exact-match-only; only confirmed-FL recorded owners are eligible.
--
-- This migration adds the columns + the link-candidate ledger. The enrichment
-- write-back targets columns that already exist on recorded_owners
-- (registered_agent_name, manager_name, filing_id/date/status, filing_state).
-- ============================================================================

-- 1. Enrichment provenance on recorded_owners (so we never re-enrich blindly
--    and can audit where a value came from). Additive; existing values kept.
ALTER TABLE public.recorded_owners
  ADD COLUMN IF NOT EXISTS sos_enriched_at      timestamptz,
  ADD COLUMN IF NOT EXISTS sos_enrich_source    text,        -- 'sos_fl'
  ADD COLUMN IF NOT EXISTS sos_match_corp_number text,       -- Sunbiz doc number the enrichment came from
  ADD COLUMN IF NOT EXISTS sos_match_kind       text;        -- 'exact' | 'none'

-- 2. Link-candidate ledger: one row per (recorded_owner, unified_contact)
--    commonality found. Holds the EVIDENCE so a human (or the auto-linker) can
--    judge. Strong multi-signal rows auto-link; weak rows wait in review.
CREATE TABLE IF NOT EXISTS public.recorded_owner_contact_links (
  link_id            bigserial PRIMARY KEY,
  recorded_owner_id  uuid NOT NULL REFERENCES public.recorded_owners(recorded_owner_id) ON DELETE CASCADE,
  unified_id         uuid,                          -- unified_contacts.unified_id
  sf_account_id      text,
  sf_contact_id      text,
  -- What matched (the evidence). Each is the normalized value that coincided.
  match_signals      text[] NOT NULL DEFAULT '{}',  -- e.g. {registered_agent_name, address, officer_name}
  signal_count       int NOT NULL DEFAULT 0,
  match_strength     text NOT NULL DEFAULT 'weak',  -- 'strong' (auto-linkable) | 'weak' (review)
  evidence           jsonb,                          -- {agent:'...', owner_addr:'...', contact_co:'...'}
  link_status        text NOT NULL DEFAULT 'proposed', -- proposed | auto_linked | confirmed | rejected
  decided_by         text,
  decided_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recorded_owner_id, unified_id)
);

CREATE INDEX IF NOT EXISTS idx_ro_links_status   ON public.recorded_owner_contact_links (link_status);
CREATE INDEX IF NOT EXISTS idx_ro_links_strength ON public.recorded_owner_contact_links (match_strength);
CREATE INDEX IF NOT EXISTS idx_ro_links_owner    ON public.recorded_owner_contact_links (recorded_owner_id);

COMMENT ON TABLE public.recorded_owner_contact_links IS
  'FL SOS enrich-compare-link engine: commonalities between SOS-enriched recorded owners and LCC/SF unified_contacts. Strong multi-signal links auto-apply; weak links surface in the Review Console for human decision.';

-- 3. Review surface: weak/proposed links awaiting a human decision, with the
--    owner + contact context joined in (drives the Review Console lane).
CREATE OR REPLACE VIEW public.v_recorded_owner_link_review AS
SELECT l.link_id, l.recorded_owner_id, l.unified_id, l.sf_account_id,
       l.match_signals, l.signal_count, l.match_strength, l.evidence, l.created_at,
       ro.name           AS recorded_owner_name,
       ro.state          AS owner_state,
       ro.filing_state   AS owner_filing_state,
       ro.registered_agent_name,
       ro.manager_name,
       uc.full_name      AS contact_name,
       uc.company_name   AS contact_company
FROM public.recorded_owner_contact_links l
JOIN public.recorded_owners ro  ON ro.recorded_owner_id = l.recorded_owner_id
LEFT JOIN public.unified_contacts uc ON uc.unified_id = l.unified_id
WHERE l.link_status = 'proposed' AND l.match_strength = 'weak';
