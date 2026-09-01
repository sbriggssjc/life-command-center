-- ============================================================================
-- DOC10 — a THIN OCR result must not count as COVERED (LCC Opps)
-- 2026-09-01
--
-- THE DEFECT (correctness, not cost, and worse than failing):
--   `gatherPropertyText` (bov-extract.js) admits sidecars on
--     needs_ocr=is.false AND raw_text=not.is.null
--   and `v_lcc_cre_bov_ready` counts a document covered on
--     AND NOT t.needs_ocr
--   A 31-CHARACTER gpt-4o FRAGMENT satisfies both. So BOV extract received it as
--   though it were the lease, the property read *covered*, and it could never be
--   retried because nothing distinguished it from a real extraction.
--   `reason = 'thin_ocr_result'` was already being SET on 5 rows and no consumer
--   has ever read it — the label existed; nothing acted on it.
--
-- WHY NOW, AND ONLY NOW: DOC8 raised the DocAI synchronous page cap 15 -> 30
-- (imageless mode) and made an over-cap document stop with a named marker instead
-- of falling through to gpt-4o. A quality floor shipped BEFORE that would have
-- correctly rejected most long leases and parked the backlog on retry markers.
--
-- WHAT THIS MIGRATION DOES: it repairs the 12 rows already written under the old
-- rule. It does NOT own the rule — `isThinOcrResult` / `ocrThinFloor`
-- (api/_shared/cre-property-doc-text.js) is the single owner for every future
-- write, and `test/doc8-doc9-doc10-page-cap-and-thin-floor.test.mjs` pins the
-- constants below against that module so the two cannot drift apart.
--
-- THE FLOOR (page-aware, because a genuinely short one-page document is not thin):
--   pages known   -> max(120, pages * 200) meaningful chars
--   pages unknown -> 500 meaningful chars
--   `page_count` is NULL on 79 of 80 sidecar rows and `ocr_pages` exists only once
--   DocAI has already succeeded, so the forward path takes its page count from a
--   pdf-parse pre-flight instead. On the ALREADY-WRITTEN rows there is no such
--   count to recover, so the unknown-pages arm is what does the work here — and
--   that is measured, not assumed: all 19 gpt-4o rows carry NULL pages, and all 6
--   DocAI rows (601..19,876 chars over 1..10 pages) clear the known-pages arm.
--
-- MEASURED, 2026-09-01, before applying:
--   gpt-4o char_len: 31 44 44 48 49 68 116 163 186 187 188 200 | 783 2251 2670
--                    3521 4062 7014 8375  -- a 3.9x gap with nothing in it
--   -> 12 rows marked, 7 left covered.
--   v_lcc_cre_bov_ready 7 -> 4. ⚠️ THAT NUMBER GOING DOWN IS THE FIX WORKING:
--   those 3 properties were never covered, they were "covered" by 31-200-char
--   fragments, and BOV extract was reading them as leases.
--
-- DISCIPLINE: reversible (full snapshot in _lcc_doc10_thin_ocr_backfill_backup +
-- a batch tag) · idempotent (a row already marked is not re-marked) · dry-run
-- default · the FRAGMENT TEXT IS KEPT, never nulled — needs_ocr=true alone hides
-- the row from both consumers (verified by grepping every read of this table), and
-- keeping it is what makes the repair auditable. DOC1's marker nulls `raw_text`
-- only because a byte-fetch failure has no text to keep.
--
-- REVERSAL:
--   UPDATE public.lcc_cre_property_document_text t
--      SET needs_ocr = b.needs_ocr, reason = b.reason
--     FROM public._lcc_doc10_thin_ocr_backfill_backup b
--    WHERE b.batch_tag = '<tag>' AND t.id = b.sidecar_id;
-- ============================================================================

CREATE TABLE IF NOT EXISTS public._lcc_doc10_thin_ocr_backfill_backup (
  id               bigserial PRIMARY KEY,
  batch_tag        text        NOT NULL,
  sidecar_id       bigint      NOT NULL,
  document_id      bigint      NOT NULL,
  needs_ocr        boolean,
  reason           text,
  char_len         integer,
  meaningful_chars integer,
  page_basis       text,
  floor_applied    integer,
  backed_up_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_doc10_thin_backup_batch
  ON public._lcc_doc10_thin_ocr_backfill_backup (batch_tag);

-- The floor, in ONE place on the SQL side. ⚠️ READ-ONLY / repair-scoped: the JS
-- module is the authority for every WRITE. These three constants are pinned
-- against its defaults by the guard test.
CREATE OR REPLACE FUNCTION public.lcc_doc10_thin_ocr_floor(p_pages integer)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
           WHEN p_pages IS NOT NULL AND p_pages > 0 THEN greatest(120, p_pages * 200)
           ELSE 500
         END;
$$;
COMMENT ON FUNCTION public.lcc_doc10_thin_ocr_floor(integer) IS
  'DOC10: meaningful-char floor an OCR result must clear at this page count. Mirrors ocrThinFloor() in api/_shared/cre-property-doc-text.js, which is the single owner for writes; this copy exists so the repair and the standing drift view can be expressed in SQL. Pinned by test/doc8-doc9-doc10-page-cap-and-thin-floor.test.mjs.';

-- Standing detector, so this is re-gradeable rather than a one-shot that rots
-- (Class 8). It reports the OBSERVABLE facts beside the floor; it never writes.
CREATE OR REPLACE VIEW public.v_lcc_cre_thin_ocr_watch AS
SELECT t.id                                                        AS sidecar_id,
       t.document_id,
       t.cre_property_id,
       t.document_type,
       t.ocr_tier,
       t.ocr_engine,
       coalesce(t.ocr_pages, t.page_count)                         AS pages_known,
       t.char_len,
       length(regexp_replace(coalesce(t.raw_text, ''), '\s', '', 'g')) AS meaningful_chars,
       public.lcc_doc10_thin_ocr_floor(coalesce(t.ocr_pages, t.page_count)) AS floor_chars,
       t.needs_ocr,
       t.reason,
       t.extracted_at
  FROM public.lcc_cre_property_document_text t
 WHERE t.method = 'ocr'
   AND length(regexp_replace(coalesce(t.raw_text, ''), '\s', '', 'g'))
       < public.lcc_doc10_thin_ocr_floor(coalesce(t.ocr_pages, t.page_count));
COMMENT ON VIEW public.v_lcc_cre_thin_ocr_watch IS
  'DOC10: OCR sidecars below the page-aware thin floor. After the backfill every row here must read needs_ocr=true; a row with needs_ocr=false means a writer escaped the floor (the forward producer is buildDocTextRow).';

-- The repair. Dry-run default; returns the plan either way.
CREATE OR REPLACE FUNCTION public.lcc_doc10_mark_thin_ocr(
  p_dry_run   boolean DEFAULT true,
  p_batch_tag text    DEFAULT NULL
)
RETURNS TABLE (
  action              text,
  rows_marked         integer,
  rows_pages_known    integer,
  rows_pages_unknown  integer,
  min_chars           integer,
  max_chars           integer,
  properties_touched  integer,
  batch_tag           text
)
LANGUAGE plpgsql AS $$
#variable_conflict use_column
DECLARE
  v_tag text := coalesce(p_batch_tag, 'doc10_thin_' || to_char(now(), 'YYYYMMDDHH24MI'));
BEGIN
  CREATE TEMP TABLE _doc10_plan ON COMMIT DROP AS
  SELECT w.sidecar_id, w.document_id, w.cre_property_id, w.needs_ocr, w.reason,
         w.char_len, w.meaningful_chars, w.floor_chars, w.pages_known
    FROM public.v_lcc_cre_thin_ocr_watch w
   WHERE w.needs_ocr = false;          -- idempotent: an already-marked row is done

  IF NOT p_dry_run THEN
    INSERT INTO public._lcc_doc10_thin_ocr_backfill_backup
      (batch_tag, sidecar_id, document_id, needs_ocr, reason, char_len, meaningful_chars, page_basis, floor_applied)
    SELECT v_tag, p.sidecar_id, p.document_id, p.needs_ocr, p.reason, p.char_len, p.meaningful_chars,
           CASE WHEN p.pages_known IS NULL THEN 'unknown' ELSE 'known' END, p.floor_chars
      FROM _doc10_plan p;

    UPDATE public.lcc_cre_property_document_text t
       SET needs_ocr = true,
           reason    = 'thin_ocr_result'
      FROM _doc10_plan p
     WHERE t.id = p.sidecar_id;
  END IF;

  RETURN QUERY
  SELECT CASE WHEN p_dry_run THEN 'dry_run' ELSE 'applied' END,
         count(*)::int,
         count(*) FILTER (WHERE p.pages_known IS NOT NULL)::int,
         count(*) FILTER (WHERE p.pages_known IS NULL)::int,
         min(p.char_len)::int,
         max(p.char_len)::int,
         count(DISTINCT p.cre_property_id)::int,
         v_tag
    FROM _doc10_plan p;
END;
$$;
COMMENT ON FUNCTION public.lcc_doc10_mark_thin_ocr(boolean, text) IS
  'DOC10 repair: mark already-written thin OCR sidecars needs_ocr=true so both consumers stop reading a fragment as a covered lease. Dry-run default, reversible by batch_tag via _lcc_doc10_thin_ocr_backfill_backup, idempotent. The fragment text is KEPT.';

GRANT SELECT ON public.v_lcc_cre_thin_ocr_watch TO service_role;
