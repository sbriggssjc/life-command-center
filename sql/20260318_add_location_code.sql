-- Migration: Add location_code support to prospect_leads and create reference table
-- Date: 2026-03-18
-- Status: Applied to production

ALTER TABLE prospect_leads ADD COLUMN IF NOT EXISTS location_code TEXT;

CREATE INDEX IF NOT EXISTS idx_prospect_leads_location_code
  ON prospect_leads (location_code)
  WHERE location_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS location_code_reference (
  location_code TEXT PRIMARY KEY,
  pbs_region TEXT,
  state TEXT,
  city TEXT,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO location_code_reference (location_code, state, city)
SELECT DISTINCT location_code, state, city
FROM gsa_lease_events
WHERE location_code IS NOT NULL AND location_code != ''
ON CONFLICT (location_code) DO NOTHING;
