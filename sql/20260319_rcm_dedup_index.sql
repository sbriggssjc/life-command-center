-- ============================================================================
-- marketing_leads table + RCM deduplication index
-- Creates the marketing_leads table for inbound lead tracking from RCM,
-- CoStar, LoopNet, and other marketing sources.
-- ============================================================================

CREATE TABLE IF NOT EXISTS marketing_leads (
  lead_id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source           text NOT NULL DEFAULT 'manual',       -- rcm, costar, loopnet, manual, etc.
  source_ref       text,                                  -- external ID (e.g. email message ID)
  lead_name        text,
  lead_first_name  text,
  lead_last_name   text,
  lead_email       text,
  lead_phone       text,
  lead_company     text,
  deal_name        text,                                  -- property / listing name
  activity_type    text,                                  -- rcm_inquiry, CA Request, etc.
  activity_detail  text,
  lead_date        timestamptz,
  follow_up_date   date,
  raw_body         text,                                  -- original email text for reference
  status           text NOT NULL DEFAULT 'new',           -- new, contacted, qualified, archived, duplicate
  sf_contact_id    text,                                  -- matched Salesforce contact
  sf_match_status  text DEFAULT 'unmatched',              -- matched, unmatched
  touchpoint_count integer DEFAULT 0,
  assigned_to      text,
  ingested_at      timestamptz DEFAULT now(),
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

-- Prevent duplicate inserts when Power Automate fires multiple times
CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_leads_source_ref
ON marketing_leads (source, source_ref)
WHERE source_ref IS NOT NULL;

-- Fast lookups by source, status, and SF match
CREATE INDEX IF NOT EXISTS idx_marketing_leads_source ON marketing_leads (source);
CREATE INDEX IF NOT EXISTS idx_marketing_leads_status ON marketing_leads (status);
CREATE INDEX IF NOT EXISTS idx_marketing_leads_sf_contact ON marketing_leads (sf_contact_id) WHERE sf_contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_marketing_leads_ingested ON marketing_leads (ingested_at DESC NULLS LAST);
