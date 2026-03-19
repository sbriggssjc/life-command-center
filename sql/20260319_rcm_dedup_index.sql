-- ============================================================================
-- RCM Deduplication Index for marketing_leads
-- Prevents duplicate inserts when Power Automate fires multiple times
-- for the same email notification.
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_leads_source_ref
ON marketing_leads (source, source_ref)
WHERE source_ref IS NOT NULL;
