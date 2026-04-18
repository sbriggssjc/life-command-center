-- ============================================================================
-- R6-4: Contact email aliases for multi-address touchpoint matching
-- Gov Supabase — unified_contacts
--
-- Touchpoint counts were 0 for contacts like Sarah Martin and Nathanael
-- Berwaldt even though inbox_items had matching email threads, because the
-- contact record only stores a single canonical `email`, while real inboxes
-- see the same person under multiple addresses (work/personal/iCloud/etc.).
--
-- This migration adds an `email_aliases text[]` column and a GIN index so we
-- can cheaply fan the touchpoint query out across every known address for a
-- contact.
-- ============================================================================

ALTER TABLE unified_contacts
  ADD COLUMN IF NOT EXISTS email_aliases TEXT[] NOT NULL DEFAULT '{}';

-- Fast containment lookups ("does this contact own address X?")
CREATE INDEX IF NOT EXISTS idx_unified_contacts_email_aliases
  ON unified_contacts USING GIN (email_aliases);

-- ---------------------------------------------------------------------------
-- Seed the alias set from the existing single-value email columns so every
-- contact starts with at least its primary + secondary address. Subsequent
-- seeding from observed inbox_items.metadata->>'sender_email' matches should
-- be run as a maintenance job (see api/_handlers/contacts-handler.js →
-- getContact for the runtime matching logic).
-- ---------------------------------------------------------------------------

UPDATE unified_contacts
SET email_aliases = ARRAY(
  SELECT DISTINCT LOWER(TRIM(addr))
  FROM UNNEST(
    ARRAY[
      NULLIF(LOWER(TRIM(email)), ''),
      NULLIF(LOWER(TRIM(email_secondary)), '')
    ]
    || COALESCE(email_aliases, '{}')
  ) AS addr
  WHERE addr IS NOT NULL AND addr <> ''
)
WHERE email IS NOT NULL OR email_secondary IS NOT NULL;
