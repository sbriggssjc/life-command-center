-- Drift-detector hygiene (2026-05-29): the Phase-4 v_field_provenance_unranked
-- alarm is meant to trend to ~0 and flag any new ingestion write-path lacking a
-- field_source_priority rule. The remediation's own one-shot cleanup runs record
-- provenance tagged with a run-id "source" (cleanup_run_*), which permanently
-- polluted the view (~27 false positives) and buried the real signal. Exclude
-- those one-shot run-id sources so the view surfaces only genuine RECURRING
-- ingestion writers that need a priority rule.
--
-- Applied to LCC Opps (xengecqvemvfknjvbvrq). After: 64 → 37 rows (20 are the
-- healed gov.gov.leases double-prefix artifact aging out of the 30d window;
-- 17 are real recurring-writer gaps for a focused follow-up).
CREATE OR REPLACE VIEW public.v_field_provenance_unranked AS
SELECT target_table,
    field_name,
    source,
    count(*) AS writes_30d,
    count(*) FILTER (WHERE decision = 'write'::text) AS writes_succeeded,
    count(*) FILTER (WHERE decision = 'skip'::text) AS writes_skipped,
    count(*) FILTER (WHERE decision = 'conflict'::text) AS writes_conflicted,
    min(recorded_at) AS first_seen,
    max(recorded_at) AS last_seen,
    count(DISTINCT record_pk_value) AS distinct_records,
    ( SELECT count(DISTINCT fp2.source) AS count
           FROM field_provenance fp2
          WHERE fp2.target_table = fp.target_table AND fp2.field_name = fp.field_name AND fp2.recorded_at > (now() - '30 days'::interval)) AS distinct_sources_seen
   FROM field_provenance fp
  WHERE recorded_at > (now() - '30 days'::interval)
    AND source NOT LIKE 'cleanup_run_%'   -- exclude one-shot remediation run-ids (not recurring writers)
    AND NOT (EXISTS ( SELECT 1
           FROM field_source_priority fsp
          WHERE fsp.target_table = fp.target_table AND fsp.field_name = fp.field_name AND fsp.source = fp.source))
  GROUP BY target_table, field_name, source
  ORDER BY (count(*)) DESC;
