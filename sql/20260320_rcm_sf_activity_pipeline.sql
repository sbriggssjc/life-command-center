-- ============================================================================
-- RCM → Salesforce Activity Pipeline
-- Links marketing_leads to salesforce_activities so RCM inquiries appear
-- in the CRM hub with full action buttons (complete/reschedule/dismiss).
-- ============================================================================

-- Link column: marketing_leads → salesforce_activities
ALTER TABLE marketing_leads ADD COLUMN IF NOT EXISTS sf_activity_id bigint;
CREATE INDEX IF NOT EXISTS idx_marketing_leads_sf_activity
ON marketing_leads (sf_activity_id) WHERE sf_activity_id IS NOT NULL;

-- Prevent duplicate SF activities from repeated RCM ingests
-- source_ref stores 'rcm:{email_message_id}' for RCM-sourced tasks
ALTER TABLE salesforce_activities ADD COLUMN IF NOT EXISTS source_ref text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sf_activities_source_ref
ON salesforce_activities (source_ref) WHERE source_ref IS NOT NULL;
