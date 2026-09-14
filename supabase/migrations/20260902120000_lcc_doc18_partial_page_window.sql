-- ============================================================================
-- DOC18 — the three-call sync window: partial-extract columns + honest coverage
-- LCC Opps (xengecqvemvfknjvbvrq) · 2026-09-02
--
-- DOC17 measured the contract this build rests on, on a real 316-page PDF:
--   30 pages per call contiguously from page 1 (imageless); 15 pages per call
--   anywhere else. The document's total page count never enters the arithmetic.
-- So the consumer's ~50-page window is THREE cheap SYNCHRONOUS calls, with no
-- GCS bucket, no IAM grant, no LRO job table and no confidentiality decision.
--
-- WHAT THIS MIGRATION IS FOR: a windowed extract is a THIRD STATE — complete for
-- the consumer, INCOMPLETE for the document. Nothing in the sidecar could say so.
-- `needs_ocr` is a boolean and both existing values are wrong for it:
--   true  => invisible to both consumers, so the text we paid for is thrown away
--   false => reads as FULL coverage on v_lcc_cre_bov_ready, which is a lie about
--            a 141-page lease read to page 50
-- The columns below carry the difference, and the view is taught to report it.
--
-- ⚠️ DEPLOY ORDER — ADDITIVE SCHEMA BEFORE THE WRITER (the constant rule).
-- Apply this BEFORE the Railway redeploy carrying the JS half. It is additive and
-- inert on its own: nothing writes these columns until the long-document lane
-- ships. Belt as well as braces — `buildDocTextRow` only puts these keys in the
-- payload for a WINDOWED extract, so even out of order the ordinary drain's
-- writes carry the same keys they carry today and cannot 400 on PGRST204.
--
-- REVERSAL: the columns are additive and nullable (drop them, and restore the
-- prior view body from 20260802140000). No data is rewritten by this file.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The partial-extract columns.
-- ---------------------------------------------------------------------------
ALTER TABLE public.lcc_cre_property_document_text
  ADD COLUMN IF NOT EXISTS partial_extract boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pages_covered   int,
  ADD COLUMN IF NOT EXISTS page_ranges     jsonb;

COMMENT ON COLUMN public.lcc_cre_property_document_text.partial_extract IS
  'DOC18: true when the multi-call sync window covered only the consumer''s page window of a longer document. Complete for the consumer, INCOMPLETE for the document — never count it as full coverage.';
COMMENT ON COLUMN public.lcc_cre_property_document_text.pages_covered IS
  'DOC18: how many pages the window actually RETURNED (assembled from Document AI''s own page numbers), not how many were asked for. NULL on a non-windowed row — unknown is not zero.';
COMMENT ON COLUMN public.lcc_cre_property_document_text.page_ranges IS
  'DOC18: [[from,to],...] of the pages actually returned, in page order. Derived from what came BACK, so a gap or a duplicated seam is visible rather than inferred from a plausible total length.';

-- A partial can only ever describe a row that HAS text. A marker row (needs_ocr,
-- raw_text null) claiming a partial extract would be incoherent, and the honest
-- surface below depends on that never happening.
ALTER TABLE public.lcc_cre_property_document_text
  DROP CONSTRAINT IF EXISTS chk_cre_doc_text_partial_has_text;
ALTER TABLE public.lcc_cre_property_document_text
  ADD CONSTRAINT chk_cre_doc_text_partial_has_text
  CHECK (NOT partial_extract OR (raw_text IS NOT NULL AND NOT needs_ocr));

-- The long-document lane selects ceiling markers oldest-attempt-first. Tiny
-- population (42 today), but the ordering is the CURSOR — see fetchOverCapCreDocs.
CREATE INDEX IF NOT EXISTS ix_cre_doc_text_ceiling_markers
  ON public.lcc_cre_property_document_text (extracted_at ASC)
  WHERE needs_ocr AND reason IN ('over_docai_page_cap', 'window_failed');

-- ---------------------------------------------------------------------------
-- 2. v_lcc_cre_bov_ready — the honest-count surface.
--
-- ⚠️ `CREATE OR REPLACE VIEW` IS APPEND-ONLY FOR COLUMNS (42P16 otherwise), so
-- the four existing columns keep their names, types and ORDER and the new ones
-- go at the END.
--
-- MEMBERSHIP IS DELIBERATELY UNCHANGED. A partial row carries real text that the
-- consumer truncates at 90,000 chars anyway, so excluding it would keep 42 leases
-- out of BOV extract to avoid over-claiming — strictly worse for the operator and
-- not what §5 asks. §5 asks that a partial never READ as complete coverage, which
-- is what `partial_docs` / `fully_covered_docs` state. `covered_docs` keeps its
-- existing meaning — "consumable by the BOV extract" — and is now qualified
-- rather than silently redefined (the DOC9 `ocr_by_engine` lesson: never re-use a
-- name for a different fact).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_lcc_cre_bov_ready AS
WITH docs AS (
  SELECT
    d.cre_property_id,
    d.id AS document_id,
    d.document_type,
    EXISTS (
      SELECT 1 FROM public.lcc_cre_property_document_text t
      WHERE t.document_id = d.id
        AND t.extractor_version = 'unit1_v1'
        AND NOT t.needs_ocr
    ) AS covered,
    EXISTS (
      SELECT 1 FROM public.lcc_cre_property_document_text t
      WHERE t.document_id = d.id
        AND t.extractor_version = 'unit1_v1'
        AND NOT t.needs_ocr
        AND t.partial_extract
    ) AS partial
  FROM public.lcc_cre_property_documents d
  WHERE d.document_type IN ('lease','dd','om')
)
SELECT
  cre_property_id,
  count(*)                                               AS extractable_docs,
  count(*) FILTER (WHERE covered)                        AS covered_docs,
  count(*) FILTER (WHERE document_type = 'lease')        AS lease_docs,
  count(*) FILTER (WHERE document_type = 'lease' AND covered) AS lease_covered,
  -- APPENDED (DOC18). `covered_docs` means CONSUMABLE; these two say how much of
  -- that is the whole document. A property with partial_docs > 0 is BOV-ready and
  -- is NOT fully covered, and both facts are now on the row.
  count(*) FILTER (WHERE covered AND partial)            AS partial_docs,
  count(*) FILTER (WHERE covered AND NOT partial)        AS fully_covered_docs,
  count(*) FILTER (WHERE document_type = 'lease' AND covered AND partial) AS lease_partial
FROM docs
GROUP BY cre_property_id
HAVING count(*) FILTER (WHERE document_type = 'lease') >= 1
   AND count(*) FILTER (WHERE covered) = count(*);

COMMENT ON VIEW public.v_lcc_cre_bov_ready IS
  'R58 Unit 4: properties whose lease/dd/om docs are text-COVERED (consumable by BOV extract) and have >=1 lease. DOC18: covered_docs counts consumable docs; partial_docs counts those whose text stops at the consumer page window on a LONGER document — read fully_covered_docs for complete coverage, never covered_docs.';

-- ---------------------------------------------------------------------------
-- 3. The long-document backlog surface. Read this, never the raw marker count:
--    `over_docai_page_cap` = never attempted; `window_failed` = attempted and
--    produced nothing. Collapsing them hides which is which.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_lcc_cre_longdoc_backlog AS
SELECT
  t.reason,
  count(*)                                          AS documents,
  min(t.page_count)                                 AS min_pages,
  max(t.page_count)                                 AS max_pages,
  count(*) FILTER (WHERE t.page_count IS NULL)      AS pages_unknown,
  min(t.extracted_at)                               AS oldest_attempt,
  max(t.extracted_at)                               AS newest_attempt
FROM public.lcc_cre_property_document_text t
WHERE t.extractor_version = 'unit1_v1'
  AND t.needs_ocr
  AND t.reason IN ('over_docai_page_cap', 'window_failed')
GROUP BY t.reason;

COMMENT ON VIEW public.v_lcc_cre_longdoc_backlog IS
  'DOC18: documents beyond one synchronous DocAI call, split by whether the multi-call window has been ATTEMPTED. oldest_attempt is the long lane''s cursor head.';

-- ---------------------------------------------------------------------------
-- 4. Schedule the lane. ⚠️ Scheduled EVEN THOUGH the route can be switched off
-- (CRE_OCR_WINDOW_PAGES=0), on the P133 rule: a disabled tick no-ops and the run
-- is recorded, whereas an UNSCHEDULED job is invisible. One document per tick by
-- design (see the tick-budget decision in api/_handlers/cre-doc-text.js).
--
-- :07 and :37 sit clear of the 30-minute eligible drain at :00/:30, so the long
-- lane's ~60-110 s of DocAI time never overlaps the ordinary tick.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('lcc-cre-doc-text-longdoc');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    PERFORM cron.schedule(
      'lcc-cre-doc-text-longdoc',
      '7,37 * * * *',
      $cmd$SELECT public.lcc_cron_post('/api/intake?_route=cre-doc-text-tick&mode=longdoc&limit=1', '{}'::jsonb, 'railway')$cmd$
    );
  END IF;
END $$;
