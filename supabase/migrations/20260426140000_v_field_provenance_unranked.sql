-- ============================================================================
-- View: v_field_provenance_unranked (Phase 4 — schema-drift detector)
--
-- Target: LCC Opps Supabase (OPS_SUPABASE_URL)
--
-- Phase 4 of the data quality self-learning loop. Surfaces
-- (target_table, field_name, source) triples that have appeared in
-- field_provenance over the last 30 days but are NOT in
-- field_source_priority.
--
-- These are "unranked" fields: any source can overwrite any other because
-- the merge function has no precedence rule to consult. lcc_merge_field
-- falls back to whichever value is non-NULL or whichever was written most
-- recently — fine for greenfield writes, dangerous for fields that should
-- have an authoritative source.
--
-- Each row in the view is an opportunity to add a priority entry so the
-- field becomes governable. Drives the LCC UI Data Quality
-- "Unranked fields (schema drift)" panel.
--
-- Audit query — newest unranked fields first:
--   SELECT * FROM v_field_provenance_unranked
--   ORDER BY first_seen DESC LIMIT 20;
--
-- Add a priority rule for an unranked field:
--   INSERT INTO public.field_source_priority
--     (target_table, field_name, source, priority, min_confidence)
--   VALUES ('dia.leases', 'guarantor', 'om_extraction', 35, 0.5);
-- ============================================================================
CREATE OR REPLACE VIEW public.v_field_provenance_unranked AS
SELECT
  fp.target_table,
  fp.field_name,
  fp.source,
  count(*)                       AS writes_30d,
  count(*) FILTER (WHERE fp.decision = 'write')      AS writes_succeeded,
  count(*) FILTER (WHERE fp.decision = 'skip')       AS writes_skipped,
  count(*) FILTER (WHERE fp.decision = 'conflict')   AS writes_conflicted,
  min(fp.recorded_at)            AS first_seen,
  max(fp.recorded_at)            AS last_seen,
  count(DISTINCT fp.record_pk_value) AS distinct_records,
  (SELECT count(DISTINCT fp2.source)
   FROM public.field_provenance fp2
   WHERE fp2.target_table = fp.target_table
     AND fp2.field_name   = fp.field_name
     AND fp2.recorded_at  > now() - interval '30 days'
  ) AS distinct_sources_seen
FROM public.field_provenance fp
WHERE fp.recorded_at > now() - interval '30 days'
  AND NOT EXISTS (
    SELECT 1
    FROM public.field_source_priority fsp
    WHERE fsp.target_table = fp.target_table
      AND fsp.field_name   = fp.field_name
      AND fsp.source       = fp.source
  )
GROUP BY 1, 2, 3
ORDER BY writes_30d DESC;

COMMENT ON VIEW public.v_field_provenance_unranked IS
  'Phase 4 schema-drift detector. Each row is a (target_table, field_name,
   source) triple actively being written but not yet registered in
   field_source_priority. Use to seed missing priority rules so every
   field write has a governing precedence rule.';
