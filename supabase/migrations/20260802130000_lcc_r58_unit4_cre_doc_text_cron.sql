-- ============================================================================
-- R58 "Unit 4" — schedule the CRE doc-text drain tick (LCC Opps)
-- 2026-07-17
--
-- Fills the CRE registry text sidecar (lcc_cre_property_document_text) so a lease/
-- DD/OM is OCR'd ONCE and every access point + Unit 4 reuse the same text. This is
-- the CRE-side twin of `lcc-document-text` (which drains the domain dbs). Handler:
-- api/_handlers/cre-doc-text.js, routed via api/intake.js (?_route=cre-doc-text-tick).
--
--   POST /api/intake?_route=cre-doc-text-tick&mode=eligible&limit=15
--     -> registry lease/dd/om with NO sidecar (newest first, cap 15)
--     -> Unit-1 extractDocumentText (tiered OCR; DocAI layout preferred for page
--        anchors) -> upsert the sidecar. needs_ocr recorded (terminal-this-pass);
--        transient fetch failure left for the next tick.
--     -> GET = dry-run (lists the queue, no fetch/OCR/writes).
--
-- Cadence: GENTLE — every 30 min, cap 15/tick (the artifact-offload lesson: do
-- NOT hammer). The cap+repeat-tick model drains the ~761-doc backlog (444 lease +
-- 250 dd + 67 om) over a day, then maintains coverage as new docs are registered
-- (a newly-filed doc has no sidecar → the next eligible tick picks it up). The
-- `eligible` scan EXCLUDES docs that already have a sidecar, so it never re-OCRs.
--
-- Two lanes:
--   • `eligible` (scheduled here) — the complete, idempotent drain. Safe on the
--     current deploy on its own.
--   • `jobs` (commented below) — the efficient FORWARD lane that drains the
--     `cre.doc.text` enrichment_jobs the classify bridge enqueues at intake. It
--     is only free of double-OCR once the runPropertyDocText idempotency guard
--     (skip-if-fresh-sidecar) is deployed — ENABLE it after that redeploy, at
--     which point `eligible` becomes the backlog/backstop and `jobs` the primary.
--
-- GATED / graceful: the endpoint needs the deploy carrying api/intake.js's
-- cre-doc-text-tick route (live) + OCR env (OCR_CLOUD_OCR_URL for page anchors).
-- Verify post-schedule with a GET dry-run. Idempotent (unschedule-then-schedule).
-- Apply on LCC Opps (xengecqvemvfknjvbvrq).
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Backlog + steady-state drain (idempotent; safe standalone).
    BEGIN
      PERFORM cron.unschedule('lcc-cre-doc-text-backfill');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    PERFORM cron.schedule(
      'lcc-cre-doc-text-backfill',
      '*/30 * * * *',
      $cmd$SELECT public.lcc_cron_post('/api/intake?_route=cre-doc-text-tick&mode=eligible&limit=15', '{}'::jsonb, 'vercel')$cmd$
    );

    -- Forward jobs-lane — ENABLE after the runPropertyDocText idempotency guard
    -- (skip-if-fresh-sidecar) is deployed, so it never re-OCRs a doc the eligible
    -- sweep already did. Offset by 15 min so the two lanes don't overlap a tick.
    -- BEGIN PERFORM cron.unschedule('lcc-cre-doc-text-jobs'); EXCEPTION WHEN OTHERS THEN NULL; END;
    -- PERFORM cron.schedule(
    --   'lcc-cre-doc-text-jobs',
    --   '15,45 * * * *',
    --   $cmd$SELECT public.lcc_cron_post('/api/intake?_route=cre-doc-text-tick&mode=jobs&limit=15', '{}'::jsonb, 'vercel')$cmd$
    -- );
  END IF;
END $$;
