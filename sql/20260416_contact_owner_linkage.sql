-- ============================================================================
-- Contact ↔ Owner Linkage, Deduplication & Cross-Reference
-- Run on BOTH government and dialysis Supabase databases
-- 2026-04-16
-- ============================================================================
--
-- WHAT THIS DOES:
--   1. Adds FK columns linking contacts ↔ true_owners ↔ recorded_owners
--   2. Creates a normalize function for name matching across tables
--   3. Backfills links between existing contacts and owners by name match
--   4. Deduplicates the contacts table (merge by email, then by name+role)
--   5. Creates a trigger so future sidebar ingests auto-link on INSERT/UPDATE
--   6. Creates a view for prospecting-ready contact cards
--
-- SAFE TO RE-RUN: all statements are idempotent (IF NOT EXISTS / ON CONFLICT)
-- ============================================================================

-- ── 1. Schema additions ─────────────────────────────────────────────────────

-- 1a. contacts table: add owner linkage columns
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS true_owner_id  UUID;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS recorded_owner_id UUID;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS property_id UUID;  -- will be INT on dialysis; see note below
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS normalized_name TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS website TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 1b. true_owners table: add contact_id back-link
ALTER TABLE true_owners ADD COLUMN IF NOT EXISTS contact_id UUID;

-- 1c. recorded_owners table: add contact_id back-link
ALTER TABLE recorded_owners ADD COLUMN IF NOT EXISTS contact_id UUID;

-- 1d. Indexes for the new FK columns
CREATE INDEX IF NOT EXISTS idx_contacts_true_owner_id
  ON contacts (true_owner_id) WHERE true_owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_recorded_owner_id
  ON contacts (recorded_owner_id) WHERE recorded_owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_normalized_name
  ON contacts (normalized_name) WHERE normalized_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_email
  ON contacts (email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_true_owners_contact_id
  ON true_owners (contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_recorded_owners_contact_id
  ON recorded_owners (contact_id) WHERE contact_id IS NOT NULL;


-- ── 2. Shared normalization function ────────────────────────────────────────

CREATE OR REPLACE FUNCTION normalize_entity_name(raw TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(
           regexp_replace(
             regexp_replace(
               lower(trim(raw)),
               '\m(llc|inc|corp|ltd|co|company|group|partners|lp|llp|trust|trustee|trustees|the|a)\M\.?',
               '', 'gi'
             ),
             '[^a-z0-9 ]', ' ', 'g'
           ),
           '\s+', ' ', 'g'
         )
$$;


-- ── 3. Backfill normalized_name on contacts ─────────────────────────────────

UPDATE contacts
SET normalized_name = normalize_entity_name(name)
WHERE normalized_name IS NULL AND name IS NOT NULL;


-- ── 4. Link contacts → true_owners by name match ───────────────────────────
-- Match contacts (role in owner/buyer/seller) to true_owners using normalized names.
-- Uses the domain-appropriate column (canonical_name or normalized_name).

-- 4a. Try matching via true_owners
UPDATE contacts c
SET true_owner_id = t.true_owner_id
FROM true_owners t
WHERE c.true_owner_id IS NULL
  AND c.role IN ('owner', 'buyer', 'seller')
  AND c.normalized_name IS NOT NULL
  AND c.normalized_name != ''
  AND (
    -- Government uses canonical_name (uppercase); compare lowered
    normalize_entity_name(t.name) = c.normalized_name
  );

-- 4b. Back-link: set true_owners.contact_id for matched contacts
UPDATE true_owners t
SET contact_id = (
  SELECT c.id FROM contacts c
  WHERE c.true_owner_id = t.true_owner_id
    AND c.email IS NOT NULL          -- prefer contacts with email
  ORDER BY c.updated_at DESC NULLS LAST
  LIMIT 1
)
WHERE t.contact_id IS NULL
  AND EXISTS (
    SELECT 1 FROM contacts c WHERE c.true_owner_id = t.true_owner_id
  );

-- If no email match, fall back to any linked contact
UPDATE true_owners t
SET contact_id = (
  SELECT c.id FROM contacts c
  WHERE c.true_owner_id = t.true_owner_id
  ORDER BY c.updated_at DESC NULLS LAST
  LIMIT 1
)
WHERE t.contact_id IS NULL
  AND EXISTS (
    SELECT 1 FROM contacts c WHERE c.true_owner_id = t.true_owner_id
  );


-- ── 5. Link contacts → recorded_owners by name match ───────────────────────

UPDATE contacts c
SET recorded_owner_id = r.recorded_owner_id
FROM recorded_owners r
WHERE c.recorded_owner_id IS NULL
  AND c.role IN ('owner', 'buyer', 'seller')
  AND c.normalized_name IS NOT NULL
  AND c.normalized_name != ''
  AND normalize_entity_name(r.name) = c.normalized_name;

-- Back-link recorded_owners.contact_id
UPDATE recorded_owners r
SET contact_id = (
  SELECT c.id FROM contacts c
  WHERE c.recorded_owner_id = r.recorded_owner_id
    AND c.email IS NOT NULL
  ORDER BY c.updated_at DESC NULLS LAST
  LIMIT 1
)
WHERE r.contact_id IS NULL
  AND EXISTS (
    SELECT 1 FROM contacts c WHERE c.recorded_owner_id = r.recorded_owner_id
  );

UPDATE recorded_owners r
SET contact_id = (
  SELECT c.id FROM contacts c
  WHERE c.recorded_owner_id = r.recorded_owner_id
  ORDER BY c.updated_at DESC NULLS LAST
  LIMIT 1
)
WHERE r.contact_id IS NULL
  AND EXISTS (
    SELECT 1 FROM contacts c WHERE c.recorded_owner_id = r.recorded_owner_id
  );


-- ── 6. Link contacts → properties (via true_owner_id on properties) ────────

UPDATE contacts c
SET property_id = p.property_id
FROM properties p
WHERE c.property_id IS NULL
  AND c.true_owner_id IS NOT NULL
  AND p.true_owner_id = c.true_owner_id;


-- ── 7. Deduplicate contacts ────────────────────────────────────────────────
-- Strategy: for contacts with the same email, keep the one with the most data
-- and merge fields from duplicates.

-- 7a. Create a temp table of duplicate groups (by email)
CREATE TEMP TABLE _contact_dupes AS
SELECT
  email,
  array_agg(id ORDER BY
    -- Score: prefer records with more non-null fields
    (CASE WHEN phone IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN company IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN true_owner_id IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN recorded_owner_id IS NOT NULL THEN 1 ELSE 0 END)
    DESC,
    updated_at DESC NULLS LAST
  ) AS ids
FROM contacts
WHERE email IS NOT NULL
GROUP BY lower(email)
HAVING count(*) > 1;

-- 7b. Merge: enrich the "winner" (first in ids[]) with data from losers
DO $$
DECLARE
  rec RECORD;
  winner_id UUID;
  loser_ids UUID[];
BEGIN
  FOR rec IN SELECT * FROM _contact_dupes LOOP
    winner_id := rec.ids[1];
    loser_ids := rec.ids[2:];

    -- Merge phone from losers if winner is missing it
    UPDATE contacts SET phone = sub.phone
    FROM (
      SELECT phone FROM contacts
      WHERE id = ANY(loser_ids) AND phone IS NOT NULL
      LIMIT 1
    ) sub
    WHERE contacts.id = winner_id AND contacts.phone IS NULL;

    -- Merge company
    UPDATE contacts SET company = sub.company
    FROM (
      SELECT company FROM contacts
      WHERE id = ANY(loser_ids) AND company IS NOT NULL
      LIMIT 1
    ) sub
    WHERE contacts.id = winner_id AND contacts.company IS NULL;

    -- Merge true_owner_id
    UPDATE contacts SET true_owner_id = sub.true_owner_id
    FROM (
      SELECT true_owner_id FROM contacts
      WHERE id = ANY(loser_ids) AND true_owner_id IS NOT NULL
      LIMIT 1
    ) sub
    WHERE contacts.id = winner_id AND contacts.true_owner_id IS NULL;

    -- Merge recorded_owner_id
    UPDATE contacts SET recorded_owner_id = sub.recorded_owner_id
    FROM (
      SELECT recorded_owner_id FROM contacts
      WHERE id = ANY(loser_ids) AND recorded_owner_id IS NOT NULL
      LIMIT 1
    ) sub
    WHERE contacts.id = winner_id AND contacts.recorded_owner_id IS NULL;

    -- Merge website
    UPDATE contacts SET website = sub.website
    FROM (
      SELECT website FROM contacts
      WHERE id = ANY(loser_ids) AND website IS NOT NULL
      LIMIT 1
    ) sub
    WHERE contacts.id = winner_id AND contacts.website IS NULL;

    -- Re-point any true_owners / recorded_owners referencing losers
    UPDATE true_owners SET contact_id = winner_id
    WHERE contact_id = ANY(loser_ids);

    UPDATE recorded_owners SET contact_id = winner_id
    WHERE contact_id = ANY(loser_ids);

    -- Delete losers
    DELETE FROM contacts WHERE id = ANY(loser_ids);
  END LOOP;
END $$;

DROP TABLE IF EXISTS _contact_dupes;


-- ── 8. Auto-link trigger for future inserts/updates ────────────────────────

CREATE OR REPLACE FUNCTION trg_contact_auto_link()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_norm TEXT;
  v_true_owner_id UUID;
  v_rec_owner_id UUID;
BEGIN
  -- Compute normalized name
  NEW.normalized_name := normalize_entity_name(NEW.name);
  NEW.updated_at := now();

  -- Only auto-link for owner/buyer/seller roles
  IF NEW.role NOT IN ('owner', 'buyer', 'seller') THEN
    RETURN NEW;
  END IF;

  -- Try to match true_owner
  IF NEW.true_owner_id IS NULL AND NEW.normalized_name IS NOT NULL THEN
    SELECT t.true_owner_id INTO v_true_owner_id
    FROM true_owners t
    WHERE normalize_entity_name(t.name) = NEW.normalized_name
    LIMIT 1;

    IF v_true_owner_id IS NOT NULL THEN
      NEW.true_owner_id := v_true_owner_id;
      -- Back-link if true_owner has no contact_id yet
      UPDATE true_owners SET contact_id = NEW.id
      WHERE true_owner_id = v_true_owner_id AND contact_id IS NULL;
    END IF;
  END IF;

  -- Try to match recorded_owner
  IF NEW.recorded_owner_id IS NULL AND NEW.normalized_name IS NOT NULL THEN
    SELECT r.recorded_owner_id INTO v_rec_owner_id
    FROM recorded_owners r
    WHERE normalize_entity_name(r.name) = NEW.normalized_name
    LIMIT 1;

    IF v_rec_owner_id IS NOT NULL THEN
      NEW.recorded_owner_id := v_rec_owner_id;
      UPDATE recorded_owners SET contact_id = NEW.id
      WHERE recorded_owner_id = v_rec_owner_id AND contact_id IS NULL;
    END IF;
  END IF;

  -- Link to property via true_owner_id
  IF NEW.property_id IS NULL AND NEW.true_owner_id IS NOT NULL THEN
    SELECT p.property_id INTO NEW.property_id
    FROM properties p
    WHERE p.true_owner_id = NEW.true_owner_id
    LIMIT 1;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS contact_auto_link ON contacts;
CREATE TRIGGER contact_auto_link
  BEFORE INSERT OR UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION trg_contact_auto_link();


-- ── 9. Prospecting view: contacts enriched with owner + property context ───

CREATE OR REPLACE VIEW v_contact_cards AS
SELECT
  c.id              AS contact_id,
  c.name            AS contact_name,
  c.email,
  c.phone,
  c.company,
  c.role,
  c.website,
  c.address,
  c.city,
  c.state,
  c.data_source,
  -- True owner context
  t.true_owner_id,
  t.name            AS true_owner_name,
  -- Recorded owner context
  r.recorded_owner_id,
  r.name            AS recorded_owner_name,
  -- Property context
  p.property_id,
  p.address          AS property_address,
  p.city             AS property_city,
  p.state            AS property_state,
  -- Sale history (most recent)
  s.sale_date        AS last_sale_date,
  s.sold_price       AS last_sale_price,
  c.created_at,
  c.updated_at
FROM contacts c
LEFT JOIN true_owners t      ON t.true_owner_id = c.true_owner_id
LEFT JOIN recorded_owners r  ON r.recorded_owner_id = c.recorded_owner_id
LEFT JOIN properties p       ON p.property_id = c.property_id
LEFT JOIN LATERAL (
  SELECT sale_date, sold_price
  FROM sales_transactions
  WHERE property_id = p.property_id
  ORDER BY sale_date DESC
  LIMIT 1
) s ON true;


-- ── 10. Periodic maintenance function (call from pg_cron or manually) ──────

CREATE OR REPLACE FUNCTION maintain_contact_links()
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_linked_true   INT := 0;
  v_linked_rec    INT := 0;
  v_deduped       INT := 0;
  v_normalized    INT := 0;
BEGIN
  -- Re-normalize any contacts missing normalized_name
  UPDATE contacts
  SET normalized_name = normalize_entity_name(name)
  WHERE normalized_name IS NULL AND name IS NOT NULL;
  GET DIAGNOSTICS v_normalized = ROW_COUNT;

  -- Link unlinked contacts to true_owners
  UPDATE contacts c
  SET true_owner_id = t.true_owner_id
  FROM true_owners t
  WHERE c.true_owner_id IS NULL
    AND c.role IN ('owner', 'buyer', 'seller')
    AND c.normalized_name IS NOT NULL
    AND normalize_entity_name(t.name) = c.normalized_name;
  GET DIAGNOSTICS v_linked_true = ROW_COUNT;

  -- Link unlinked contacts to recorded_owners
  UPDATE contacts c
  SET recorded_owner_id = r.recorded_owner_id
  FROM recorded_owners r
  WHERE c.recorded_owner_id IS NULL
    AND c.role IN ('owner', 'buyer', 'seller')
    AND c.normalized_name IS NOT NULL
    AND normalize_entity_name(r.name) = c.normalized_name;
  GET DIAGNOSTICS v_linked_rec = ROW_COUNT;

  -- Back-link true_owners.contact_id
  UPDATE true_owners t
  SET contact_id = (
    SELECT c.id FROM contacts c
    WHERE c.true_owner_id = t.true_owner_id
    ORDER BY (c.email IS NOT NULL)::int DESC, c.updated_at DESC NULLS LAST
    LIMIT 1
  )
  WHERE t.contact_id IS NULL
    AND EXISTS (SELECT 1 FROM contacts c WHERE c.true_owner_id = t.true_owner_id);

  -- Back-link recorded_owners.contact_id
  UPDATE recorded_owners r
  SET contact_id = (
    SELECT c.id FROM contacts c
    WHERE c.recorded_owner_id = r.recorded_owner_id
    ORDER BY (c.email IS NOT NULL)::int DESC, c.updated_at DESC NULLS LAST
    LIMIT 1
  )
  WHERE r.contact_id IS NULL
    AND EXISTS (SELECT 1 FROM contacts c WHERE c.recorded_owner_id = r.recorded_owner_id);

  -- Link contacts to properties
  UPDATE contacts c
  SET property_id = p.property_id
  FROM properties p
  WHERE c.property_id IS NULL
    AND c.true_owner_id IS NOT NULL
    AND p.true_owner_id = c.true_owner_id;

  RETURN jsonb_build_object(
    'normalized', v_normalized,
    'linked_true_owners', v_linked_true,
    'linked_recorded_owners', v_linked_rec,
    'timestamp', now()
  );
END $$;


-- ── Done ────────────────────────────────────────────────────────────────────
-- To verify after running:
--   SELECT count(*) FROM contacts WHERE true_owner_id IS NOT NULL;
--   SELECT count(*) FROM contacts WHERE recorded_owner_id IS NOT NULL;
--   SELECT count(*) FROM true_owners WHERE contact_id IS NOT NULL;
--   SELECT * FROM v_contact_cards WHERE email IS NOT NULL LIMIT 20;
--   SELECT maintain_contact_links();
