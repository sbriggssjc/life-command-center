-- ============================================================
-- SF Activity History Import → sf_activities + unified_contacts backfill
-- Run AFTER loading CSV into sf_activity_history_import staging table
-- ============================================================

-- Step 0: Ensure engagement columns exist on unified_contacts
ALTER TABLE unified_contacts
ADD COLUMN IF NOT EXISTS last_activity_date DATE,
ADD COLUMN IF NOT EXISTS total_touches INTEGER DEFAULT 0;

-- Step 1: Add indexes on staging table for transform performance
CREATE INDEX IF NOT EXISTS idx_ahist_contact ON sf_activity_history_import (sf_contact_id);
CREATE INDEX IF NOT EXISTS idx_ahist_activity ON sf_activity_history_import (sf_activity_id);
CREATE INDEX IF NOT EXISTS idx_ahist_email ON sf_activity_history_import (LOWER(email));

-- Step 2: Insert new activities into sf_activities (skip duplicates by sf_task_id)
INSERT INTO sf_activities (
  sf_task_id,
  sf_who_id,
  sf_what_id,
  activity_type,
  subject,
  activity_date,
  is_completed,
  contact_name,
  sf_contact_id,
  sf_account_id,
  account_name,
  nm_type,
  import_source,
  import_batch,
  imported_at
)
SELECT DISTINCT ON (h.sf_activity_id)
  h.sf_activity_id,                                    -- sf_task_id
  h.sf_contact_id,                                     -- sf_who_id
  h.sf_company_id,                                     -- sf_what_id (account)
  LOWER(COALESCE(NULLIF(h.subject, ''), 'other')),      -- activity_type: 'call', 'email', 'other'
  CONCAT(COALESCE(h.subject, 'Activity'), ' - ', COALESCE(h.nm_type, '')),  -- subject with deal context
  CASE
    WHEN h.date_completed ~ '^\d{1,2}/\d{1,2}/\d{4}$'
    THEN TO_DATE(h.date_completed, 'MM/DD/YYYY')
    ELSE NULL
  END,                                                 -- activity_date
  CASE WHEN h.date_completed IS NOT NULL THEN true ELSE false END,
  h.full_name,                                         -- contact_name
  h.sf_contact_id,
  h.sf_company_id,                                     -- sf_account_id
  COALESCE(h.company_name, h.company_name_2),          -- account_name
  h.nm_type,
  'csv_activity_history',
  h.import_batch,
  now()
FROM sf_activity_history_import h
WHERE h.sf_activity_id IS NOT NULL
  AND h.sf_activity_id != ''
  AND h.sf_activity_id != '0'
  AND NOT EXISTS (
    SELECT 1 FROM sf_activities a WHERE a.sf_task_id = h.sf_activity_id
  )
ORDER BY h.sf_activity_id, h.id;

-- Step 3: Backfill company_name in unified_contacts from activity history
UPDATE unified_contacts uc
SET
  company_name = sub.company_name,
  updated_at = now()
FROM (
  SELECT DISTINCT ON (h.sf_contact_id)
    h.sf_contact_id,
    COALESCE(h.company_name, h.company_name_2) AS company_name
  FROM sf_activity_history_import h
  WHERE h.sf_contact_id IS NOT NULL
    AND (h.company_name IS NOT NULL OR h.company_name_2 IS NOT NULL)
  ORDER BY h.sf_contact_id, h.id DESC  -- most recent first
) sub
WHERE uc.sf_contact_id = sub.sf_contact_id
  AND (uc.company_name IS NULL OR uc.company_name = '');

-- Step 4: Backfill missing address info in unified_contacts
UPDATE unified_contacts uc
SET
  city = COALESCE(uc.city, sub.mailing_city),
  state = COALESCE(uc.state, sub.mailing_state),
  updated_at = now()
FROM (
  SELECT DISTINCT ON (h.sf_contact_id)
    h.sf_contact_id,
    h.mailing_city,
    h.mailing_state
  FROM sf_activity_history_import h
  WHERE h.sf_contact_id IS NOT NULL
    AND h.mailing_city IS NOT NULL
  ORDER BY h.sf_contact_id, h.id DESC
) sub
WHERE uc.sf_contact_id = sub.sf_contact_id
  AND uc.city IS NULL;

-- Step 5: Mark staging rows as processed
UPDATE sf_activity_history_import SET processed = true, imported_at = now()
WHERE processed = false;

-- Step 6: Update engagement stats on unified_contacts
UPDATE unified_contacts uc
SET
  last_activity_date = sub.last_activity,
  total_touches = sub.touch_count,
  updated_at = now()
FROM (
  SELECT
    sf_contact_id,
    MAX(activity_date) AS last_activity,
    COUNT(*) AS touch_count
  FROM sf_activities
  WHERE sf_contact_id IS NOT NULL
  GROUP BY sf_contact_id
) sub
WHERE uc.sf_contact_id = sub.sf_contact_id;
