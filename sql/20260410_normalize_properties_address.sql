-- Normalize properties.address to collapse abbreviation variants
-- ("Street" vs "St", "Road" vs "Rd", "Avenue" vs "Ave") so the upsert
-- lookup in sidebar-pipeline.js::upsertDomainProperty() stops creating
-- a new row every time CoStar spells a street type differently from
-- the existing CMS-sourced record.
--
-- Mirrors the normalizeAddress() function in api/_shared/entity-link.js.
--
-- Run as a one-off against BOTH domain Supabase projects:
--   * dialysis (properties has medicare_id / lease fields)
--   * government (properties has lease fields, no medicare_id)
--
-- =====================================================================
-- HOW TO RUN
-- =====================================================================
--
-- This file is split into FOUR independent transactions (Parts 1–4)
-- plus an optional Part 5 so each piece can be run individually in
-- the Supabase SQL editor if the full script exceeds the upstream
-- HTTP timeout.
--
-- Fastest path — run the whole file via psql, which has no HTTP
-- timeout:
--
--   psql "<pooler connection string>" \
--     -f sql/20260410_normalize_properties_address.sql
--
-- SQL-editor path — select and run each Part's BEGIN..COMMIT block
-- individually, in order. State flows between parts through a
-- regular table `lcc_dedup_pairs` that Part 1 creates and Part 5
-- drops. If you need to abort, re-enable user triggers on every
-- affected table (Part 2 and Part 3 disable them per-transaction
-- and re-enable at the end, so an aborted transaction auto-rolls
-- back the DDL).
--
-- Idempotent: every Part is safe to re-run. Part 1 recreates the
-- function + lcc_dedup_pairs from scratch. Part 4 leaves no state.
-- =====================================================================


-- =====================================================================
-- PART 1: normalize_address_txt function + lcc_dedup_pairs state table
-- =====================================================================
BEGIN;
SET LOCAL statement_timeout = 0;

-- LANGUAGE sql (not plpgsql) so the planner can inline the regexp
-- chain into the INSERT INTO lcc_dedup_pairs scan and the Part 4
-- address rewrite, avoiding per-row plpgsql call overhead on what
-- is otherwise a full properties scan.
CREATE OR REPLACE FUNCTION normalize_address_txt(addr text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT CASE
    WHEN addr IS NULL THEN ''
    ELSE lower(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
      regexp_replace(
        btrim(addr),
        '\mStreet\M',    'St',   'gi'),
        '\mAvenue\M',    'Ave',  'gi'),
        '\mBoulevard\M', 'Blvd', 'gi'),
        '\mDrive\M',     'Dr',   'gi'),
        '\mRoad\M',      'Rd',   'gi'),
        '\mLane\M',      'Ln',   'gi'),
        '\mCourt\M',     'Ct',   'gi'),
        '\mPlace\M',     'Pl',   'gi'),
        '\mHighway\M',   'Hwy',  'gi'),
        '\mParkway\M',   'Pkwy', 'gi'),
        '\mCircle\M',    'Cir',  'gi'),
        '\mTrail\M',     'Trl',  'gi'),
        '\s+',           ' ',    'g')
    )
  END
$fn$;

-- Regular table (not TEMP) so state persists between the Part 1–4
-- transactions. Part 5 drops it.
DROP TABLE IF EXISTS lcc_dedup_pairs;
CREATE TABLE lcc_dedup_pairs (
  older_id  text PRIMARY KEY,
  target_id text NOT NULL
);

-- For each (normalized_address, lower(city), state) bucket with more
-- than one row, keep the most-recently-updated property (the CoStar
-- sidebar ingest) and emit one row per older → target pair.
INSERT INTO lcc_dedup_pairs (older_id, target_id)
SELECT grp.ids[k], grp.ids[1]
  FROM (
    SELECT array_agg(property_id::text
                     ORDER BY updated_at DESC NULLS LAST) AS ids
      FROM properties
     WHERE address IS NOT NULL
       AND city    IS NOT NULL
     GROUP BY normalize_address_txt(address), lower(city), state
    HAVING count(*) > 1
  ) grp
  CROSS JOIN LATERAL generate_series(2, array_length(grp.ids, 1)) AS k;

COMMIT;


-- =====================================================================
-- PART 2: Merge medicare_id / lease fields from olders into targets
-- =====================================================================
-- Touches only the properties table — fast (O(|lcc_dedup_pairs|) PK
-- lookups). Safe to re-run; every UPDATE guards on tgt.<col> IS NULL.
-- =====================================================================
BEGIN;
SET LOCAL statement_timeout = 0;

DO $part2$
DECLARE
  properties_pk_type text;
  has_medicare       boolean;
  has_lease_exp      boolean;
  has_lease_com      boolean;
  has_annual_rent    boolean;
BEGIN
  IF (SELECT count(*) FROM lcc_dedup_pairs) = 0 THEN
    RETURN;
  END IF;

  SELECT format_type(a.atttypid, a.atttypmod)
    INTO properties_pk_type
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname   = 'public'
     AND c.relname   = 'properties'
     AND a.attname   = 'property_id'
     AND NOT a.attisdropped;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'properties' AND column_name = 'medicare_id'
  ) INTO has_medicare;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'properties' AND column_name = 'lease_expiration'
  ) INTO has_lease_exp;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'properties' AND column_name = 'lease_commencement'
  ) INTO has_lease_com;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'properties' AND column_name = 'annual_rent'
  ) INTO has_annual_rent;

  -- Disable user triggers on properties for the duration of this
  -- transaction so latent trigger bugs (e.g. gov's
  -- propagate_ownership_to_property referencing NEW.ownership_end)
  -- don't block field merges.
  EXECUTE 'ALTER TABLE properties DISABLE TRIGGER USER';

  -- medicare_id has a UNIQUE constraint on dialysis, so we can't
  -- copy it in one UPDATE while the older row still holds the
  -- value. Three-step: capture, clear older, set target.
  IF has_medicare THEN
    DROP TABLE IF EXISTS lcc_merge_medicare;
    EXECUTE format($cte$
      CREATE TEMP TABLE lcc_merge_medicare ON COMMIT DROP AS
      SELECT dp.target_id::%1$s AS target_id, old.medicare_id
        FROM lcc_dedup_pairs dp
        JOIN properties old ON old.property_id = dp.older_id::%1$s
       WHERE old.medicare_id IS NOT NULL
    $cte$, properties_pk_type);

    EXECUTE format($sql$
      UPDATE properties
         SET medicare_id = NULL
       WHERE property_id = ANY(ARRAY(
               SELECT older_id::%1$s FROM lcc_dedup_pairs))
         AND medicare_id IS NOT NULL
    $sql$, properties_pk_type);

    UPDATE properties tgt
       SET medicare_id = mm.medicare_id
      FROM lcc_merge_medicare mm
     WHERE tgt.property_id = mm.target_id
       AND tgt.medicare_id IS NULL;
  END IF;

  IF has_lease_exp THEN
    EXECUTE format($sql$
      UPDATE properties tgt
         SET lease_expiration = old.lease_expiration
        FROM properties old
        JOIN lcc_dedup_pairs dp ON dp.older_id::%1$s = old.property_id
       WHERE tgt.property_id = dp.target_id::%1$s
         AND tgt.lease_expiration IS NULL
         AND old.lease_expiration IS NOT NULL
    $sql$, properties_pk_type);
  END IF;

  IF has_lease_com THEN
    EXECUTE format($sql$
      UPDATE properties tgt
         SET lease_commencement = old.lease_commencement
        FROM properties old
        JOIN lcc_dedup_pairs dp ON dp.older_id::%1$s = old.property_id
       WHERE tgt.property_id = dp.target_id::%1$s
         AND tgt.lease_commencement IS NULL
         AND old.lease_commencement IS NOT NULL
    $sql$, properties_pk_type);
  END IF;

  IF has_annual_rent THEN
    EXECUTE format($sql$
      UPDATE properties tgt
         SET annual_rent = old.annual_rent
        FROM properties old
        JOIN lcc_dedup_pairs dp ON dp.older_id::%1$s = old.property_id
       WHERE tgt.property_id = dp.target_id::%1$s
         AND tgt.annual_rent IS NULL
         AND old.annual_rent IS NOT NULL
    $sql$, properties_pk_type);
  END IF;

  EXECUTE 'ALTER TABLE properties ENABLE TRIGGER USER';
END
$part2$;

COMMIT;


-- =====================================================================
-- PART 3: Repoint FK children from olders to targets
-- =====================================================================
-- The slow part. For each child table that FKs into
-- properties.property_id, use a three-tier strategy:
--
--   Tier 1 — plain batched UPDATE. Runs for every child. For
--            children with no unique-on-FK collisions (the common
--            case), this is the only statement per child.
--   Tier 2 — ranked-partition DELETE per unique non-partial index
--            whose key columns include the FK, then retry the
--            batched UPDATE.
--   Tier 3 — row-level UPDATE + delete-on-conflict. If even the
--            delete is blocked by a grandchild FK, un-pair the
--            older from lcc_dedup_pairs so the Part 4 DELETE FROM
--            properties skips it and the row stays in place.
--
-- If this part still exceeds the upstream HTTP timeout on a very
-- large DB, run it via psql — every other path here assumes one
-- all-at-once pass through the FK children.
-- =====================================================================
BEGIN;
SET LOCAL statement_timeout = 0;

DO $part3$
DECLARE
  fk_tables       text[];
  fk_cols         text[];
  i               integer;
  child_table     text;
  child_fk        text;
  fk_type         text;
  uc              RECORD;
  pos             integer;
  expr            text;
  select_extra    text;
  partition_list  text;
  rec             RECORD;
BEGIN
  IF (SELECT count(*) FROM lcc_dedup_pairs) = 0 THEN
    RETURN;
  END IF;

  -- Discover every child table that has a FK to properties.property_id.
  SELECT array_agg(tc.table_name), array_agg(kcu.column_name)
    INTO fk_tables, fk_cols
    FROM information_schema.table_constraints      tc
    JOIN information_schema.key_column_usage       kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema    = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
     AND ccu.table_schema    = tc.table_schema
   WHERE tc.constraint_type = 'FOREIGN KEY'
     AND tc.table_schema    = 'public'
     AND ccu.table_schema   = 'public'
     AND ccu.table_name     = 'properties'
     AND ccu.column_name    = 'property_id'
     AND tc.table_name     <> 'properties';

  -- Disable user triggers on every FK child so latent trigger bugs
  -- don't block the UPDATEs. These ALTERs live in this transaction
  -- only — rollback reverts them; we re-enable explicitly before
  -- COMMIT on the happy path.
  IF fk_tables IS NOT NULL THEN
    FOR i IN 1 .. array_length(fk_tables, 1)
    LOOP
      EXECUTE format('ALTER TABLE %I DISABLE TRIGGER USER', fk_tables[i]);
    END LOOP;
  END IF;

  IF fk_tables IS NOT NULL THEN
    FOR i IN 1 .. array_length(fk_tables, 1)
    LOOP
      child_table := fk_tables[i];
      child_fk    := fk_cols[i];

      SELECT format_type(a.atttypid, a.atttypmod)
        INTO fk_type
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname   = 'public'
         AND c.relname   = child_table
         AND a.attname   = child_fk
         AND NOT a.attisdropped;

      BEGIN
        -- Tier 1: fast-path batched UPDATE.
        EXECUTE format(
          'UPDATE %1$I AS child '
          '   SET %2$I = dp.target_id::%3$s '
          '  FROM lcc_dedup_pairs dp '
          ' WHERE child.%2$I = dp.older_id::%3$s',
          child_table, child_fk, fk_type
        );
      EXCEPTION WHEN unique_violation OR exclusion_violation THEN
        -- Tier 2: ranked-partition DELETE per unique-on-FK index.
        -- indkey is int2vector; cast via ::text + string_to_array.
        FOR uc IN
          SELECT i3.indexrelid,
                 string_to_array(i3.indkey::text, ' ')::smallint[] AS idx_keys,
                 i3.indnatts            AS natts,
                 (SELECT a.attnum
                    FROM pg_attribute a
                   WHERE a.attrelid = i3.indrelid
                     AND a.attname  = child_fk
                     AND NOT a.attisdropped
                     AND a.attnum > 0) AS fk_attnum
            FROM pg_index i3
            JOIN pg_class  c3 ON c3.oid = i3.indrelid
            JOIN pg_namespace n3 ON n3.oid = c3.relnamespace
           WHERE n3.nspname   = 'public'
             AND c3.relname   = child_table
             AND i3.indisunique
             AND i3.indpred IS NULL
        LOOP
          IF uc.fk_attnum IS NULL
             OR NOT (uc.fk_attnum = ANY(uc.idx_keys)) THEN
            CONTINUE;
          END IF;

          select_extra   := NULL;
          partition_list := NULL;
          FOR pos IN 1 .. uc.natts
          LOOP
            IF uc.idx_keys[pos] = uc.fk_attnum THEN
              CONTINUE;
            END IF;
            expr := pg_get_indexdef(uc.indexrelid, pos, true);
            select_extra := COALESCE(select_extra   || ', ', '')
                            || expr || ' AS _pk_' || pos::text;
            partition_list := COALESCE(partition_list || ', ', '')
                              || '_pk_' || pos::text;
          END LOOP;

          EXECUTE format(
            'WITH involved AS ( '
            '  SELECT c.ctid, '
            '         COALESCE(dp.target_id, c.%1$I::text) AS eff_target, '
            '         (dp.target_id IS NULL) AS is_target_row%2$s '
            '    FROM %3$I c '
            '    LEFT JOIN lcc_dedup_pairs dp '
            '           ON dp.older_id::%5$s = c.%1$I '
            '   WHERE c.%1$I = ANY(ARRAY( '
            '           SELECT older_id::%5$s  FROM lcc_dedup_pairs '
            '           UNION '
            '           SELECT target_id::%5$s FROM lcc_dedup_pairs '
            '         )) '
            '), '
            'ranked AS ( '
            '  SELECT ctid, '
            '         row_number() OVER ( '
            '           PARTITION BY %4$s '
            '           ORDER BY is_target_row DESC, ctid '
            '         ) AS rn '
            '    FROM involved '
            ') '
            'DELETE FROM %3$I '
            ' WHERE ctid IN (SELECT ctid FROM ranked WHERE rn > 1)',
            child_fk,
            CASE WHEN select_extra   IS NULL THEN '' ELSE ', ' || select_extra END,
            child_table,
            CASE WHEN partition_list IS NULL THEN 'eff_target'
                                             ELSE 'eff_target, ' || partition_list END,
            fk_type
          );
        END LOOP;

        BEGIN
          EXECUTE format(
            'UPDATE %1$I AS child '
            '   SET %2$I = dp.target_id::%3$s '
            '  FROM lcc_dedup_pairs dp '
            ' WHERE child.%2$I = dp.older_id::%3$s',
            child_table, child_fk, fk_type
          );
        EXCEPTION WHEN unique_violation OR exclusion_violation THEN
          -- Tier 3: row-level UPDATE + delete-on-conflict + un-pair
          -- on grandchild FK violation. USING parameters kept as
          -- (text, tid) across every outer iteration so the SPI-
          -- cached plan doesn't trip a parameter type mismatch.
          FOR rec IN
            EXECUTE format(
              'SELECT c.ctid        AS child_ctid, '
              '       c.%2$I::text  AS older_id_text, '
              '       dp.target_id  AS new_fk_text '
              '  FROM %1$I c '
              '  JOIN lcc_dedup_pairs dp ON dp.older_id::%3$s = c.%2$I',
              child_table, child_fk, fk_type
            )
          LOOP
            BEGIN
              EXECUTE format(
                'UPDATE %1$I SET %2$I = $1::%3$s WHERE ctid = $2',
                child_table, child_fk, fk_type
              ) USING rec.new_fk_text, rec.child_ctid;
            EXCEPTION WHEN unique_violation OR exclusion_violation THEN
              BEGIN
                EXECUTE format(
                  'DELETE FROM %1$I WHERE ctid = $1',
                  child_table
                ) USING rec.child_ctid;
              EXCEPTION WHEN foreign_key_violation THEN
                DELETE FROM lcc_dedup_pairs
                 WHERE older_id = rec.older_id_text;
              END;
            END;
          END LOOP;
        END;
      END;
    END LOOP;
  END IF;

  -- Re-enable user triggers on every child we disabled.
  IF fk_tables IS NOT NULL THEN
    FOR i IN 1 .. array_length(fk_tables, 1)
    LOOP
      EXECUTE format('ALTER TABLE %I ENABLE TRIGGER USER', fk_tables[i]);
    END LOOP;
  END IF;
END
$part3$;

COMMIT;


-- =====================================================================
-- PART 4: Delete older properties + normalize remaining addresses
-- =====================================================================
-- Also adds the lower(address) index that the runtime lookup uses.
-- The UPDATE is filtered by `address IS DISTINCT FROM
-- normalize_address_txt(address)` so it's a no-op after the first
-- successful run.
-- =====================================================================
BEGIN;
SET LOCAL statement_timeout = 0;

DO $part4$
DECLARE
  properties_pk_type text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod)
    INTO properties_pk_type
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname   = 'public'
     AND c.relname   = 'properties'
     AND a.attname   = 'property_id'
     AND NOT a.attisdropped;

  EXECUTE 'ALTER TABLE properties DISABLE TRIGGER USER';

  EXECUTE format($sql$
    DELETE FROM properties
     WHERE property_id = ANY(ARRAY(
             SELECT older_id::%1$s FROM lcc_dedup_pairs))
  $sql$, properties_pk_type);

  EXECUTE 'ALTER TABLE properties ENABLE TRIGGER USER';
END
$part4$;

-- Rewrite every remaining address to the canonical abbreviated form
-- so the runtime lookup (which normalizes before querying) matches
-- exactly. The WHERE filter makes this a no-op on re-runs.
UPDATE properties
   SET address = normalize_address_txt(address)
 WHERE address IS NOT NULL
   AND address IS DISTINCT FROM normalize_address_txt(address);

CREATE INDEX IF NOT EXISTS idx_properties_address_lower
  ON properties (lower(address));

COMMIT;


-- =====================================================================
-- PART 5: Drop the state table (optional cleanup)
-- =====================================================================
-- Part 1 recreates lcc_dedup_pairs on the next run, so this is just
-- tidy-up. Safe to skip if you want to inspect the pairs post-migration.
-- =====================================================================
BEGIN;
DROP TABLE IF EXISTS lcc_dedup_pairs;
COMMIT;


-- Sanity check (run after Part 5):
--   SELECT normalize_address_txt(address), lower(city), state, count(*)
--     FROM properties
--    WHERE address IS NOT NULL
--    GROUP BY 1, 2, 3 HAVING count(*) > 1;
