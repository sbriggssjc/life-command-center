-- ============================================================================
-- Unified Contact Hub — Schema Migration
-- Life Command Center — Gov Supabase (scknotsqkcheojiaewwh)
--
-- Creates the unified_contacts table and contact_change_log audit table.
-- Provides a single contact graph across Salesforce, Outlook, Calendar,
-- WebEx, iPhone/iCloud, and Supabase domain databases with personal/business
-- classification and engagement scoring.
-- ============================================================================

-- Enable pg_trgm for fuzzy name matching (idempotent)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================================
-- 1. unified_contacts — canonical contact records
-- ============================================================================

CREATE TABLE IF NOT EXISTS unified_contacts (
  unified_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Classification: 'business' contacts sync to SF/CRM; 'personal' stay private
  contact_class TEXT NOT NULL DEFAULT 'business'
    CHECK (contact_class IN ('business', 'personal')),

  -- Canonical fields (resolved best value from all sources)
  first_name TEXT,
  last_name TEXT,
  full_name TEXT GENERATED ALWAYS AS (
    COALESCE(first_name || ' ' || last_name, first_name, last_name)
  ) STORED,
  email TEXT,
  email_secondary TEXT,
  phone TEXT,
  mobile_phone TEXT,
  title TEXT,
  company_name TEXT,
  city TEXT,
  state TEXT,
  website TEXT,

  -- Business-specific fields (NULL for personal contacts)
  entity_type TEXT,         -- 'individual' | 'llc' | 'trust' | 'corporation' etc.
  contact_type TEXT,        -- 'owner' | 'broker' | 'buyer' | 'developer' | 'lender'
  industry TEXT,
  is_1031_buyer BOOLEAN DEFAULT false,
  total_transactions INTEGER DEFAULT 0,
  total_volume NUMERIC DEFAULT 0,
  avg_cap_rate NUMERIC,

  -- Source linkages (foreign keys to each system)
  sf_contact_id TEXT,
  sf_account_id TEXT,
  gov_contact_id UUID,
  dia_contact_id UUID,
  true_owner_id UUID,
  recorded_owner_id UUID,
  outlook_contact_id TEXT,
  webex_person_id TEXT,           -- WebEx People API person ID
  icloud_contact_id TEXT,         -- Apple iCloud contact ID (via CardDAV or Exchange sync)

  -- Engagement signals (auto-updated from WebEx, Outlook, Calendar)
  last_call_date TIMESTAMPTZ,     -- most recent WebEx or logged call
  last_email_date TIMESTAMPTZ,    -- most recent email exchange (sent or received)
  last_meeting_date TIMESTAMPTZ,  -- most recent calendar meeting as attendee
  total_calls INTEGER DEFAULT 0,  -- lifetime call count from WebEx + logged calls
  total_emails_sent INTEGER DEFAULT 0,
  engagement_score NUMERIC DEFAULT 0, -- computed: recency + frequency + depth

  -- Field provenance: which source provided each canonical field
  -- Format: {"field_name": {"source": "salesforce", "updated_at": "2026-03-18T..."}}
  field_sources JSONB DEFAULT '{}',

  -- Matching metadata
  match_confidence NUMERIC DEFAULT 0
    CHECK (match_confidence >= 0 AND match_confidence <= 1),
  match_method TEXT,  -- 'email_exact' | 'name_company_fuzzy' | 'phone_exact' | 'manual' | 'sf_import'

  -- Merge history: array of {merged_from, merged_at, fields_updated}
  merge_history JSONB DEFAULT '[]',

  -- Staleness flags
  email_stale BOOLEAN DEFAULT false,
  phone_stale BOOLEAN DEFAULT false,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  last_synced_sf TIMESTAMPTZ,
  last_synced_outlook TIMESTAMPTZ,
  last_synced_calendar TIMESTAMPTZ
);

-- Indexes for fast matching and lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_uc_email
  ON unified_contacts (LOWER(email)) WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_uc_sf_contact
  ON unified_contacts (sf_contact_id) WHERE sf_contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_uc_outlook
  ON unified_contacts (outlook_contact_id) WHERE outlook_contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_uc_name_company
  ON unified_contacts (LOWER(last_name), LOWER(company_name));

CREATE INDEX IF NOT EXISTS idx_uc_phone
  ON unified_contacts (phone) WHERE phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_uc_class
  ON unified_contacts (contact_class);

CREATE INDEX IF NOT EXISTS idx_uc_updated
  ON unified_contacts (updated_at DESC);

-- Trigram index for fuzzy name search
CREATE INDEX IF NOT EXISTS idx_uc_full_name_trgm
  ON unified_contacts USING gin (full_name gin_trgm_ops);

-- WebEx person ID index
CREATE INDEX IF NOT EXISTS idx_uc_webex
  ON unified_contacts (webex_person_id) WHERE webex_person_id IS NOT NULL;

-- iCloud contact ID index
CREATE INDEX IF NOT EXISTS idx_uc_icloud
  ON unified_contacts (icloud_contact_id) WHERE icloud_contact_id IS NOT NULL;

-- Engagement score index (business contacts sorted by engagement for hot leads)
CREATE INDEX IF NOT EXISTS idx_uc_engagement
  ON unified_contacts (engagement_score DESC) WHERE contact_class = 'business';

-- ============================================================================
-- 2. contact_change_log — audit trail for every change
-- ============================================================================

CREATE TABLE IF NOT EXISTS contact_change_log (
  log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unified_id UUID REFERENCES unified_contacts(unified_id) ON DELETE SET NULL,
  change_type TEXT NOT NULL
    CHECK (change_type IN ('create', 'merge', 'update', 'classify', 'delete', 'stale_flag', 'engagement')),
  source TEXT NOT NULL,  -- 'salesforce' | 'outlook' | 'calendar' | 'webex' | 'iphone' | 'manual' | 'system'
  fields_changed JSONB,  -- {"email": {"old": "x@y.com", "new": "x@z.com"}}
  merged_from UUID,      -- if merge, which contact was absorbed
  changed_by TEXT,       -- user who initiated
  changed_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ccl_unified
  ON contact_change_log (unified_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_ccl_type
  ON contact_change_log (change_type, changed_at DESC);

-- ============================================================================
-- 3. contact_merge_queue — flagged potential duplicates for manual review
-- ============================================================================

CREATE TABLE IF NOT EXISTS contact_merge_queue (
  queue_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_a UUID REFERENCES unified_contacts(unified_id) ON DELETE CASCADE,
  contact_b UUID REFERENCES unified_contacts(unified_id) ON DELETE CASCADE,
  match_score NUMERIC DEFAULT 0,
  match_reason TEXT,       -- 'name_company_fuzzy' | 'phone_match' | 'duplicate_email'
  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'merged', 'dismissed')),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cmq_status
  ON contact_merge_queue (status) WHERE status = 'pending';

-- ============================================================================
-- 4. Entity resolution function — match incoming contact to existing records
-- ============================================================================

CREATE OR REPLACE FUNCTION resolve_contact(
  p_email TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_first_name TEXT DEFAULT NULL,
  p_last_name TEXT DEFAULT NULL,
  p_company_name TEXT DEFAULT NULL
)
RETURNS TABLE (
  unified_id UUID,
  match_tier INTEGER,      -- 0=email, 1=phone, 2=name+company, 3=name-only
  match_score NUMERIC,
  full_name TEXT,
  email TEXT,
  company_name TEXT
) LANGUAGE plpgsql AS $$
BEGIN
  -- Tier 0: Email exact match (highest confidence)
  IF p_email IS NOT NULL AND p_email != '' THEN
    RETURN QUERY
      SELECT uc.unified_id, 0 AS match_tier, 1.0::NUMERIC AS match_score,
             uc.full_name, uc.email, uc.company_name
      FROM unified_contacts uc
      WHERE LOWER(uc.email) = LOWER(p_email)
      LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- Tier 1: Phone exact match (digits only)
  IF p_phone IS NOT NULL AND p_phone != '' THEN
    RETURN QUERY
      SELECT uc.unified_id, 1 AS match_tier, 0.9::NUMERIC AS match_score,
             uc.full_name, uc.email, uc.company_name
      FROM unified_contacts uc
      WHERE regexp_replace(uc.phone, '[^0-9]', '', 'g') =
            regexp_replace(p_phone, '[^0-9]', '', 'g')
        AND regexp_replace(p_phone, '[^0-9]', '', 'g') != ''
        AND (p_last_name IS NULL
             OR similarity(LOWER(COALESCE(uc.full_name, '')),
                           LOWER(COALESCE(p_first_name || ' ' || p_last_name, p_last_name, ''))) > 0.5)
      LIMIT 1;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- Tier 2: Name + Company fuzzy match
  IF p_last_name IS NOT NULL AND p_company_name IS NOT NULL THEN
    RETURN QUERY
      SELECT uc.unified_id, 2 AS match_tier,
             similarity(LOWER(COALESCE(uc.full_name, '')),
                        LOWER(COALESCE(p_first_name || ' ' || p_last_name, p_last_name, '')))::NUMERIC AS match_score,
             uc.full_name, uc.email, uc.company_name
      FROM unified_contacts uc
      WHERE LOWER(uc.company_name) = LOWER(p_company_name)
        AND similarity(LOWER(COALESCE(uc.full_name, '')),
                        LOWER(COALESCE(p_first_name || ' ' || p_last_name, p_last_name, ''))) > 0.6
      ORDER BY match_score DESC
      LIMIT 3;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- Tier 3: Name-only fuzzy match (low confidence — flag only)
  IF p_last_name IS NOT NULL THEN
    RETURN QUERY
      SELECT uc.unified_id, 3 AS match_tier,
             similarity(LOWER(COALESCE(uc.full_name, '')),
                        LOWER(COALESCE(p_first_name || ' ' || p_last_name, p_last_name, '')))::NUMERIC AS match_score,
             uc.full_name, uc.email, uc.company_name
      FROM unified_contacts uc
      WHERE similarity(LOWER(COALESCE(uc.full_name, '')),
                        LOWER(COALESCE(p_first_name || ' ' || p_last_name, p_last_name, ''))) > 0.8
      ORDER BY match_score DESC
      LIMIT 3;
  END IF;
END;
$$;

-- ============================================================================
-- 5. Engagement score computation function
-- ============================================================================
-- Recency-weighted scoring: recent activity scores higher.
-- Score components: call recency + email recency + meeting recency + call frequency
-- Max score = 30 + 20 + 15 + 20 + 15 = 100

CREATE OR REPLACE FUNCTION compute_engagement_score(
  p_last_call_date TIMESTAMPTZ,
  p_last_email_date TIMESTAMPTZ,
  p_last_meeting_date TIMESTAMPTZ,
  p_total_calls INTEGER,
  p_total_emails_sent INTEGER DEFAULT 0
)
RETURNS NUMERIC LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  score NUMERIC := 0;
  days_call NUMERIC;
  days_email NUMERIC;
  days_meeting NUMERIC;
BEGIN
  -- Call recency (max 30 points)
  IF p_last_call_date IS NOT NULL THEN
    days_call := EXTRACT(EPOCH FROM (now() - p_last_call_date)) / 86400.0;
    IF days_call < 7 THEN score := score + 30;
    ELSIF days_call < 30 THEN score := score + 20;
    ELSIF days_call < 90 THEN score := score + 10;
    ELSIF days_call < 365 THEN score := score + 3;
    END IF;
  END IF;

  -- Email recency (max 20 points)
  IF p_last_email_date IS NOT NULL THEN
    days_email := EXTRACT(EPOCH FROM (now() - p_last_email_date)) / 86400.0;
    IF days_email < 7 THEN score := score + 20;
    ELSIF days_email < 30 THEN score := score + 15;
    ELSIF days_email < 90 THEN score := score + 5;
    ELSIF days_email < 365 THEN score := score + 2;
    END IF;
  END IF;

  -- Call frequency (max 20 points)
  IF p_total_calls > 10 THEN score := score + 20;
  ELSIF p_total_calls > 5 THEN score := score + 15;
  ELSIF p_total_calls > 0 THEN score := score + 10;
  END IF;

  -- Meeting recency (max 15 points)
  IF p_last_meeting_date IS NOT NULL THEN
    days_meeting := EXTRACT(EPOCH FROM (now() - p_last_meeting_date)) / 86400.0;
    IF days_meeting < 7 THEN score := score + 15;
    ELSIF days_meeting < 30 THEN score := score + 10;
    ELSIF days_meeting < 90 THEN score := score + 5;
    ELSIF days_meeting < 365 THEN score := score + 2;
    END IF;
  END IF;

  -- Email frequency bonus (max 15 points)
  IF p_total_emails_sent > 20 THEN score := score + 15;
  ELSIF p_total_emails_sent > 10 THEN score := score + 10;
  ELSIF p_total_emails_sent > 3 THEN score := score + 5;
  END IF;

  RETURN LEAST(score, 100);
END;
$$;

-- ============================================================================
-- 6. Auto-update updated_at trigger
-- ============================================================================

CREATE OR REPLACE FUNCTION update_unified_contacts_timestamp()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_unified_contacts_updated ON unified_contacts;
CREATE TRIGGER trg_unified_contacts_updated
  BEFORE UPDATE ON unified_contacts
  FOR EACH ROW EXECUTE FUNCTION update_unified_contacts_timestamp();

-- ============================================================================
-- 7. Seed from sf_contacts_import (initial 34K business contacts)
-- ============================================================================
-- Run this AFTER creating the table. It inserts SF contacts as the baseline.
-- ON CONFLICT handles duplicates by email.

/*
INSERT INTO unified_contacts (
  contact_class, first_name, last_name, email, phone, mobile_phone,
  title, company_name, city, state, sf_contact_id, sf_account_id,
  field_sources, match_confidence, match_method, last_synced_sf
)
SELECT
  'business',
  first_name, last_name, email, phone, mobile_phone,
  title, account_name, mailing_city, mailing_state,
  sf_contact_id, sf_account_id,
  jsonb_build_object(
    'email', jsonb_build_object('source', 'salesforce', 'updated_at', now()),
    'phone', jsonb_build_object('source', 'salesforce', 'updated_at', now()),
    'company_name', jsonb_build_object('source', 'salesforce', 'updated_at', now())
  ),
  1.0, 'sf_import', now()
FROM sf_contacts_import
WHERE sf_contact_id IS NOT NULL
ON CONFLICT (LOWER(email)) DO UPDATE SET
  sf_contact_id = EXCLUDED.sf_contact_id,
  sf_account_id = EXCLUDED.sf_account_id,
  last_synced_sf = now(),
  updated_at = now();
*/
