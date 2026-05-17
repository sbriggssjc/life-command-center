-- ============================================================================
-- Round AUDIT-05a (2026-05-17): cross-domain silent-write capture.
-- Every non-2xx response from a domain DB write (POST / PATCH / PUT / DELETE)
-- lands a row here so the silent-failure pattern (A-3 / D-3) becomes
-- queryable + alertable.
--
-- Closes audit finding A-3 (the table half).
-- Phase B (deferred): gate pushProvenance / recordCoStarFieldsProvenance on
-- success so field_provenance stops recording ghost writes.
--
-- Already applied to LCC Opps (xengecqvemvfknjvbvrq) at 2026-05-17 via
-- Supabase MCP. This file commits the migration to the repo as the
-- historical record.
--
-- Reversal: DROP TABLE public.ingest_write_failures CASCADE;
--           (cascading drops the two views automatically)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ingest_write_failures (
  id                BIGSERIAL PRIMARY KEY,
  occurred_at       timestamptz NOT NULL DEFAULT now(),
  domain            text,                 -- 'dialysis' | 'government' | null
  method            text,                 -- POST / PATCH / PUT / DELETE
  path              text,                 -- PostgREST path (capped 500 chars)
  record_pk         text,                 -- extracted from =eq.<value> if present
  http_status       integer,              -- 400/401/403/404/409/422/5xx
  error_detail      jsonb,                -- PostgREST body
  fields_attempted  text[],               -- column names in the request body
  label             text,                 -- caller-supplied label
  source_run_id     text,                 -- correlation back to intake/sidebar runs
  caller_file       text                  -- 'sidebar-pipeline.js' / 'intake-promoter.js' / 'domain-db.js'
);

CREATE INDEX IF NOT EXISTS ingest_write_failures_occurred_idx
  ON public.ingest_write_failures (occurred_at DESC);
CREATE INDEX IF NOT EXISTS ingest_write_failures_label_idx
  ON public.ingest_write_failures (label);
CREATE INDEX IF NOT EXISTS ingest_write_failures_domain_status_idx
  ON public.ingest_write_failures (domain, http_status);

CREATE OR REPLACE VIEW public.v_ingest_write_failures_recent AS
SELECT
  id, occurred_at, domain, method, path, record_pk,
  http_status, label, source_run_id, fields_attempted, caller_file,
  CASE
    WHEN error_detail IS NULL THEN NULL
    WHEN jsonb_typeof(error_detail) = 'object' AND error_detail ? 'message'
      THEN error_detail->>'message'
    WHEN jsonb_typeof(error_detail) = 'object' AND error_detail ? 'detail'
      THEN error_detail->>'detail'
    ELSE substr(error_detail::text, 1, 200)
  END AS error_summary
FROM public.ingest_write_failures
WHERE occurred_at > now() - interval '7 days'
ORDER BY occurred_at DESC;

CREATE OR REPLACE VIEW public.v_ingest_write_failures_by_label AS
SELECT
  label,
  domain,
  count(*)                                              AS n,
  min(occurred_at)                                      AS first_seen,
  max(occurred_at)                                      AS last_seen,
  array_agg(DISTINCT http_status ORDER BY http_status)  AS http_statuses
FROM public.ingest_write_failures
WHERE occurred_at > now() - interval '30 days'
GROUP BY label, domain
ORDER BY n DESC;
