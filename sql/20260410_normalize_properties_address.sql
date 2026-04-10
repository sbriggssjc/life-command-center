-- Normalize properties.address to collapse abbreviation variants
-- ("Street" vs "St", "Road" vs "Rd", "Avenue" vs "Ave") so the upsert
-- lookup in sidebar-pipeline.js::upsertDomainProperty() stops creating a
-- new row every time CoStar spells a street type differently from the
-- existing CMS-sourced record.
--
-- Mirrors the normalizeAddress() function in api/_shared/entity-link.js.
--
-- Run as a one-off against BOTH domain Supabase projects:
--   * dialysis (properties has medicare_id / lease fields)
--   * government (properties has lease fields, no medicare_id)
--
-- Medicare/lease merge logic uses information_schema guards so the same
-- file is safe to run against either database. Idempotent.

BEGIN;

-- 1. SQL mirror of normalizeAddress() from api/_shared/entity-link.js.
CREATE OR REPLACE FUNCTION normalize_address_txt(addr text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  s text;
BEGIN
  IF addr IS NULL THEN
    RETURN '';
  END IF;
  s := btrim(addr);
  s := regexp_replace(s, '\mStreet\M',    'St',   'gi');
  s := regexp_replace(s, '\mAvenue\M',    'Ave',  'gi');
  s := regexp_replace(s, '\mBoulevard\M', 'Blvd', 'gi');
  s := regexp_replace(s, '\mDrive\M',     'Dr',   'gi');
  s := regexp_replace(s, '\mRoad\M',      'Rd',   'gi');
  s := regexp_replace(s, '\mLane\M',      'Ln',   'gi');
  s := regexp_replace(s, '\mCourt\M',     'Ct',   'gi');
  s := regexp_replace(s, '\mPlace\M',     'Pl',   'gi');
  s := regexp_replace(s, '\mHighway\M',   'Hwy',  'gi');
  s := regexp_replace(s, '\mParkway\M',   'Pkwy', 'gi');
  s := regexp_replace(s, '\mCircle\M',    'Cir',  'gi');
  s := regexp_replace(s, '\mTrail\M',     'Trl',  'gi');
  s := regexp_replace(s, '\s+',           ' ',    'g');
  RETURN lower(s);
END;
$fn$;

-- 2. Merge duplicate property pairs BEFORE rewriting addresses so that
-- the "older CMS" vs "newer CoStar" identification stays stable.
--
-- For each (normalized_address, lower(city), state) bucket with more than
-- one row, we keep the most-recently-updated property (the CoStar sidebar
-- ingest) and copy the older record's medicare_id / lease fields into the
-- target when the target is missing them. Then we repoint FK tables to
-- the target and delete the older row.
--
-- property_id isn't the same type across domains (government uses bigint,
-- dialysis uses uuid), and dialysis.properties has no created_at column.
-- We work in text so the same DO block runs against either database, then
-- cast property_id::text on both sides of every comparison so PostgreSQL
-- never has to coerce a text literal back into the native id type.
--
-- FK tables that reference properties.property_id are discovered
-- dynamically via information_schema so we automatically repoint
-- things like gsa_leases (government) and sales_transactions
-- (both DBs) without having to hard-code every child table here —
-- and so child tables whose column isn't literally named
-- "property_id" (e.g. dialysis.clinic_financial_estimates) work
-- without a 42703 "column does not exist" error.
--
-- All per-row work is batched via a dup_pairs temp table so the
-- migration runs in a fixed number of set-based statements instead
-- of nested loops — earlier iterations issued
-- N_dups × N_children × several EXECUTE calls each and timed out
-- on dialysis.
--
-- session_replication_role is flipped to 'replica' for the duration
-- of the transaction to bypass a latent bug in the government DB's
-- propagate_ownership_to_property() trigger, which references
-- NEW.ownership_end even though ownership_history doesn't have that
-- column and blows up any UPDATE on ownership_history.
DO $merge$
DECLARE
  fk_tables       text[];
  fk_cols         text[];
  i               integer;
  child_table     text;
  child_fk        text;
  has_medicare    boolean;
  has_lease_exp   boolean;
  has_lease_com   boolean;
  has_annual_rent boolean;
  has_fk_unique   boolean;
  uc              RECORD;
  match_clause    text;
  dup_count       integer;
BEGIN
  -- Disable user triggers for this transaction only.
  PERFORM set_config('session_replication_role', 'replica', true);

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

  -- Column-existence guards so the same file runs on dialysis and government.
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

  -- Build a temp table of (older_id, target_id) pairs so every step
  -- below is a single set-based statement.
  DROP TABLE IF EXISTS dup_pairs;
  CREATE TEMP TABLE dup_pairs (
    older_id  text PRIMARY KEY,
    target_id text NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO dup_pairs (older_id, target_id)
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

  SELECT count(*) INTO dup_count FROM dup_pairs;
  IF dup_count = 0 THEN
    RETURN;
  END IF;

  -- Batch-merge medicare_id / lease fields from older into target.
  IF has_medicare THEN
    UPDATE properties tgt
       SET medicare_id = old.medicare_id
      FROM properties old
      JOIN dup_pairs dp ON dp.older_id = old.property_id::text
     WHERE tgt.property_id::text = dp.target_id
       AND tgt.medicare_id IS NULL
       AND old.medicare_id IS NOT NULL;
  END IF;

  IF has_lease_exp THEN
    UPDATE properties tgt
       SET lease_expiration = old.lease_expiration
      FROM properties old
      JOIN dup_pairs dp ON dp.older_id = old.property_id::text
     WHERE tgt.property_id::text = dp.target_id
       AND tgt.lease_expiration IS NULL
       AND old.lease_expiration IS NOT NULL;
  END IF;

  IF has_lease_com THEN
    UPDATE properties tgt
       SET lease_commencement = old.lease_commencement
      FROM properties old
      JOIN dup_pairs dp ON dp.older_id = old.property_id::text
     WHERE tgt.property_id::text = dp.target_id
       AND tgt.lease_commencement IS NULL
       AND old.lease_commencement IS NOT NULL;
  END IF;

  IF has_annual_rent THEN
    UPDATE properties tgt
       SET annual_rent = old.annual_rent
      FROM properties old
      JOIN dup_pairs dp ON dp.older_id = old.property_id::text
     WHERE tgt.property_id::text = dp.target_id
       AND tgt.annual_rent IS NULL
       AND old.annual_rent IS NOT NULL;
  END IF;

  -- Repoint every discovered FK child. Hybrid strategy:
  --   1. If NO unique/PK index on the child involves the FK column,
  --      do a single batched UPDATE. Surrogate PKs stay put, so
  --      grandchildren (lease_escalations etc.) follow for free.
  --   2. Otherwise, for each unique index that DOES include the FK
  --      column, delete older rows that would collide with a target
  --      row on the non-FK columns, then batch-UPDATE the rest.
  --
  -- Unique-index metadata comes from pg_catalog (not
  -- information_schema) so plain CREATE UNIQUE INDEX entries that
  -- never become pg_constraint rows are still detected.
  IF fk_tables IS NOT NULL THEN
    FOR i IN 1 .. array_length(fk_tables, 1)
    LOOP
      child_table := fk_tables[i];
      child_fk    := fk_cols[i];

      SELECT EXISTS (
        SELECT 1
          FROM pg_index i2
          JOIN pg_class  c2 ON c2.oid = i2.indrelid
          JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
          JOIN pg_attribute a2 ON a2.attrelid = i2.indexrelid
                              AND a2.attnum > 0
                              AND NOT a2.attisdropped
                              AND a2.attname = child_fk
         WHERE n2.nspname   = 'public'
           AND c2.relname   = child_table
           AND i2.indisunique
           AND i2.indpred IS NULL
      ) INTO has_fk_unique;

      IF has_fk_unique THEN
        FOR uc IN
          SELECT ARRAY(
                   SELECT a3.attname::text
                     FROM pg_attribute a3
                    WHERE a3.attrelid = i3.indexrelid
                      AND a3.attnum > 0
                      AND NOT a3.attisdropped
                      AND a3.attname NOT LIKE 'pg\_expression\_%'
                    ORDER BY a3.attnum
                 ) AS cols
            FROM pg_index i3
            JOIN pg_class  c3 ON c3.oid = i3.indrelid
            JOIN pg_namespace n3 ON n3.oid = c3.relnamespace
           WHERE n3.nspname   = 'public'
             AND c3.relname   = child_table
             AND i3.indisunique
             AND i3.indpred IS NULL
        LOOP
          IF NOT (child_fk = ANY(uc.cols)) THEN
            CONTINUE;
          END IF;

          SELECT string_agg(
                   format('other.%I = child.%I', c, c),
                   ' AND '
                 )
            INTO match_clause
            FROM unnest(uc.cols) AS c
           WHERE c <> child_fk;

          IF match_clause IS NULL THEN
            EXECUTE format(
              'DELETE FROM %I AS child '
              ' USING dup_pairs dp '
              ' WHERE child.%I::text = dp.older_id '
              '   AND EXISTS ('
              '     SELECT 1 FROM %I AS other '
              '      WHERE other.%I::text = dp.target_id'
              '   )',
              child_table, child_fk, child_table, child_fk
            );
          ELSE
            EXECUTE format(
              'DELETE FROM %I AS child '
              ' USING dup_pairs dp '
              ' WHERE child.%I::text = dp.older_id '
              '   AND EXISTS ('
              '     SELECT 1 FROM %I AS other '
              '      WHERE other.%I::text = dp.target_id '
              '        AND %s'
              '   )',
              child_table, child_fk, child_table, child_fk, match_clause
            );
          END IF;
        END LOOP;
      END IF;

      -- One batched UPDATE per child covers every older→target pair.
      EXECUTE format(
        'UPDATE %I AS child '
        '   SET %I = p.property_id '
        '  FROM properties p '
        '  JOIN dup_pairs dp ON dp.target_id = p.property_id::text '
        ' WHERE child.%I::text = dp.older_id',
        child_table, child_fk, child_fk
      );
    END LOOP;
  END IF;

  -- Finally remove every stale duplicate in one DELETE.
  DELETE FROM properties
   WHERE property_id::text IN (SELECT older_id FROM dup_pairs);
END
$merge$;

-- 3. Rewrite every remaining address to the canonical abbreviated form so
-- the runtime lookup (which now normalizes before querying) matches exactly.
UPDATE properties
   SET address = normalize_address_txt(address)
 WHERE address IS NOT NULL
   AND address IS DISTINCT FROM normalize_address_txt(address);

-- 4. Index supporting the normalized lookup path.
CREATE INDEX IF NOT EXISTS idx_properties_address_lower
  ON properties (lower(address));

COMMIT;

-- Sanity check (run after commit):
--   SELECT normalize_address_txt(address), lower(city), state, count(*)
--     FROM properties
--    WHERE address IS NOT NULL
--    GROUP BY 1, 2, 3 HAVING count(*) > 1;
