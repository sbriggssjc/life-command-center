-- ============================================================================
-- Contact ↔ Owner Linkage — DIALYSIS DATABASE
-- 2026-04-16
-- ============================================================================
-- Column mapping: contact_id (PK), contact_name, contact_email, contact_phone,
--   role, company, title, true_owner_id (exists), created_at, updated_at (exist)
-- true_owners.contact_id already exists; recorded_owners has recorded_owner_id PK
-- properties.property_id is INTEGER
-- ============================================================================

-- ── 1. Schema additions ─────────────────────────────────────────────────────

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS recorded_owner_id UUID;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS property_id INTEGER;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS normalized_name TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS website TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS data_source TEXT;

-- recorded_owners lacks contact_id — add it
ALTER TABLE recorded_owners ADD COLUMN IF NOT EXISTS contact_id UUID
  REFERENCES contacts(contact_id);

CREATE INDEX IF NOT EXISTS idx_contacts_true_owner_id
  ON contacts (true_owner_id) WHERE true_owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_recorded_owner_id
  ON contacts (recorded_owner_id) WHERE recorded_owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_normalized_name
  ON contacts (normalized_name) WHERE normalized_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_email
  ON contacts (contact_email) WHERE contact_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_role
  ON contacts (role) WHERE role IS NOT NULL;


-- ── 2. Normalize function ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION normalize_entity_name(raw TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT trim(regexp_replace(
           regexp_replace(
             regexp_replace(
               lower(trim(COALESCE(raw, ''))),
               '\m(llc|inc|corp|corporation|ltd|co|company|group|partners|lp|llp|trust|trustee|trustees|the|a)\M\.?',
               '', 'gi'
             ),
             '[^a-z0-9 ]', ' ', 'g'
           ),
           '\s+', ' ', 'g'
         ))
$$;


-- ── 3. Backfill normalized_name ─────────────────────────────────────────────

UPDATE contacts
SET normalized_name = normalize_entity_name(contact_name)
WHERE normalized_name IS NULL AND contact_name IS NOT NULL;


-- ── 4. Link contacts → true_owners ──────────────────────────────────────────

UPDATE contacts c
SET true_owner_id = t.true_owner_id
FROM true_owners t
WHERE c.true_owner_id IS NULL
  AND c.role IN ('owner', 'buyer', 'seller')
  AND c.normalized_name IS NOT NULL
  AND c.normalized_name != ''
  AND normalize_entity_name(t.name) = c.normalized_name;

-- Back-link: true_owners.contact_id (prefer contacts with email)
UPDATE true_owners t
SET contact_id = (
  SELECT c.contact_id FROM contacts c
  WHERE c.true_owner_id = t.true_owner_id
  ORDER BY (c.contact_email IS NOT NULL)::int DESC, c.updated_at DESC NULLS LAST
  LIMIT 1
)
WHERE t.contact_id IS NULL
  AND EXISTS (SELECT 1 FROM contacts c WHERE c.true_owner_id = t.true_owner_id);


-- ── 5. Link contacts → recorded_owners ──────────────────────────────────────

UPDATE contacts c
SET recorded_owner_id = r.recorded_owner_id
FROM recorded_owners r
WHERE c.recorded_owner_id IS NULL
  AND c.role IN ('owner', 'buyer', 'seller')
  AND c.normalized_name IS NOT NULL
  AND c.normalized_name != ''
  AND normalize_entity_name(r.name) = c.normalized_name;

-- Back-link: recorded_owners.contact_id
UPDATE recorded_owners r
SET contact_id = (
  SELECT c.contact_id FROM contacts c
  WHERE c.recorded_owner_id = r.recorded_owner_id
  ORDER BY (c.contact_email IS NOT NULL)::int DESC, c.updated_at DESC NULLS LAST
  LIMIT 1
)
WHERE r.contact_id IS NULL
  AND EXISTS (SELECT 1 FROM contacts c WHERE c.recorded_owner_id = r.recorded_owner_id);


-- ── 6. Link contacts → properties ───────────────────────────────────────────

UPDATE contacts c
SET property_id = p.property_id
FROM properties p
WHERE c.property_id IS NULL
  AND c.true_owner_id IS NOT NULL
  AND p.true_owner_id = c.true_owner_id;


-- ── 7. Deduplicate contacts by email ────────────────────────────────────────

CREATE TEMP TABLE _contact_dupes AS
SELECT
  lower(contact_email) AS email_lc,
  array_agg(contact_id ORDER BY
    (CASE WHEN contact_phone IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN company IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN true_owner_id IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN recorded_owner_id IS NOT NULL THEN 1 ELSE 0 END)
    DESC,
    updated_at DESC NULLS LAST
  ) AS ids
FROM contacts
WHERE contact_email IS NOT NULL
GROUP BY lower(contact_email)
HAVING count(*) > 1;

DO $$
DECLARE
  rec RECORD;
  winner_id UUID;
  loser_ids UUID[];
BEGIN
  FOR rec IN SELECT * FROM _contact_dupes LOOP
    winner_id := rec.ids[1];
    loser_ids := rec.ids[2:];

    -- Merge phone
    UPDATE contacts SET contact_phone = sub.contact_phone
    FROM (SELECT contact_phone FROM contacts WHERE contact_id = ANY(loser_ids) AND contact_phone IS NOT NULL LIMIT 1) sub
    WHERE contacts.contact_id = winner_id AND contacts.contact_phone IS NULL;

    -- Merge company
    UPDATE contacts SET company = sub.company
    FROM (SELECT company FROM contacts WHERE contact_id = ANY(loser_ids) AND company IS NOT NULL LIMIT 1) sub
    WHERE contacts.contact_id = winner_id AND contacts.company IS NULL;

    -- Merge true_owner_id
    UPDATE contacts SET true_owner_id = sub.true_owner_id
    FROM (SELECT true_owner_id FROM contacts WHERE contact_id = ANY(loser_ids) AND true_owner_id IS NOT NULL LIMIT 1) sub
    WHERE contacts.contact_id = winner_id AND contacts.true_owner_id IS NULL;

    -- Merge recorded_owner_id
    UPDATE contacts SET recorded_owner_id = sub.recorded_owner_id
    FROM (SELECT recorded_owner_id FROM contacts WHERE contact_id = ANY(loser_ids) AND recorded_owner_id IS NOT NULL LIMIT 1) sub
    WHERE contacts.contact_id = winner_id AND contacts.recorded_owner_id IS NULL;

    -- Merge website
    UPDATE contacts SET website = sub.website
    FROM (SELECT website FROM contacts WHERE contact_id = ANY(loser_ids) AND website IS NOT NULL LIMIT 1) sub
    WHERE contacts.contact_id = winner_id AND contacts.website IS NULL;

    -- Re-point ALL FK references before delete
    UPDATE true_owners         SET contact_id = winner_id WHERE contact_id = ANY(loser_ids);
    UPDATE recorded_owners     SET contact_id = winner_id WHERE contact_id = ANY(loser_ids);
    UPDATE contact_links       SET contact_id = winner_id WHERE contact_id = ANY(loser_ids);
    UPDATE user_interactions   SET contact_id = winner_id WHERE contact_id = ANY(loser_ids);
    UPDATE touchpoint_schedule SET contact_id = winner_id WHERE contact_id = ANY(loser_ids);
    UPDATE call_outcomes       SET contact_id = winner_id WHERE contact_id = ANY(loser_ids);
    UPDATE brokers             SET contact_id = winner_id WHERE contact_id = ANY(loser_ids);
    UPDATE lenders             SET contact_id = winner_id WHERE contact_id = ANY(loser_ids);
    UPDATE guarantors          SET contact_id = winner_id WHERE contact_id = ANY(loser_ids);

    -- Delete losers
    DELETE FROM contacts WHERE contact_id = ANY(loser_ids);
  END LOOP;
END $$;

DROP TABLE IF EXISTS _contact_dupes;


-- ── 8. Auto-link trigger ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION trg_contact_auto_link()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_true_owner_id UUID;
  v_rec_owner_id  UUID;
BEGIN
  -- Compute normalized name
  NEW.normalized_name := normalize_entity_name(NEW.contact_name);
  NEW.updated_at := now();

  -- Only auto-link for owner/buyer/seller roles
  IF NEW.role IS NULL OR NEW.role NOT IN ('owner', 'buyer', 'seller') THEN
    RETURN NEW;
  END IF;

  -- Match true_owner
  IF NEW.true_owner_id IS NULL AND NEW.normalized_name IS NOT NULL AND NEW.normalized_name != '' THEN
    SELECT t.true_owner_id INTO v_true_owner_id
    FROM true_owners t
    WHERE normalize_entity_name(t.name) = NEW.normalized_name
    LIMIT 1;

    IF v_true_owner_id IS NOT NULL THEN
      NEW.true_owner_id := v_true_owner_id;
      UPDATE true_owners SET contact_id = NEW.contact_id
      WHERE true_owner_id = v_true_owner_id AND contact_id IS NULL;
    END IF;
  END IF;

  -- Match recorded_owner
  IF NEW.recorded_owner_id IS NULL AND NEW.normalized_name IS NOT NULL AND NEW.normalized_name != '' THEN
    SELECT r.recorded_owner_id INTO v_rec_owner_id
    FROM recorded_owners r
    WHERE normalize_entity_name(r.name) = NEW.normalized_name
    LIMIT 1;

    IF v_rec_owner_id IS NOT NULL THEN
      NEW.recorded_owner_id := v_rec_owner_id;
      UPDATE recorded_owners SET contact_id = NEW.contact_id
      WHERE recorded_owner_id = v_rec_owner_id AND contact_id IS NULL;
    END IF;
  END IF;

  -- Link to property
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


-- ── 9. Prospecting view ─────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_contact_cards AS
SELECT
  c.contact_id,
  c.contact_name,
  c.contact_email,
  c.contact_phone,
  c.company,
  c.role,
  c.website,
  c.address,
  c.city,
  c.state,
  c.data_source,
  c.true_owner_id,
  t.name            AS true_owner_name,
  c.recorded_owner_id,
  r.name            AS recorded_owner_name,
  c.property_id,
  p.address          AS property_address,
  p.city             AS property_city,
  p.state            AS property_state,
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


-- ── 10. Maintenance function ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION maintain_contact_links()
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_linked_true INT := 0;
  v_linked_rec  INT := 0;
  v_normalized  INT := 0;
BEGIN
  UPDATE contacts SET normalized_name = normalize_entity_name(contact_name)
  WHERE normalized_name IS NULL AND contact_name IS NOT NULL;
  GET DIAGNOSTICS v_normalized = ROW_COUNT;

  UPDATE contacts c SET true_owner_id = t.true_owner_id
  FROM true_owners t
  WHERE c.true_owner_id IS NULL AND c.role IN ('owner','buyer','seller')
    AND c.normalized_name IS NOT NULL AND normalize_entity_name(t.name) = c.normalized_name;
  GET DIAGNOSTICS v_linked_true = ROW_COUNT;

  UPDATE contacts c SET recorded_owner_id = r.recorded_owner_id
  FROM recorded_owners r
  WHERE c.recorded_owner_id IS NULL AND c.role IN ('owner','buyer','seller')
    AND c.normalized_name IS NOT NULL AND normalize_entity_name(r.name) = c.normalized_name;
  GET DIAGNOSTICS v_linked_rec = ROW_COUNT;

  UPDATE true_owners t SET contact_id = (
    SELECT c.contact_id FROM contacts c WHERE c.true_owner_id = t.true_owner_id
    ORDER BY (c.contact_email IS NOT NULL)::int DESC, c.updated_at DESC NULLS LAST LIMIT 1
  ) WHERE t.contact_id IS NULL
    AND EXISTS (SELECT 1 FROM contacts c WHERE c.true_owner_id = t.true_owner_id);

  UPDATE recorded_owners r SET contact_id = (
    SELECT c.contact_id FROM contacts c WHERE c.recorded_owner_id = r.recorded_owner_id
    ORDER BY (c.contact_email IS NOT NULL)::int DESC, c.updated_at DESC NULLS LAST LIMIT 1
  ) WHERE r.contact_id IS NULL
    AND EXISTS (SELECT 1 FROM contacts c WHERE c.recorded_owner_id = r.recorded_owner_id);

  UPDATE contacts c SET property_id = p.property_id
  FROM properties p
  WHERE c.property_id IS NULL AND c.true_owner_id IS NOT NULL AND p.true_owner_id = c.true_owner_id;

  RETURN jsonb_build_object('normalized', v_normalized, 'linked_true_owners', v_linked_true,
    'linked_recorded_owners', v_linked_rec, 'timestamp', now());
END $$;

-- ── Verify ──────────────────────────────────────────────────────────────────
-- SELECT count(*) FROM contacts WHERE true_owner_id IS NOT NULL;
-- SELECT count(*) FROM contacts WHERE recorded_owner_id IS NOT NULL;
-- SELECT count(*) FROM true_owners WHERE contact_id IS NOT NULL;
-- SELECT * FROM v_contact_cards WHERE contact_email IS NOT NULL LIMIT 20;
-- SELECT maintain_contact_links();
