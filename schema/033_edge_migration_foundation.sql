-- ============================================================================
-- 033: Edge Migration Foundation — Phase 0
-- Life Command Center — Infrastructure Migration
--
-- Adds:
--   1. quality_score column to context_packets (packet quality measurement)
--   2. contact_engagement table (nightly engagement scoring)
--   3. scoring_calibration table (nightly AI calibration)
--   4. template_performance table (nightly template analytics)
--   5. pipeline_velocity table (weekly stage velocity metrics)
--
-- These tables support the pg_cron scheduled jobs defined in the
-- infrastructure migration plan (Phase 5). They are created now so
-- the signal writer and packet assembler can begin populating them
-- immediately, building historical data before the jobs run.
--
-- See: docs/architecture/infrastructure_migration_plan.md
--      docs/architecture/signal_table_schema.sql
-- ============================================================================

-- ── 1. Context Packet Quality Score ──────────────────────────────────────────

ALTER TABLE context_packets
  ADD COLUMN IF NOT EXISTS quality_score integer;

COMMENT ON COLUMN context_packets.quality_score IS
  'Packet quality 0-100. Factors: source coverage, field completeness, staleness, conflict resolution.';

-- ── 2. Contact Engagement Scores ─────────────────────────────────────────────
-- Nightly refresh from signals table. One row per contact entity.

CREATE TABLE IF NOT EXISTS contact_engagement (
  entity_id             uuid PRIMARY KEY,
  engagement_score      integer NOT NULL DEFAULT 0,
  last_touchpoint_at    timestamptz,
  touchpoint_count_30d  integer DEFAULT 0,
  cadence_status        text DEFAULT 'unknown',  -- on_track | due | overdue | unknown
  preferred_channel     text,                      -- email | phone | in_person
  response_rate         numeric(5,3),              -- 0.000 to 1.000
  updated_at            timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_engagement_score
  ON contact_engagement(engagement_score DESC);
CREATE INDEX IF NOT EXISTS idx_engagement_cadence
  ON contact_engagement(cadence_status) WHERE cadence_status IN ('due', 'overdue');

COMMENT ON TABLE contact_engagement IS
  'Per-contact engagement metrics. Refreshed nightly by pg_cron from signals table.';

-- ── 3. Scoring Calibration ───────────────────────────────────────────────────
-- Tracks how well AI recommendations match actual user behavior.

CREATE TABLE IF NOT EXISTS scoring_calibration (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  computed_at           timestamptz DEFAULT now(),
  period_days           integer DEFAULT 30,
  total_recommendations integer DEFAULT 0,
  acted_on_count        integer DEFAULT 0,
  ignored_count         integer DEFAULT 0,
  deferred_count        integer DEFAULT 0,
  precision_by_tier     jsonb DEFAULT '{}',  -- { "high": 0.82, "medium": 0.65, "low": 0.43 }
  overall_precision     numeric(5,3),
  notes                 text
);

CREATE INDEX IF NOT EXISTS idx_calibration_date
  ON scoring_calibration(computed_at DESC);

COMMENT ON TABLE scoring_calibration IS
  'Daily calibration snapshot: AI recommendation accuracy vs actual user actions.';

-- ── 4. Template Performance ──────────────────────────────────────────────────
-- Per-template-version analytics from signals table.

CREATE TABLE IF NOT EXISTS template_performance (
  template_id           text NOT NULL,
  template_version      text NOT NULL DEFAULT '1.0',
  sent_count            integer DEFAULT 0,
  open_count            integer DEFAULT 0,
  reply_count           integer DEFAULT 0,
  avg_edit_distance     numeric(8,2),
  response_rate         numeric(5,3),           -- reply_count / sent_count
  deal_advancement_rate numeric(5,3),           -- % that led to deal stage change
  flagged_low           boolean DEFAULT false,
  updated_at            timestamptz DEFAULT now(),
  PRIMARY KEY (template_id, template_version)
);

COMMENT ON TABLE template_performance IS
  'Per-template analytics. Refreshed nightly by pg_cron from signals table.';

-- ── 5. Pipeline Velocity ─────────────────────────────────────────────────────
-- Stage-to-stage conversion metrics by domain.

CREATE TABLE IF NOT EXISTS pipeline_velocity (
  domain                text NOT NULL,
  from_stage            text NOT NULL,
  to_stage              text NOT NULL,
  median_days           numeric(8,2),
  p75_days              numeric(8,2),
  p90_days              numeric(8,2),
  conversion_rate       numeric(5,3),
  sample_size           integer DEFAULT 0,
  updated_at            timestamptz DEFAULT now(),
  PRIMARY KEY (domain, from_stage, to_stage)
);

COMMENT ON TABLE pipeline_velocity IS
  'Stage conversion velocity by domain. Refreshed weekly by pg_cron from signals table.';

-- ── RLS Policies ─────────────────────────────────────────────────────────────
-- These tables are server-side only (read by Edge Functions with service key).
-- Enable RLS but allow service role full access.

ALTER TABLE contact_engagement ENABLE ROW LEVEL SECURITY;
ALTER TABLE scoring_calibration ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_velocity ENABLE ROW LEVEL SECURITY;

-- Service role bypass (Supabase service key bypasses RLS by default,
-- but explicit policies ensure clarity)
DO $$
BEGIN
  -- contact_engagement
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'service_role_engagement') THEN
    EXECUTE 'CREATE POLICY service_role_engagement ON contact_engagement FOR ALL TO service_role USING (true) WITH CHECK (true)';
  END IF;
  -- scoring_calibration
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'service_role_calibration') THEN
    EXECUTE 'CREATE POLICY service_role_calibration ON scoring_calibration FOR ALL TO service_role USING (true) WITH CHECK (true)';
  END IF;
  -- template_performance
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'service_role_template_perf') THEN
    EXECUTE 'CREATE POLICY service_role_template_perf ON template_performance FOR ALL TO service_role USING (true) WITH CHECK (true)';
  END IF;
  -- pipeline_velocity
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'service_role_pipeline_velocity') THEN
    EXECUTE 'CREATE POLICY service_role_pipeline_velocity ON pipeline_velocity FOR ALL TO service_role USING (true) WITH CHECK (true)';
  END IF;
END
$$;
