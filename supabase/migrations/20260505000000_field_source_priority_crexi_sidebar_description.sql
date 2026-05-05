-- ============================================================================
-- Migration: seed crexi_sidebar_description source tag in field_source_priority
--
-- Target: LCC Opps Supabase (OPS_SUPABASE_URL)
--
-- Round 76ej.l (2026-05-05). Round 76ej.k added a prose-mining extractor
-- (extractCrexiLeaseFromDescription in extension/content/crexi.js) that
-- parses expense_structure / remaining_term_years / lease_expiration /
-- renewal_options / rent_escalations_pct out of the broker-written
-- marketing description. Until now those mined values flowed through the
-- same `crexi_sidebar` source tag as the structured Details-panel reads,
-- which hides the trust gap between a CREXi-rendered field and a
-- broker-prose regex match.
--
-- This migration introduces `crexi_sidebar_description`, one notch looser
-- than `crexi_sidebar`. sidebar-pipeline.js will route the five mined
-- fields to this tag (per-field source override) so the audit can tell
-- prose-mined values apart from structured-panel values, and Phase 3 can
-- later flip selected fields to warn/strict on a per-field basis once
-- capture volume reveals which fields the regex extractor is reliable
-- for.
--
-- Pattern mirrors Round 76ej.d (20260504200000_field_source_priority_
-- crexi_sidebar.sql): seed for every (target_table, field_name) where
-- crexi_sidebar already has a rule, ON CONFLICT DO NOTHING. Default
-- enforce_mode = 'record_only' so observation-only at ingest.
-- ============================================================================

INSERT INTO public.field_source_priority
  (target_table, field_name, source, priority, min_confidence, notes)
SELECT
  csp.target_table,
  csp.field_name,
  'crexi_sidebar_description'    AS source,
  csp.priority + 5               AS priority,
  csp.min_confidence,
  'CREXi marketing-description prose mining (Round 76ej.l) — broker free-text, regex-extracted, one notch looser than crexi_sidebar.'
                                  AS notes
FROM public.field_source_priority csp
WHERE csp.source = 'crexi_sidebar'
  AND NOT EXISTS (
    SELECT 1
    FROM public.field_source_priority existing
    WHERE existing.target_table = csp.target_table
      AND existing.field_name   = csp.field_name
      AND existing.source       = 'crexi_sidebar_description'
  );
