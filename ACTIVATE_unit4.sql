-- ============================================================================
-- Unit 4 — POST-REDEPLOY ACTIVATION SCRIPT
-- Project: LCC Opps (xengecqvemvfknjvbvrq)
-- Run in the Supabase SQL editor (or via the Supabase MCP) AFTER the redeploy
-- that ships: document-text.js, cre-property-doc-text.js, bov-extract.js (+ handler),
-- and vercel.json. Run the STEPS in order. Everything goes through lcc_cron_post
-- (which pulls the Railway URL + API key from the vault), so no key handling here.
--
-- Steps 1–2 are VERIFY (safe, read-only side effects). Steps 3–4 SCHEDULE crons.
-- Step 5 is post-checks. Step 6 is the one EXTERNAL action (DocAI wrapper).
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────
-- STEP 1 — VERIFY the endpoints are live (dry-runs; no writes, no OCR, no AI).
-- Fire both GET dry-runs, then read the responses in Step 1b.
-- ─────────────────────────────────────────────────────────────────────────

-- 1a — fire (each returns a request_id):
SELECT 'cre-doc-text dry-run' AS check,
       public.lcc_cron_post('/api/intake?_route=cre-doc-text-tick&mode=eligible&limit=1', '{}'::jsonb, 'vercel') AS request_id
UNION ALL
SELECT 'bov-extract sweep dry-run',
       public.lcc_cron_post('/api/intake?_route=bov-extract&mode=sweep&limit=1', '{}'::jsonb, 'vercel');

-- ... wait ~5–10 seconds for pg_net, then:

-- 1b — read the two most recent responses. EXPECT: both status_code = 200.
--   cre-doc-text body has {"mode":"eligible",...}; bov-extract body has
--   {"mode":"sweep_dry_run","pending":N,...}. A 404/422 means the redeploy
--   hasn't landed the new routes/handler yet — do NOT proceed to Steps 3–4.
SELECT id, status_code, left(content::text, 300) AS body, error_msg
FROM net._http_response
ORDER BY id DESC
LIMIT 2;


-- ─────────────────────────────────────────────────────────────────────────
-- STEP 2 — (optional) confirm what the sweep WOULD do, without extracting.
-- Reads the readiness view: properties fully text-covered and not yet extracted.
-- ─────────────────────────────────────────────────────────────────────────
SELECT count(*) AS ready_properties FROM public.v_lcc_cre_bov_ready;
-- Detail (property id + doc coverage):
-- SELECT * FROM public.v_lcc_cre_bov_ready ORDER BY cre_property_id LIMIT 25;


-- ─────────────────────────────────────────────────────────────────────────
-- STEP 3 — SCHEDULE the coverage-gated BOV-extract sweep (every 2h, 5/tick).
-- Only runs once Step 1 shows 200 for the sweep dry-run.
-- (Equivalent to applying migration 20260802150000_..._bov_extract_sweep_cron.sql.)
-- ─────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN PERFORM cron.unschedule('lcc-cre-bov-extract-sweep'); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM cron.schedule(
      'lcc-cre-bov-extract-sweep',
      '17 */2 * * *',
      $cmd$SELECT public.lcc_cron_post('/api/intake?_route=bov-extract&mode=sweep&limit=5', '{}'::jsonb, 'vercel')$cmd$
    );
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────
-- STEP 4 — ENABLE the forward doc-text JOBS lane (drains cre.doc.text jobs the
-- classify bridge enqueues at intake). Safe now that the redeploy carries the
-- runPropertyDocText idempotency guard (no double-OCR vs the eligible sweep).
-- Offset to :15/:45 so the two lanes never share a tick.
-- ─────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN PERFORM cron.unschedule('lcc-cre-doc-text-jobs'); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM cron.schedule(
      'lcc-cre-doc-text-jobs',
      '15,45 * * * *',
      $cmd$SELECT public.lcc_cron_post('/api/intake?_route=cre-doc-text-tick&mode=jobs&limit=15', '{}'::jsonb, 'vercel')$cmd$
    );
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────
-- STEP 5 — POST-CHECKS.
-- ─────────────────────────────────────────────────────────────────────────
-- 5a — all four Unit-4 crons present + active:
SELECT jobname, schedule, active
FROM cron.job
WHERE jobname IN ('lcc-cre-doc-text-backfill','lcc-cre-doc-text-jobs','lcc-cre-bov-extract-sweep')
ORDER BY jobname;

-- 5b — coverage snapshot (how much of the backlog now has a text sidecar):
WITH reg AS (
  SELECT document_type, count(*) total FROM public.lcc_cre_property_documents
  WHERE document_type IN ('lease','dd','om') GROUP BY document_type),
done AS (
  SELECT r.document_type, count(*) filled FROM public.lcc_cre_property_document_text t
  JOIN public.lcc_cre_property_documents r ON r.id = t.document_id
  WHERE t.extractor_version='unit1_v1' AND NOT t.needs_ocr GROUP BY r.document_type)
SELECT reg.document_type, reg.total, COALESCE(done.filled,0) filled,
       reg.total - COALESCE(done.filled,0) remaining
FROM reg LEFT JOIN done USING (document_type) ORDER BY 1;

-- 5c — records produced so far (status: extracted = auto, reviewed = human-vetted):
SELECT status, count(*) FROM public.lcc_cre_bov_extraction GROUP BY status ORDER BY 1;


-- ─────────────────────────────────────────────────────────────────────────
-- STEP 6 — EXTERNAL (not SQL): lease clause_ref PAGE numbers.
-- Update the DocAI wrapper behind OCR_CLOUD_OCR_URL to return per-page text in
-- its JSON response as `page_texts` (or `pages_text`, or a `pages` ARRAY of
-- {page,text}). The code already threads that array to the sidecar `pages`
-- column and into clause_refs. Until then, OCR'd leases get clause SECTIONS but
-- no PAGE numbers (hand-authored / pilot records are unaffected). No redeploy
-- needed for this once the wrapper emits the field.
-- ─────────────────────────────────────────────────────────────────────────
