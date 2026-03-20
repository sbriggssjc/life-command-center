-- ============================================================================
-- RCM → Salesforce Activity Pipeline
-- Links marketing_leads to salesforce_activities so RCM inquiries appear
-- in the CRM hub with full action buttons (complete/reschedule/dismiss).
-- ============================================================================

-- Link column: marketing_leads → salesforce_activities
ALTER TABLE marketing_leads ADD COLUMN IF NOT EXISTS sf_activity_id uuid;
CREATE INDEX IF NOT EXISTS idx_marketing_leads_sf_activity
ON marketing_leads (sf_activity_id) WHERE sf_activity_id IS NOT NULL;

-- Prevent duplicate SF activities from repeated RCM ingests
-- source_ref stores 'rcm:{email_message_id}' for RCM-sourced tasks
ALTER TABLE salesforce_activities ADD COLUMN IF NOT EXISTS source_ref text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sf_activities_source_ref
ON salesforce_activities (source_ref) WHERE source_ref IS NOT NULL;

-- RPC function to refresh CRM rollup (called after RCM ingest)
CREATE OR REPLACE FUNCTION refresh_crm_rollup()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY v_crm_client_rollup;
END;
$$;

-- Auto-refresh CRM rollup every 15 minutes via pg_cron
SELECT cron.schedule('refresh-crm-client-rollup', '*/15 * * * *',
  'REFRESH MATERIALIZED VIEW CONCURRENTLY v_crm_client_rollup');
