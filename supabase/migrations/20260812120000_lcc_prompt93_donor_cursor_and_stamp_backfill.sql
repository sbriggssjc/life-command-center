-- ============================================================================
-- Prompt 93 — two micros:
--   A. Donor-handoff treadmill: give the nightly donor tick a resumable keyset
--      cursor so it WALKS the full blank-contact pool instead of re-scanning the
--      same fixed top-slice forever (the 4th "walk-the-pool" instance, class of
--      prompts 83/84/92). This migration only adds the cursor STORAGE columns;
--      the walk logic lives in api/admin.js::handleSfDonorHandoffTick.
--   B. Aug-10 provider-stamp escape: reconstruct the `_provider` stamp on the
--      post-prompt-82 bare `staged_intake_extractions` rows (the 72-row Aug-10
--      burst that wrote before the write-site stamp deploy landed) from each
--      row's OWN persisted extraction diagnostics — accurate, reversible,
--      idempotent, scoped to the post-stamp window so genuine pre-stamp "old
--      rows" keep their honest absent-stamp semantics.
--
-- Discipline: additive · fill-blanks-only (only bare rows) · reversible (backup
-- table) · idempotent (re-run touches 0 rows) · never fabricates a provider
-- (a reconstructed stamp carries `reconstructed_from` so it is never confused
-- with a genuine at-write stamp).
-- ============================================================================

BEGIN;

-- ── A. Donor-coverage-log cursor columns ─────────────────────────────────────
-- The donor tick appends one coverage row per (domain, run); it now also carries
-- the keyset position it walked TO (max contact_id scanned this run) and how many
-- times it has WRAPPED the pool. The tick reads the latest row per domain to
-- resume; on wrap it restarts from the top (a full wrap cycle is the re-check,
-- since re-score can mint new owner->SF links that create matches in already-
-- scanned windows).
ALTER TABLE public.lcc_w9_3_donor_coverage_log
  ADD COLUMN IF NOT EXISTS scan_cursor_to  text,
  ADD COLUMN IF NOT EXISTS windows_wrapped int;

COMMENT ON COLUMN public.lcc_w9_3_donor_coverage_log.scan_cursor_to IS
  'Prompt 93: keyset cursor (max contacts.contact_id) this donor run scanned to; NULL after a wrap (restart from top). Resumes the full blank-contact pool walk.';
COMMENT ON COLUMN public.lcc_w9_3_donor_coverage_log.windows_wrapped IS
  'Prompt 93: running count of times the donor scan has wrapped the blank-contact pool for this domain.';

-- ── B. Provider-stamp reconstruction backfill ────────────────────────────────
-- Backup every row we are about to touch (reversal = restore extraction_snapshot
-- from here, or simply strip the reconstructed _provider — see runbook foot).
CREATE TABLE IF NOT EXISTS public._lcc_provider_stamp_backfill_20260812_backup (
  id                  uuid,
  intake_id           uuid,
  created_at          timestamptz,
  extraction_snapshot jsonb,
  backed_up_at        timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public._lcc_provider_stamp_backfill_20260812_backup (id, intake_id, created_at, extraction_snapshot)
SELECT se.id, se.intake_id, se.created_at, se.extraction_snapshot
  FROM public.staged_intake_extractions se
 WHERE se.created_at >= '2026-08-08'                     -- window since the stamp existed
   AND NOT (se.extraction_snapshot ? '_provider')        -- fill-blanks: only bare rows
   AND NOT EXISTS (                                       -- idempotent: skip already-backed-up
     SELECT 1 FROM public._lcc_provider_stamp_backfill_20260812_backup b WHERE b.id = se.id
   );

-- Reconstruct the stamp from the sibling staged_intake_items row's persisted
-- per-artifact diagnostics (ai_final_provider / ai_final_model / ai_fell_back /
-- ai_chain — the exact __lastAiCallInfo data the write site would have stamped).
-- Winning diagnostic = the successful one (ai_ok), preferring one that names a
-- provider. When no diagnostics survive (e.g. a non-deal row dispositioned before
-- the downstream diagnostics PATCH), stamp final_provider='none' with a distinct
-- reconstructed_from marker — honest "escaped the write-site stamp; provider
-- unknown", never a fabricated provider.
WITH targets AS (
  SELECT se.id, se.intake_id, diag.d AS diagnostic
    FROM public.staged_intake_extractions se
    JOIN public.staged_intake_items si ON si.intake_id = se.intake_id
    LEFT JOIN LATERAL (
      SELECT d
        FROM jsonb_array_elements(
               COALESCE(si.raw_payload #> '{extraction_result,diagnostics}', '[]'::jsonb)
             ) AS d
       ORDER BY ( (d->>'ai_ok')::boolean ) DESC NULLS LAST,
                ( (d->>'ai_final_provider') IS NOT NULL ) DESC
       LIMIT 1
    ) diag ON TRUE
   WHERE se.created_at >= '2026-08-08'
     AND NOT (se.extraction_snapshot ? '_provider')
)
UPDATE public.staged_intake_extractions se
   SET extraction_snapshot = jsonb_set(
         se.extraction_snapshot,
         '{_provider}',
         CASE
           WHEN t.diagnostic IS NOT NULL AND (t.diagnostic->>'ai_final_provider') IS NOT NULL THEN
             jsonb_build_object(
               'final_provider', t.diagnostic->>'ai_final_provider',
               'final_model',    t.diagnostic->>'ai_final_model',
               'fell_back',      COALESCE((t.diagnostic->>'ai_fell_back')::boolean, false),
               'chain',          COALESCE(
                                   (SELECT jsonb_agg(c->>'stage')
                                      FROM jsonb_array_elements(COALESCE(t.diagnostic->'ai_chain','[]'::jsonb)) c
                                     WHERE (c->>'stage') IS NOT NULL),
                                   '[]'::jsonb),
               'stamped_at',        to_jsonb(now()),
               'reconstructed_from', 'diagnostics'
             )
           ELSE
             jsonb_build_object(
               'final_provider', 'none',
               'final_model',    NULL,
               'fell_back',      false,
               'chain',          '[]'::jsonb,
               'stamped_at',        to_jsonb(now()),
               'reconstructed_from', 'no_diagnostics_post_stamp'
             )
         END,
         true)
  FROM targets t
 WHERE se.id = t.id;

COMMIT;

-- ── Verify (run after apply) ─────────────────────────────────────────────────
--   SELECT count(*) FILTER (WHERE extraction_snapshot ? '_provider') AS stamped,
--          count(*)                                                  AS total
--     FROM public.staged_intake_extractions WHERE created_at >= '2026-08-08';
--   -- expect stamped = total (100% post-stamp coverage)
--
-- ── REVERSAL RUNBOOK ─────────────────────────────────────────────────────────
--   -- Restore the exact pre-backfill snapshots:
--   UPDATE public.staged_intake_extractions se
--      SET extraction_snapshot = b.extraction_snapshot
--     FROM public._lcc_provider_stamp_backfill_20260812_backup b
--    WHERE se.id = b.id;
--   -- OR just strip the reconstructed stamps (leaves genuine at-write stamps):
--   UPDATE public.staged_intake_extractions
--      SET extraction_snapshot = extraction_snapshot - '_provider'
--    WHERE extraction_snapshot #>> '{_provider,reconstructed_from}' IS NOT NULL;
--   DROP TABLE public._lcc_provider_stamp_backfill_20260812_backup;
