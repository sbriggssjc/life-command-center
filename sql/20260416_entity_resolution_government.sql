-- ============================================================================
-- Entity Resolution: Fuzzy Matching + Alias Learning — GOVERNMENT DATABASE
-- 2026-04-16
-- ============================================================================
-- Depends on: 20260416_contact_owner_linkage_government.sql (normalize_entity_name)
-- Requires: pg_trgm extension (already installed)
-- Uses existing: contact_aliases table (alias_id, canonical_contact_id,
--   alias_name, canonical_name, created_at)
-- Column mapping: contact_id PK, name, email, phone, contact_type, canonical_name
-- true_owners/recorded_owners: canonical_name column, contact_info JSONB
-- ============================================================================

-- ── 1. Staging table for match candidates ───────────────────────────────────

CREATE TABLE IF NOT EXISTS entity_match_candidates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_table    TEXT NOT NULL,
  source_id       UUID NOT NULL,
  source_name     TEXT NOT NULL,
  target_table    TEXT NOT NULL,
  target_id       UUID NOT NULL,
  target_name     TEXT NOT NULL,
  match_method    TEXT NOT NULL,
  similarity      NUMERIC NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending_review',
  resolved_by     TEXT,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_emc_source_target
  ON entity_match_candidates (source_table, source_id, target_table, target_id);
CREATE INDEX IF NOT EXISTS idx_emc_status
  ON entity_match_candidates (status) WHERE status = 'pending_review';


-- ── 2. Extend contact_aliases with source tracking ──────────────────────────

ALTER TABLE contact_aliases ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE contact_aliases ADD COLUMN IF NOT EXISTS match_method TEXT;
ALTER TABLE contact_aliases ADD COLUMN IF NOT EXISTS entity_table TEXT;
ALTER TABLE contact_aliases ADD COLUMN IF NOT EXISTS entity_id UUID;


-- ── 3. Trigram GIN indexes ──────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_contacts_trgm
  ON contacts USING gin (normalized_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_true_owners_trgm
  ON true_owners USING gin (canonical_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_rec_owners_trgm
  ON recorded_owners USING gin (canonical_name gin_trgm_ops);


-- ── 4. Seed contact_aliases from existing confirmed links ───────────────────

-- 4a. contacts ↔ true_owners: where names differ after normalization
INSERT INTO contact_aliases (canonical_contact_id, alias_name, canonical_name, source, entity_table, entity_id)
SELECT DISTINCT
  c.contact_id,
  normalize_entity_name(t.name),      -- the true_owner name is the alias
  c.normalized_name,                   -- the contact name is canonical (it's in the contact record)
  'seed_from_link',
  'true_owners',
  t.true_owner_id
FROM contacts c
JOIN true_owners t ON t.true_owner_id = c.true_owner_id
WHERE c.true_owner_id IS NOT NULL
  AND c.normalized_name IS NOT NULL AND c.normalized_name != ''
  AND normalize_entity_name(t.name) != ''
  AND c.normalized_name != normalize_entity_name(t.name)
ON CONFLICT DO NOTHING;

-- 4b. contacts ↔ recorded_owners: where names differ
INSERT INTO contact_aliases (canonical_contact_id, alias_name, canonical_name, source, entity_table, entity_id)
SELECT DISTINCT
  c.contact_id,
  normalize_entity_name(r.name),
  c.normalized_name,
  'seed_from_link',
  'recorded_owners',
  r.recorded_owner_id
FROM contacts c
JOIN recorded_owners r ON r.recorded_owner_id = c.recorded_owner_id
WHERE c.recorded_owner_id IS NOT NULL
  AND c.normalized_name IS NOT NULL AND c.normalized_name != ''
  AND normalize_entity_name(r.name) != ''
  AND c.normalized_name != normalize_entity_name(r.name)
ON CONFLICT DO NOTHING;

-- 4c. true_owners ↔ recorded_owners: via shared property linkage
INSERT INTO contact_aliases (canonical_contact_id, alias_name, canonical_name, source, entity_table, entity_id)
SELECT DISTINCT
  t.contact_id,
  normalize_entity_name(r.name),
  normalize_entity_name(t.name),
  'seed_from_link',
  'true_owners',
  t.true_owner_id
FROM true_owners t
JOIN properties p ON p.true_owner_id = t.true_owner_id
JOIN recorded_owners r ON r.recorded_owner_id = p.recorded_owner_id
WHERE t.contact_id IS NOT NULL
  AND normalize_entity_name(t.name) != normalize_entity_name(r.name)
  AND normalize_entity_name(t.name) != ''
  AND normalize_entity_name(r.name) != ''
ON CONFLICT DO NOTHING;


-- ── 5. Main resolver function ───────────────────────────────────────────────
-- NOTE: Gov tables are large (8k contacts × 14k recorded_owners). Trigram
-- cross-joins timeout within Supabase's statement limit. This function does
-- alias-based linking + back-links only (fast). Heavy trigram matching is
-- run manually via ad-hoc SQL with SET pg_trgm.similarity_threshold = 0.6
-- and batch LIMITs.

CREATE OR REPLACE FUNCTION resolve_entity_matches()
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_alias_links   INT := 0;
  v_aliases_total INT := 0;
  rec             RECORD;
BEGIN
  -- Phase 1: Alias-based linking (indexed, fast)
  FOR rec IN
    SELECT c.contact_id, a.entity_id AS owner_id
    FROM contacts c
    JOIN contact_aliases a ON a.alias_name = c.normalized_name AND a.entity_table = 'true_owners'
    WHERE c.true_owner_id IS NULL AND c.normalized_name IS NOT NULL AND c.normalized_name != '' AND a.entity_id IS NOT NULL
    LIMIT 500
  LOOP
    UPDATE contacts SET true_owner_id = rec.owner_id WHERE contact_id = rec.contact_id;
    v_alias_links := v_alias_links + 1;
  END LOOP;

  FOR rec IN
    SELECT c.contact_id, a.entity_id AS owner_id
    FROM contacts c
    JOIN contact_aliases a ON a.alias_name = c.normalized_name AND a.entity_table = 'recorded_owners'
    WHERE c.recorded_owner_id IS NULL AND c.normalized_name IS NOT NULL AND c.normalized_name != '' AND a.entity_id IS NOT NULL
    LIMIT 500
  LOOP
    UPDATE contacts SET recorded_owner_id = rec.owner_id WHERE contact_id = rec.contact_id;
    v_alias_links := v_alias_links + 1;
  END LOOP;

  -- Phase 2: Back-links + property chain
  UPDATE true_owners t SET contact_id = (
    SELECT c.contact_id FROM contacts c WHERE c.true_owner_id = t.true_owner_id
    ORDER BY (c.email IS NOT NULL)::int DESC, c.updated_at DESC NULLS LAST LIMIT 1
  ) WHERE t.contact_id IS NULL AND EXISTS (SELECT 1 FROM contacts c WHERE c.true_owner_id = t.true_owner_id);

  UPDATE recorded_owners r SET contact_id = (
    SELECT c.contact_id FROM contacts c WHERE c.recorded_owner_id = r.recorded_owner_id
    ORDER BY (c.email IS NOT NULL)::int DESC, c.updated_at DESC NULLS LAST LIMIT 1
  ) WHERE r.contact_id IS NULL AND EXISTS (SELECT 1 FROM contacts c WHERE c.recorded_owner_id = r.recorded_owner_id);

  UPDATE contacts c SET property_id = p.property_id
  FROM properties p WHERE c.property_id IS NULL AND c.true_owner_id IS NOT NULL AND p.true_owner_id = c.true_owner_id;

  SELECT count(*) INTO v_aliases_total FROM contact_aliases;

  RETURN jsonb_build_object(
    'alias_links', v_alias_links, 'total_aliases', v_aliases_total, 'timestamp', now());
END $$;


-- ── 6. Updated trigger with alias awareness ─────────────────────────────────

CREATE OR REPLACE FUNCTION trg_contact_auto_link()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_true_owner_id UUID;
  v_rec_owner_id  UUID;
BEGIN
  NEW.normalized_name := normalize_entity_name(NEW.name);
  NEW.updated_at := now();

  -- Step 1: Alias lookup for true_owner
  IF NEW.true_owner_id IS NULL AND NEW.normalized_name IS NOT NULL AND NEW.normalized_name != '' THEN
    SELECT a.entity_id INTO v_true_owner_id
    FROM contact_aliases a
    WHERE a.alias_name = NEW.normalized_name AND a.entity_table = 'true_owners' AND a.entity_id IS NOT NULL
    LIMIT 1;
    IF v_true_owner_id IS NOT NULL THEN
      NEW.true_owner_id := v_true_owner_id;
      UPDATE true_owners SET contact_id = NEW.contact_id
      WHERE true_owner_id = v_true_owner_id AND contact_id IS NULL;
    END IF;
  END IF;

  -- Step 2: Exact normalized name match for true_owner
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

  -- Step 3: Alias lookup for recorded_owner
  IF NEW.recorded_owner_id IS NULL AND NEW.normalized_name IS NOT NULL AND NEW.normalized_name != '' THEN
    SELECT a.entity_id INTO v_rec_owner_id
    FROM contact_aliases a
    WHERE a.alias_name = NEW.normalized_name AND a.entity_table = 'recorded_owners' AND a.entity_id IS NOT NULL
    LIMIT 1;
    IF v_rec_owner_id IS NOT NULL THEN
      NEW.recorded_owner_id := v_rec_owner_id;
      UPDATE recorded_owners SET contact_id = NEW.contact_id
      WHERE recorded_owner_id = v_rec_owner_id AND contact_id IS NULL;
    END IF;
  END IF;

  -- Step 4: Exact normalized name match for recorded_owner
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

  -- Step 5: Link to property
  IF NEW.property_id IS NULL AND NEW.true_owner_id IS NOT NULL THEN
    SELECT p.property_id INTO NEW.property_id
    FROM properties p WHERE p.true_owner_id = NEW.true_owner_id LIMIT 1;
  END IF;

  RETURN NEW;
END $$;


-- ── 7. Updated maintenance function ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION maintain_contact_links()
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_normalized  INT := 0;
  v_resolver    JSONB;
BEGIN
  UPDATE contacts SET normalized_name = normalize_entity_name(name)
  WHERE normalized_name IS NULL AND name IS NOT NULL;
  GET DIAGNOSTICS v_normalized = ROW_COUNT;

  -- Reverse backfill
  UPDATE contacts c SET true_owner_id = t.true_owner_id
  FROM true_owners t
  WHERE t.contact_id = c.contact_id AND c.true_owner_id IS NULL;

  SELECT resolve_entity_matches() INTO v_resolver;

  RETURN jsonb_build_object(
    'normalized', v_normalized,
    'resolver', v_resolver,
    'timestamp', now()
  );
END $$;


-- ── 8. Review queue view ────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_match_review_queue AS
SELECT
  emc.id,
  emc.source_name,
  emc.target_name,
  emc.match_method,
  emc.similarity,
  emc.source_table,
  emc.target_table,
  emc.source_id,
  emc.target_id,
  emc.created_at
FROM entity_match_candidates emc
WHERE emc.status = 'pending_review'
ORDER BY emc.similarity DESC;


-- ── Verify ──────────────────────────────────────────────────────────────────
-- SELECT count(*) FROM contact_aliases;
-- SELECT resolve_entity_matches();
-- SELECT * FROM v_match_review_queue LIMIT 20;
-- SELECT maintain_contact_links();
