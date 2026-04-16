-- ============================================================================
-- Entity Resolution: Fuzzy Matching + Alias Learning — DIALYSIS DATABASE
-- 2026-04-16
-- ============================================================================
-- Depends on: 20260416_contact_owner_linkage_dialysis.sql (normalize_entity_name)
-- Requires: pg_trgm extension (already installed)
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
  match_method    TEXT NOT NULL,      -- 'trigram', 'alias', 'address', 'token_overlap'
  similarity      NUMERIC NOT NULL,   -- 0.0-1.0
  status          TEXT NOT NULL DEFAULT 'pending_review',  -- 'auto_linked','pending_review','accepted','rejected'
  resolved_by     TEXT,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_emc_source_target
  ON entity_match_candidates (source_table, source_id, target_table, target_id);
CREATE INDEX IF NOT EXISTS idx_emc_status
  ON entity_match_candidates (status) WHERE status = 'pending_review';


-- ── 2. Entity name aliases table ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS entity_name_aliases (
  alias_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name  TEXT NOT NULL,
  alias_name      TEXT NOT NULL,
  source          TEXT,               -- 'seed_from_link', 'manual_review', 'auto_high_confidence'
  entity_table    TEXT,               -- 'contacts', 'true_owners', 'recorded_owners'
  entity_id       UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ena_canonical_alias
  ON entity_name_aliases (canonical_name, alias_name);
CREATE INDEX IF NOT EXISTS idx_ena_alias_lookup
  ON entity_name_aliases (alias_name);


-- ── 3. Trigram GIN indexes for fuzzy matching ───────────────────────────────

CREATE INDEX IF NOT EXISTS idx_contacts_trgm
  ON contacts USING gin (normalized_name gin_trgm_ops);

-- For true_owners and recorded_owners, index on normalized_name column
-- (true_owners already has normalized_name; recorded_owners also has it)
CREATE INDEX IF NOT EXISTS idx_true_owners_trgm
  ON true_owners USING gin (normalized_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_rec_owners_trgm
  ON recorded_owners USING gin (normalized_name gin_trgm_ops);


-- ── 4. Seed aliases from existing confirmed links ───────────────────────────

-- 4a. contacts ↔ true_owners: where names differ after normalization
INSERT INTO entity_name_aliases (canonical_name, alias_name, source, entity_table, entity_id)
SELECT DISTINCT
  normalize_entity_name(t.name)         AS canonical_name,
  normalize_entity_name(c.contact_name) AS alias_name,
  'seed_from_link',
  'true_owners',
  t.true_owner_id
FROM contacts c
JOIN true_owners t ON t.true_owner_id = c.true_owner_id
WHERE c.true_owner_id IS NOT NULL
  AND normalize_entity_name(c.contact_name) != normalize_entity_name(t.name)
  AND normalize_entity_name(c.contact_name) != ''
  AND normalize_entity_name(t.name) != ''
ON CONFLICT (canonical_name, alias_name) DO NOTHING;

-- 4b. contacts ↔ recorded_owners: where names differ
INSERT INTO entity_name_aliases (canonical_name, alias_name, source, entity_table, entity_id)
SELECT DISTINCT
  normalize_entity_name(r.name)         AS canonical_name,
  normalize_entity_name(c.contact_name) AS alias_name,
  'seed_from_link',
  'recorded_owners',
  r.recorded_owner_id
FROM contacts c
JOIN recorded_owners r ON r.recorded_owner_id = c.recorded_owner_id
WHERE c.recorded_owner_id IS NOT NULL
  AND normalize_entity_name(c.contact_name) != normalize_entity_name(r.name)
  AND normalize_entity_name(c.contact_name) != ''
  AND normalize_entity_name(r.name) != ''
ON CONFLICT (canonical_name, alias_name) DO NOTHING;

-- 4c. true_owners ↔ recorded_owners: via shared contact_id or property linkage
INSERT INTO entity_name_aliases (canonical_name, alias_name, source, entity_table, entity_id)
SELECT DISTINCT
  normalize_entity_name(t.name) AS canonical_name,
  normalize_entity_name(r.name) AS alias_name,
  'seed_from_link',
  'true_owners',
  t.true_owner_id
FROM true_owners t
JOIN properties p ON p.true_owner_id = t.true_owner_id
JOIN recorded_owners r ON r.recorded_owner_id = p.recorded_owner_id
WHERE normalize_entity_name(t.name) != normalize_entity_name(r.name)
  AND normalize_entity_name(t.name) != ''
  AND normalize_entity_name(r.name) != ''
ON CONFLICT (canonical_name, alias_name) DO NOTHING;


-- ── 5. Main resolver function ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION resolve_entity_matches(
  p_high_threshold NUMERIC DEFAULT 0.85,
  p_low_threshold  NUMERIC DEFAULT 0.5
)
RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  v_alias_links      INT := 0;
  v_auto_links       INT := 0;
  v_candidates       INT := 0;
  v_aliases_seeded   INT := 0;
  v_cross_links      INT := 0;
  rec                RECORD;
BEGIN

  -- ── Phase 1: Alias-based linking ──────────────────────────────────────
  -- For unlinked contacts, check if their normalized name is a known alias

  -- 1a. contacts → true_owners via alias
  FOR rec IN
    SELECT c.contact_id, a.entity_id AS true_owner_id, a.canonical_name
    FROM contacts c
    JOIN entity_name_aliases a
      ON a.alias_name = c.normalized_name AND a.entity_table = 'true_owners'
    WHERE c.true_owner_id IS NULL
      AND c.normalized_name IS NOT NULL AND c.normalized_name != ''
  LOOP
    UPDATE contacts SET true_owner_id = rec.true_owner_id WHERE contact_id = rec.contact_id;
    v_alias_links := v_alias_links + 1;
  END LOOP;

  -- 1b. contacts → recorded_owners via alias
  FOR rec IN
    SELECT c.contact_id, a.entity_id AS recorded_owner_id
    FROM contacts c
    JOIN entity_name_aliases a
      ON a.alias_name = c.normalized_name AND a.entity_table = 'recorded_owners'
    WHERE c.recorded_owner_id IS NULL
      AND c.normalized_name IS NOT NULL AND c.normalized_name != ''
  LOOP
    UPDATE contacts SET recorded_owner_id = rec.recorded_owner_id WHERE contact_id = rec.contact_id;
    v_alias_links := v_alias_links + 1;
  END LOOP;

  -- ── Phase 2: High-confidence trigram auto-linking ─────────────────────
  -- contacts ↔ true_owners with similarity > threshold

  FOR rec IN
    SELECT c.contact_id, c.contact_name, c.normalized_name AS c_norm,
           t.true_owner_id, t.name AS t_name,
           similarity(c.normalized_name, t.normalized_name) AS sim
    FROM contacts c
    JOIN true_owners t
      ON c.normalized_name % t.normalized_name
    WHERE c.true_owner_id IS NULL
      AND c.normalized_name IS NOT NULL AND c.normalized_name != ''
      AND t.normalized_name IS NOT NULL AND t.normalized_name != ''
      AND similarity(c.normalized_name, t.normalized_name) > p_high_threshold
    ORDER BY sim DESC
  LOOP
    -- Auto-link
    UPDATE contacts SET true_owner_id = rec.true_owner_id
    WHERE contact_id = rec.contact_id AND true_owner_id IS NULL;

    -- Record alias for future use
    INSERT INTO entity_name_aliases (canonical_name, alias_name, source, entity_table, entity_id)
    VALUES (normalize_entity_name(rec.t_name), rec.c_norm, 'auto_high_confidence', 'true_owners', rec.true_owner_id)
    ON CONFLICT (canonical_name, alias_name) DO NOTHING;

    -- Log to candidates
    INSERT INTO entity_match_candidates (source_table, source_id, source_name, target_table, target_id, target_name, match_method, similarity, status, resolved_by, resolved_at)
    VALUES ('contacts', rec.contact_id, rec.contact_name, 'true_owners', rec.true_owner_id, rec.t_name, 'trigram', rec.sim, 'auto_linked', 'system', now())
    ON CONFLICT (source_table, source_id, target_table, target_id) DO NOTHING;

    v_auto_links := v_auto_links + 1;
  END LOOP;

  -- contacts ↔ recorded_owners high-confidence
  FOR rec IN
    SELECT c.contact_id, c.contact_name, c.normalized_name AS c_norm,
           r.recorded_owner_id, r.name AS r_name,
           similarity(c.normalized_name, normalize_entity_name(r.name)) AS sim
    FROM contacts c
    JOIN recorded_owners r
      ON c.normalized_name % normalize_entity_name(r.name)
    WHERE c.recorded_owner_id IS NULL
      AND c.normalized_name IS NOT NULL AND c.normalized_name != ''
      AND r.name IS NOT NULL
      AND similarity(c.normalized_name, normalize_entity_name(r.name)) > p_high_threshold
    ORDER BY sim DESC
  LOOP
    UPDATE contacts SET recorded_owner_id = rec.recorded_owner_id
    WHERE contact_id = rec.contact_id AND recorded_owner_id IS NULL;

    INSERT INTO entity_name_aliases (canonical_name, alias_name, source, entity_table, entity_id)
    VALUES (normalize_entity_name(rec.r_name), rec.c_norm, 'auto_high_confidence', 'recorded_owners', rec.recorded_owner_id)
    ON CONFLICT (canonical_name, alias_name) DO NOTHING;

    INSERT INTO entity_match_candidates (source_table, source_id, source_name, target_table, target_id, target_name, match_method, similarity, status, resolved_by, resolved_at)
    VALUES ('contacts', rec.contact_id, rec.contact_name, 'recorded_owners', rec.recorded_owner_id, rec.r_name, 'trigram', rec.sim, 'auto_linked', 'system', now())
    ON CONFLICT (source_table, source_id, target_table, target_id) DO NOTHING;

    v_auto_links := v_auto_links + 1;
  END LOOP;

  -- ── Phase 3: Medium-confidence candidates (stage for review) ──────────

  -- contacts ↔ true_owners medium confidence
  INSERT INTO entity_match_candidates (source_table, source_id, source_name, target_table, target_id, target_name, match_method, similarity, status)
  SELECT DISTINCT ON (c.contact_id)
    'contacts', c.contact_id, c.contact_name,
    'true_owners', t.true_owner_id, t.name,
    'trigram',
    similarity(c.normalized_name, t.normalized_name),
    'pending_review'
  FROM contacts c
  JOIN true_owners t
    ON c.normalized_name % t.normalized_name
  WHERE c.true_owner_id IS NULL
    AND c.normalized_name IS NOT NULL AND c.normalized_name != ''
    AND t.normalized_name IS NOT NULL AND t.normalized_name != ''
    AND similarity(c.normalized_name, t.normalized_name) BETWEEN p_low_threshold AND p_high_threshold
  ORDER BY c.contact_id, similarity(c.normalized_name, t.normalized_name) DESC
  ON CONFLICT (source_table, source_id, target_table, target_id) DO NOTHING;
  GET DIAGNOSTICS v_candidates = ROW_COUNT;

  -- contacts ↔ recorded_owners medium confidence
  INSERT INTO entity_match_candidates (source_table, source_id, source_name, target_table, target_id, target_name, match_method, similarity, status)
  SELECT DISTINCT ON (c.contact_id)
    'contacts', c.contact_id, c.contact_name,
    'recorded_owners', r.recorded_owner_id, r.name,
    'trigram',
    similarity(c.normalized_name, normalize_entity_name(r.name)),
    'pending_review'
  FROM contacts c
  JOIN recorded_owners r
    ON c.normalized_name % normalize_entity_name(r.name)
  WHERE c.recorded_owner_id IS NULL
    AND c.normalized_name IS NOT NULL AND c.normalized_name != ''
    AND r.name IS NOT NULL
    AND similarity(c.normalized_name, normalize_entity_name(r.name)) BETWEEN p_low_threshold AND p_high_threshold
  ORDER BY c.contact_id, similarity(c.normalized_name, normalize_entity_name(r.name)) DESC
  ON CONFLICT (source_table, source_id, target_table, target_id) DO NOTHING;
  GET DIAGNOSTICS v_cross_links = ROW_COUNT;
  v_candidates := v_candidates + v_cross_links;

  -- ── Phase 4: Cross-table matching (true_owners ↔ recorded_owners) ─────

  INSERT INTO entity_match_candidates (source_table, source_id, source_name, target_table, target_id, target_name, match_method, similarity, status)
  SELECT DISTINCT ON (t.true_owner_id)
    'true_owners', t.true_owner_id, t.name,
    'recorded_owners', r.recorded_owner_id, r.name,
    'trigram',
    similarity(t.normalized_name, normalize_entity_name(r.name)),
    CASE WHEN similarity(t.normalized_name, normalize_entity_name(r.name)) > p_high_threshold
         THEN 'auto_linked' ELSE 'pending_review' END
  FROM true_owners t
  JOIN recorded_owners r
    ON t.normalized_name % normalize_entity_name(r.name)
  WHERE t.normalized_name IS NOT NULL AND t.normalized_name != ''
    AND r.name IS NOT NULL
    AND similarity(t.normalized_name, normalize_entity_name(r.name)) > p_low_threshold
    -- Skip if already linked through properties
    AND NOT EXISTS (
      SELECT 1 FROM properties p
      WHERE p.true_owner_id = t.true_owner_id AND p.recorded_owner_id = r.recorded_owner_id
    )
  ORDER BY t.true_owner_id, similarity(t.normalized_name, normalize_entity_name(r.name)) DESC
  ON CONFLICT (source_table, source_id, target_table, target_id) DO NOTHING;

  -- ── Phase 5: Back-link maintenance ────────────────────────────────────

  -- true_owners.contact_id
  UPDATE true_owners t SET contact_id = (
    SELECT c.contact_id FROM contacts c WHERE c.true_owner_id = t.true_owner_id
    ORDER BY (c.contact_email IS NOT NULL)::int DESC, c.updated_at DESC NULLS LAST LIMIT 1
  ) WHERE t.contact_id IS NULL
    AND EXISTS (SELECT 1 FROM contacts c WHERE c.true_owner_id = t.true_owner_id);

  -- recorded_owners.contact_id
  UPDATE recorded_owners r SET contact_id = (
    SELECT c.contact_id FROM contacts c WHERE c.recorded_owner_id = r.recorded_owner_id
    ORDER BY (c.contact_email IS NOT NULL)::int DESC, c.updated_at DESC NULLS LAST LIMIT 1
  ) WHERE r.contact_id IS NULL
    AND EXISTS (SELECT 1 FROM contacts c WHERE c.recorded_owner_id = r.recorded_owner_id);

  -- contacts → properties
  UPDATE contacts c SET property_id = p.property_id
  FROM properties p
  WHERE c.property_id IS NULL AND c.true_owner_id IS NOT NULL AND p.true_owner_id = c.true_owner_id;

  SELECT count(*) INTO v_aliases_seeded FROM entity_name_aliases;

  RETURN jsonb_build_object(
    'alias_links', v_alias_links,
    'auto_links', v_auto_links,
    'candidates_staged', v_candidates,
    'total_aliases', v_aliases_seeded,
    'timestamp', now()
  );
END $$;


-- ── 6. Updated trigger with alias awareness ─────────────────────────────────

CREATE OR REPLACE FUNCTION trg_contact_auto_link()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_true_owner_id UUID;
  v_rec_owner_id  UUID;
BEGIN
  NEW.normalized_name := normalize_entity_name(NEW.contact_name);
  NEW.updated_at := now();

  -- Step 1: Alias lookup for true_owner
  IF NEW.true_owner_id IS NULL AND NEW.normalized_name IS NOT NULL AND NEW.normalized_name != '' THEN
    SELECT a.entity_id INTO v_true_owner_id
    FROM entity_name_aliases a
    WHERE a.alias_name = NEW.normalized_name AND a.entity_table = 'true_owners'
    LIMIT 1;

    IF v_true_owner_id IS NOT NULL THEN
      NEW.true_owner_id := v_true_owner_id;
      UPDATE true_owners SET contact_id = NEW.contact_id
      WHERE true_owner_id = v_true_owner_id AND contact_id IS NULL;
    END IF;
  END IF;

  -- Step 2: Exact normalized name match for true_owner (existing behavior)
  IF NEW.true_owner_id IS NULL AND NEW.normalized_name IS NOT NULL AND NEW.normalized_name != '' THEN
    SELECT t.true_owner_id INTO v_true_owner_id
    FROM true_owners t
    WHERE t.normalized_name = NEW.normalized_name
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
    FROM entity_name_aliases a
    WHERE a.alias_name = NEW.normalized_name AND a.entity_table = 'recorded_owners'
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
  -- Normalize missing names
  UPDATE contacts SET normalized_name = normalize_entity_name(contact_name)
  WHERE normalized_name IS NULL AND contact_name IS NOT NULL;
  GET DIAGNOSTICS v_normalized = ROW_COUNT;

  -- Reverse backfill: true_owners.contact_id → contacts.true_owner_id
  UPDATE contacts c SET true_owner_id = t.true_owner_id
  FROM true_owners t
  WHERE t.contact_id = c.contact_id AND c.true_owner_id IS NULL;

  -- Run full entity resolution (aliases + trigram + staging)
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
-- SELECT count(*) FROM entity_name_aliases;
-- SELECT resolve_entity_matches();
-- SELECT * FROM v_match_review_queue LIMIT 20;
-- SELECT maintain_contact_links();
