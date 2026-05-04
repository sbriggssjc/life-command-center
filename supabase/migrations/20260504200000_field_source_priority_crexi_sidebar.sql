-- ============================================================================
-- Migration: seed crexi_sidebar source tag in field_source_priority registry
--
-- Target: LCC Opps Supabase (OPS_SUPABASE_URL)
--
-- Round 76ej.d (2026-05-04). The Chrome extension's CREXi pipeline now tags
-- its provenance writes as `source='crexi_sidebar'` (sidebar-pipeline.js
-- branches on metadata.source). Without rows in field_source_priority, the
-- v_field_provenance_unranked drift detector flags every CREXi write.
--
-- CREXi is a broker self-listing aggregator — same trust profile as CoStar
-- (also broker-supplied, also surfaced as marketing data, no independent
-- verification step). We mirror the costar_sidebar priority band one notch
-- looser (priority +5) so when both sources fight for the same field, the
-- one that paid CoStar's index wins. Rules are seeded for every
-- (target_table, field_name) pair that already has a costar_sidebar rule —
-- 24 tables × 111 fields per CLAUDE.md.
--
-- Default enforce_mode = 'record_only' so this is observation-only at
-- ingest. Phase 3 will flip selected fields to 'warn' / 'strict' once
-- CREXi capture volume reveals which fields are reliable.
-- ============================================================================

INSERT INTO public.field_source_priority
  (target_table, field_name, source, priority, min_confidence, notes)
SELECT
  csp.target_table,
  csp.field_name,
  'crexi_sidebar'                AS source,
  csp.priority + 5               AS priority,
  csp.min_confidence,
  'CREXi listing capture — broker self-marketing, mirrors costar_sidebar trust band one notch looser (Round 76ej.d).'
                                  AS notes
FROM public.field_source_priority csp
WHERE csp.source = 'costar_sidebar'
  AND NOT EXISTS (
    SELECT 1
    FROM public.field_source_priority existing
    WHERE existing.target_table = csp.target_table
      AND existing.field_name   = csp.field_name
      AND existing.source       = 'crexi_sidebar'
  );
