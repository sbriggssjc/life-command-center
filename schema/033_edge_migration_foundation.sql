-- ============================================================================
-- 033: Edge Migration Foundation — Phase 0
-- Life Command Center — Infrastructure Migration
--
-- Adds:
--   1. quality_score column to context_packets (packet quality measurement)
--
-- NOTE: The analytics tables (contact_engagement, scoring_calibration,
-- template_performance, pipeline_velocity, outreach_effectiveness) already
-- exist from 019_signal_tables.sql. The pg_cron nightly jobs (Phase 5) will
-- use those existing schemas as-is.
--
-- See: docs/architecture/infrastructure_migration_plan.md
-- ============================================================================

-- ── 1. Context Packet Quality Score ──────────────────────────────────────────

ALTER TABLE context_packets
  ADD COLUMN IF NOT EXISTS quality_score integer;

COMMENT ON COLUMN context_packets.quality_score IS
  'Packet quality 0-100. Factors: source coverage, field completeness, staleness, conflict resolution.';
