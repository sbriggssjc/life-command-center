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
DO $merge$
DECLARE
  dup             RECORD;
  older_id        text;
  target_id       text;
  has_medicare    boolean;
  has_lease_exp   boolean;
  has_lease_com   boolean;
  has_annual_rent boolean;
  fk_tables       text[];
  fk_cols         text[];
  i               integer;
  child_table     text;
  child_fk        text;
  has_fk_unique   boolean;
  uc              RECORD;
  match_clause    text;
BEGIN
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

  FOR dup IN
    SELECT normalize_address_txt(address)                          AS norm_addr,
           lower(city)                                              AS city_key,
           state,
           array_agg(property_id::text ORDER BY updated_at DESC NULLS LAST) AS ids
      FROM properties
     WHERE address IS NOT NULL
       AND city    IS NOT NULL
     GROUP BY normalize_address_txt(address), lower(city), state
    HAVING count(*) > 1
  LOOP
    target_id := dup.ids[1];

    FOREACH older_id IN ARRAY dup.ids[2:array_length(dup.ids, 1)]
    LOOP
      -- Merge medicare_id from older → target when target is missing it.
      IF has_medicare THEN
        EXECUTE $q$
          UPDATE properties tgt
             SET medicare_id = old.medicare_id
            FROM properties old
           WHERE tgt.property_id::text = $1
             AND old.property_id::text = $2
             AND tgt.medicare_id IS NULL
             AND old.medicare_id IS NOT NULL
        $q$ USING target_id, older_id;
      END IF;

      -- Merge lease fields from older → target when target is missing them.
      IF has_lease_exp THEN
        EXECUTE $q$
          UPDATE properties tgt
             SET lease_expiration = old.lease_expiration
            FROM properties old
           WHERE tgt.property_id::text = $1
             AND old.property_id::text = $2
             AND tgt.lease_expiration IS NULL
             AND old.lease_expiration IS NOT NULL
        $q$ USING target_id, older_id;
      END IF;

      IF has_lease_com THEN
        EXECUTE $q$
          UPDATE properties tgt
             SET lease_commencement = old.lease_commencement
            FROM properties old
           WHERE tgt.property_id::text = $1
             AND old.property_id::text = $2
             AND tgt.lease_commencement IS NULL
             AND old.lease_commencement IS NOT NULL
        $q$ USING target_id, older_id;
      END IF;

      IF has_annual_rent THEN
        EXECUTE $q$
          UPDATE properties tgt
             SET annual_rent = old.annual_rent
            FROM properties old
           WHERE tgt.property_id::text = $1
             AND old.property_id::text = $2
             AND tgt.annual_rent IS NULL
             AND old.annual_rent IS NOT NULL
        $q$ USING target_id, older_id;
      END IF;

      -- Repoint every discovered FK child. We use a hybrid strategy so
      -- the same code path handles both leaves-with-unique-on-FK (e.g.
      -- property_embeddings with PK (property_id), cap_rate_history with
      -- UNIQUE (property_id, event_type, event_date)) AND tables with
      -- grandchildren that can't be deleted (e.g. leases, whose rows are
      -- referenced by lease_escalations.lease_id without ON DELETE
      -- CASCADE, so deleting an older lease row errors out with 23503).
      --
      -- Per child:
      --   1. If NO unique/PK constraint on the child involves the FK
      --      column, do a plain UPDATE. Grandchildren follow for free
      --      since we never touch the surrogate PK (lease_id stays,
      --      lease_escalations.lease_id keeps pointing at the same row).
      --   2. Otherwise, for each unique/PK constraint that does include
      --      the FK column, first delete older rows that would collide
      --      with a target row on the constraint's non-FK columns
      --      (target wins). Then UPDATE whatever older rows are left.
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
            -- Per-constraint conflict resolution: delete older rows that
            -- would clash with a target row on the non-FK columns of the
            -- constraint, so the follow-up UPDATE has no collisions.
            --
            -- Queries pg_catalog (not information_schema) so plain
            -- CREATE UNIQUE INDEX entries like
            -- idx_inv_scores_property_unique and
            -- cap_rate_history_property_event_idx — which never get
            -- turned into pg_constraint rows — are still detected.
            FOR uc IN
              SELECT i3.indexrelid::regclass::text AS idx_name,
                     ARRAY(
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
              -- Skip constraints that don't involve the FK column.
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
                -- Constraint is solely (fk_col): any older row collides
                -- with the target's single row. Drop all older rows.
                EXECUTE format(
                  'DELETE FROM %I WHERE %I::text = $1',
                  child_table, child_fk
                ) USING older_id;
              ELSE
                -- Drop older rows that match a target row on the other
                -- constraint columns. Remaining older rows are safe to
                -- repoint.
                EXECUTE format(
                  'DELETE FROM %I AS child '
                  ' WHERE child.%I::text = $1 '
                  '   AND EXISTS ('
                  '     SELECT 1 FROM %I AS other '
                  '      WHERE other.%I::text = $2 '
                  '        AND %s'
                  '   )',
                  child_table, child_fk, child_table, child_fk, match_clause
                ) USING older_id, target_id;
              END IF;
            END LOOP;
          END IF;

          -- Plain repoint: changes only the FK column, so any surrogate
          -- PK stays put and grandchildren follow automatically.
          EXECUTE format(
            'UPDATE %I AS child '
            '   SET %I = p.property_id '
            '  FROM properties p '
            ' WHERE p.property_id::text = $1 '
            '   AND child.%I::text      = $2',
            child_table, child_fk, child_fk
          ) USING target_id, older_id;
        END LOOP;
      END IF;

      EXECUTE 'DELETE FROM properties WHERE property_id::text = $1'
        USING older_id;
    END LOOP;
  END LOOP;
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
