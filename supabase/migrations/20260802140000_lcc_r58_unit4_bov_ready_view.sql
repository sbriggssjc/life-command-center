-- ============================================================================
-- R58 "Unit 4" — BOV-ready properties view (LCC Opps)
-- 2026-07-17
--
-- A property is READY for Unit-4 record extraction when EVERY one of its
-- lease/dd/om registry docs has a non-needs_ocr text sidecar (Step 2A complete)
-- AND it has at least one lease. The coverage-gated sweep reads this view so it
-- only extracts fully-covered properties — never a half-OCR'd one (which would
-- yield an incomplete record). As the doc-text backlog drains, properties cross
-- into this view and become eligible; nothing else has to change.
--
-- Read-only view; service-key access via the underlying RLS tables. Additive.
-- ============================================================================

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
    ) AS covered
  FROM public.lcc_cre_property_documents d
  WHERE d.document_type IN ('lease','dd','om')
)
SELECT
  cre_property_id,
  count(*)                                               AS extractable_docs,
  count(*) FILTER (WHERE covered)                        AS covered_docs,
  count(*) FILTER (WHERE document_type = 'lease')        AS lease_docs,
  count(*) FILTER (WHERE document_type = 'lease' AND covered) AS lease_covered
FROM docs
GROUP BY cre_property_id
HAVING count(*) FILTER (WHERE document_type = 'lease') >= 1
   AND count(*) FILTER (WHERE covered) = count(*);

COMMENT ON VIEW public.v_lcc_cre_bov_ready IS
  'R58 Unit 4: properties whose lease/dd/om docs are FULLY text-covered (Step 2A done) and have >=1 lease — the coverage-gated input to the bov-extract sweep.';
