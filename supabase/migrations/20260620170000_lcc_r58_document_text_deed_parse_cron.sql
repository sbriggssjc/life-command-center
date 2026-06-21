-- ============================================================================
-- R58 — schedule the document-text / deed-parse tick (LCC Opps)
--
-- Background (AUDIT_document_intelligence_2026-06-20): we file documents well but
-- only OMs are deeply extracted. 1,975 property_documents carry empty raw_text;
-- deed/lease/other are filed (url_captured) but never read. The deed parser
-- (api/_handlers/deed-parser.js) was BUILT but ORPHANED (zero callers) AND
-- schema-stale, so ~317 recorded deeds (158 dia + 159 gov) — each carrying the
-- authoritative grantor/grantee/transfer-tax-implied price — sat unparsed.
--
-- New api/intake.js sub-route (api/_handlers/document-text.js):
--   POST /api/document-text-tick?domain=both&doctype=deed&limit=15
--     -> selects property_documents with NULL raw_text (newest first)
--     -> fetches bytes (CoStar CDN deeds = direct https; SharePoint = Get flow)
--     -> extracts text: digital pdf-parse first, gpt-4o vision OCR fallback
--        (the SAME OCR that rescued the zero-text Fresenius OM)
--     -> writes property_documents.raw_text + ingestion_status
--     -> for deed docs, runs processDeedDocument: deed_records (archival) +
--        properties.latest_deed_grantee (FEEDS R51 v_owner_source_conflict) +
--        a confirm-gated implied-price candidate on a matching sale
--     -> GET = dry-run (no fetch/OCR/writes)
--
-- Cadence: GENTLE — every 30 minutes, capped 15/tick (the artifact-offload
-- lesson: do NOT hammer; the cap + repeat-tick model drains the ~317-deed
-- backlog over a day, then maintains coverage as new deeds are captured). This
-- IS the forward path too: a newly-captured deed lands url_captured (NULL
-- raw_text) and the next tick picks it up.
--
-- GATED / graceful: the endpoint 404s until intake.js ships (verify post-deploy
-- with a GET dry-run, same posture as lcc-folder-feed). Digital-text deeds parse
-- without OPENAI_API_KEY; scanned deeds need the key for OCR and otherwise record
-- ingestion_status='needs_ocr' (sized for follow-up, never an error). The
-- implied-price fill stays OFF until DEED_IMPLIED_PRICE_FILL is set in the
-- Railway env — until then the price is a recorded candidate only.
--
-- Apply on LCC Opps (xengecqvemvfknjvbvrq).
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Idempotent: drop any prior schedule before reinstalling so re-running
    -- this migration doesn't double the rate.
    BEGIN
      PERFORM cron.unschedule('lcc-document-text');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- Vercel/Railway target: lcc_cron_post POSTs to <base>/api/document-text-tick
    -- with Authorization: Bearer <vault.lcc_api_key>. Query-string params encode
    -- domain + doctype + limit (the handler reads the query string).
    PERFORM cron.schedule(
      'lcc-document-text',
      '*/30 * * * *',
      $cmd$SELECT public.lcc_cron_post('/api/document-text-tick?domain=both&doctype=deed&limit=15', '{}'::jsonb, 'vercel')$cmd$
    );
  END IF;
END $$;
