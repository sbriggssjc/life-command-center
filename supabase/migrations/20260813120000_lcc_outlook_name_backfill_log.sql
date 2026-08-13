-- ============================================================================
-- Prompt 101 (W9.4 accelerator) — Outlook display-name BACKFILL audit ledger.
-- ----------------------------------------------------------------------------
-- The backfill (POST /api/outlook-name-backfill) reconstructs
-- activity_events.metadata.from_name / to_names on historical correspondence
-- rows from the curated unified_contacts name store (fill-blanks, provenance-
-- marked in metadata.name_backfill). This append-only ledger records exactly
-- which rows a batch touched, so a batch is auditable and reversible even if the
-- in-row marker were later stripped.
--
-- Reversal is primarily driven by the in-row marker (metadata.name_backfill.batch
-- = <tag>); this table is the durable audit + a fallback list of touched ids.
-- Additive, reversible (DROP TABLE), idempotent (IF NOT EXISTS).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.lcc_outlook_name_backfill_log (
  id                 bigserial PRIMARY KEY,
  batch_tag          text        NOT NULL,
  activity_event_id  uuid        NOT NULL,
  filled_from_name   boolean     NOT NULL DEFAULT false,
  filled_to_names    integer     NOT NULL DEFAULT 0,
  source             text        NOT NULL DEFAULT 'unified_contacts',
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outlook_name_backfill_log_batch
  ON public.lcc_outlook_name_backfill_log (batch_tag);
CREATE INDEX IF NOT EXISTS idx_outlook_name_backfill_log_event
  ON public.lcc_outlook_name_backfill_log (activity_event_id);

-- Case-insensitive, batched email -> display-name resolver over the curated
-- unified_contacts store (the ONLY structured historical name source; see the
-- handler header for the grounding correction re: email_bodies.from_name being
-- empty). PostgREST `in.()` is case-sensitive and unified_contacts.email is not
-- reliably lowercased, so the backfill resolves names through this RPC instead of
-- a direct filter. STABLE, read-only. Picks the longest full_name per email as a
-- coarse best (fuller name > initials).
CREATE OR REPLACE FUNCTION public.lcc_names_for_emails(p_emails text[])
RETURNS TABLE(email_lower text, full_name text)
LANGUAGE sql STABLE AS $$
  SELECT DISTINCT ON (lower(uc.email))
         lower(uc.email) AS email_lower, uc.full_name
  FROM public.unified_contacts uc
  WHERE uc.email IS NOT NULL
    AND uc.full_name IS NOT NULL AND btrim(uc.full_name) <> ''
    AND lower(uc.email) = ANY (SELECT lower(x) FROM unnest(p_emails) AS x)
  ORDER BY lower(uc.email), length(uc.full_name) DESC;
$$;

GRANT EXECUTE ON FUNCTION public.lcc_names_for_emails(text[]) TO anon, authenticated, service_role;

COMMENT ON TABLE public.lcc_outlook_name_backfill_log IS
  'Prompt 101: append-only audit of Outlook display-name backfills onto activity_events.metadata. Reverse a batch via POST /api/outlook-name-backfill?reverse=1&batch=<tag>.';

-- REVERSAL RUNBOOK
--   POST /api/outlook-name-backfill?reverse=1&batch=<tag>   (strips fields + marker)
--   -- or, direct SQL fallback (strips only what the batch filled, per the marker):
--   UPDATE activity_events
--      SET metadata = (metadata - 'name_backfill'
--                      - CASE WHEN (metadata->'name_backfill'->>'from')::boolean THEN 'from_name' END
--                      - CASE WHEN (metadata->'name_backfill'->>'to')::int > 0   THEN 'to_names'  END)
--    WHERE metadata->'name_backfill'->>'batch' = '<tag>';
--   DELETE FROM public.lcc_outlook_name_backfill_log WHERE batch_tag = '<tag>';
