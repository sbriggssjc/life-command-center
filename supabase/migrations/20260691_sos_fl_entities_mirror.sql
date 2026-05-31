-- ============================================================================
-- SOS-direct FL mirror (free LLC research handler, part b) — 2026-05-31
-- ----------------------------------------------------------------------------
-- Florida Sunbiz publishes the complete Corporate Data File as a fixed-width
-- ASCII .txt (record layout: dos.fl.gov .../corporate-data-file/file-structure).
-- We ingest it into this mirror on LCC Opps so lookupLlc's FL adapter resolves
-- LLC owners by querying the mirror — compliant, free, no per-request scraping,
-- no anti-bot. One canonical mirror serves both the dia + gov research ticks.
--
-- Lives on LCC Opps (the orchestrator) rather than per-domain so FL reference
-- data isn't duplicated. The adapter reads it via opsQuery.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.sos_fl_entities (
  corp_number            text PRIMARY KEY,          -- Sunbiz document number (field 1)
  corp_name              text NOT NULL,             -- field 2
  status                 text,                       -- 'A' active / 'I' inactive (field 3)
  filing_type            text,                       -- DOMP/FLAL/FORL/... (field 4)
  file_date              date,                       -- field 17 (CCYYMMDD)
  -- Registered agent (fields 31-36)
  ra_name                text,
  ra_type                text,                       -- P person / C corporation
  ra_address             text,
  ra_city                text,
  ra_state               text,
  ra_zip                 text,
  -- Officer 1 (the principal we surface; fields 37-43). The full 6-officer
  -- set is kept in officers_json for completeness without 36 flat columns.
  officer1_title         text,
  officer1_name          text,
  officers_json          jsonb,                      -- [{title,type,name,address,city,state,zip}, ...]
  -- Normalized name for fuzzy/exact lookup. Lower-cased, suffix/punct-stripped.
  name_norm              text NOT NULL,
  source_file            text,                       -- CCYYMMDDx.txt the row came from
  ingested_at            timestamptz NOT NULL DEFAULT now()
);

-- Lookup index: the adapter searches by normalized name (optionally bounded to
-- active filings). A trigram index supports both exact and ILIKE/fuzzy match.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_sos_fl_name_norm      ON public.sos_fl_entities (name_norm);
CREATE INDEX IF NOT EXISTS idx_sos_fl_name_norm_trgm ON public.sos_fl_entities USING gin (name_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_sos_fl_status         ON public.sos_fl_entities (status);

COMMENT ON TABLE public.sos_fl_entities IS
  'Florida Sunbiz Corporate Data File mirror. Loaded by scripts/ingest-sunbiz-fl.mjs; read by llc-research.js FL adapter. Reference data — safe to TRUNCATE+reload on each refresh.';
