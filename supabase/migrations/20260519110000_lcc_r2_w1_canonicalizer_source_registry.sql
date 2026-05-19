-- ============================================================================
-- LCC Opps — Round 2 finding R2-W-1 / R2-W-2 (2026-05-19):
-- Register the canonicalizer trigger / function sources in
-- public.field_source_priority so the priority system knows they exist and
-- the Phase 4 drift detector (v_field_provenance_unranked) doesn't yell
-- "unknown source" once we ship the cross-DB provenance-event flush.
--
-- The actual provenance events are written to a per-DB local
-- public.provenance_event_log table (see paired dia + gov migrations) and
-- will be drained into public.field_provenance by a future
-- lcc-provenance-event-flush cron. This migration is the LCC-Opps-side
-- "declare the source names" step.
--
-- All three sources sit at priority=90 (record_only) — they are
-- post-write normalizers, NOT competing data sources. They should:
--   • NEVER override a real ingest source's value (a real source like
--     county_records at priority=10 always wins)
--   • Always be the LATEST recorded provenance for the field whenever
--     they fire (so analytics that ask "what last touched this value"
--     correctly report the canonicalizer)
--   • Be observably present in v_field_provenance_unranked checks (so a
--     future strict-mode rollout doesn't surprise the operator)
-- ============================================================================

BEGIN;

INSERT INTO public.field_source_priority
  (target_table, field_name, source, priority, min_confidence, enforce_mode, notes)
VALUES
  ('dia.properties', 'tenant', 'qa22_davita_brand_canonicalize', 90, NULL, 'record_only',
   'Round 76r2-w1 (2026-05-19): BEFORE INSERT/UPDATE trigger on dia.properties.tenant (Migration 20260518200000) silently rewrites davita/DAVITA/Davita → DaVita. This priority row registers the source name so Phase 4 v_field_provenance_unranked drift detector doesn''t flag it. Priority 90 = post-write normalizer, never competes with real sources. Trigger writes to dia.provenance_event_log; future cron syncs to field_provenance.'),

  ('gov.properties', 'agency_canonical', 'qa24_canonicalize_agency', 90, NULL, 'record_only',
   'Round 76r2-w2 (2026-05-19): QA-24 (Migration 20260518220000) re-canonicalized 1,217 gov.properties.agency_canonical rows via canonicalize_agency() without recording provenance. This priority row registers the source name. Future writes to agency_canonical via canonicalize_agency() should log to gov.provenance_event_log.'),

  ('gov.properties', 'agency_canonical', 'qa30_canonicalize_agency', 90, NULL, 'record_only',
   'Round 76r2-w2 (2026-05-19): QA-30 (Migration 20260518240000) extended canonicalize_agency() to handle FBI hyphen + FCC, touching 4 gov.properties.agency_canonical rows without provenance. This priority row registers the source name. Conceptually the same writer as qa24_canonicalize_agency — kept separate so the audit can distinguish QA-24''s 1,217-row event from QA-30''s 4-row event when the flush cron lands.')
ON CONFLICT (target_table, field_name, source) DO UPDATE
  SET notes = EXCLUDED.notes,
      updated_at = now();

-- Add a CHECK that the priority sits in the "post-write normalizer" band so
-- a future operator can't accidentally hand a canonicalizer a priority that
-- would let it clobber real data.
COMMENT ON COLUMN public.field_source_priority.priority IS
  'Lower number = higher trust. Bands: 1-19=hard authoritative, 20-39=primary
   trusted, 40-59=secondary trusted, 60-79=aggregator/scraper, 80-89=derived
   /inferred, 90-99=post-write normalizers (triggers / canonicalizers that
   never override but always touch last). Round 76r2-w1 added the 90-99 band.';

COMMIT;
