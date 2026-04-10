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
-- User triggers on properties + every FK child are ALTER TABLE
-- DISABLE'd for the duration of this transaction so a latent bug
-- in the government DB's propagate_ownership_to_property() trigger
-- (references NEW.ownership_end on ownership_history, which doesn't
-- have that column) doesn't block UPDATEs. session_replication_role
-- would be cleaner but it requires superuser and Supabase's SQL
-- editor user doesn't have that — ALTER TABLE only needs ownership.
-- DISABLE TRIGGER USER keeps RI/FK enforcement triggers active, so
-- foreign-key checks still run; only user-defined trigger functions
-- are suppressed. If the transaction rolls back for any reason the
-- DDL is reverted automatically; the explicit ENABLE at the bottom
-- covers the normal-exit path. No early RETURNs in between.
DO $merge$
DECLARE
  fk_tables          text[];
  fk_cols            text[];
  i                  integer;
  child_table        text;
  child_fk           text;
  fk_type            text;
  properties_pk_type text;
  has_medicare       boolean;
  has_lease_exp      boolean;
  has_lease_com      boolean;
  has_annual_rent    boolean;
  uc                 RECORD;
  pos                integer;
  expr               text;
  select_extra       text;
  partition_list     text;
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

  -- Native type of properties.property_id (uuid on dialysis, bigint
  -- on government). Cached once so every downstream statement can
  -- cast dup_pairs text columns to the native type and keep the
  -- comparison on c.property_id itself — that's the difference
  -- between an index scan and a full table scan, and is what caused
  -- Round 9 to time out on government's larger child tables.
  SELECT format_type(a.atttypid, a.atttypmod)
    INTO properties_pk_type
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname   = 'public'
     AND c.relname   = 'properties'
     AND a.attname   = 'property_id'
     AND NOT a.attisdropped;

  -- Disable user triggers on properties and every FK child table so
  -- the broken gov trigger (and anything similar) doesn't block the
  -- migration. These ALTERs live inside the same transaction, so a
  -- rollback reverts them automatically; the matching ENABLE block
  -- at the bottom covers the successful-exit path.
  EXECUTE 'ALTER TABLE properties DISABLE TRIGGER USER';
  IF fk_tables IS NOT NULL THEN
    FOR i IN 1 .. array_length(fk_tables, 1)
    LOOP
      EXECUTE format('ALTER TABLE %I DISABLE TRIGGER USER', fk_tables[i]);
    END LOOP;
  END IF;

  -- Build a temp table of (older_id, target_id) pairs so every step
  -- below is a single set-based statement. If there are no duplicates
  -- the table is empty and every statement below is a no-op — we do
  -- NOT early-return, because we still need the ENABLE TRIGGER block
  -- to run before COMMIT (otherwise DDL would persist).
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

  -- Batch-merge medicare_id / lease fields from older into target.
  --
  -- medicare_id has a UNIQUE constraint on dialysis, so we can't just
  -- copy it from older to target in one UPDATE — the older row still
  -- holds the value when the target row is written, producing
  -- 23505 duplicate key. Three-step: capture older values into a
  -- temp, clear older's medicare_id, then set target's.
  --
  -- Every statement below casts the dup_pairs text columns to the
  -- native properties_pk_type so the comparisons land on the PK
  -- index instead of forcing a seq scan.
  IF has_medicare THEN
    DROP TABLE IF EXISTS merge_medicare;
    EXECUTE format($cte$
      CREATE TEMP TABLE merge_medicare ON COMMIT DROP AS
      SELECT dp.target_id::%1$s AS target_id, old.medicare_id
        FROM dup_pairs dp
        JOIN properties old ON old.property_id = dp.older_id::%1$s
       WHERE old.medicare_id IS NOT NULL
    $cte$, properties_pk_type);

    EXECUTE format($sql$
      UPDATE properties
         SET medicare_id = NULL
       WHERE property_id = ANY(ARRAY(
               SELECT older_id::%1$s FROM dup_pairs))
         AND medicare_id IS NOT NULL
    $sql$, properties_pk_type);

    UPDATE properties tgt
       SET medicare_id = mm.medicare_id
      FROM merge_medicare mm
     WHERE tgt.property_id = mm.target_id
       AND tgt.medicare_id IS NULL;
  END IF;

  IF has_lease_exp THEN
    EXECUTE format($sql$
      UPDATE properties tgt
         SET lease_expiration = old.lease_expiration
        FROM properties old
        JOIN dup_pairs dp ON dp.older_id::%1$s = old.property_id
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
        JOIN dup_pairs dp ON dp.older_id::%1$s = old.property_id
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
        JOIN dup_pairs dp ON dp.older_id::%1$s = old.property_id
       WHERE tgt.property_id = dp.target_id::%1$s
         AND tgt.annual_rent IS NULL
         AND old.annual_rent IS NOT NULL
    $sql$, properties_pk_type);
  END IF;

  -- Repoint every discovered FK child. For each unique non-partial
  -- index whose key columns include the FK, run a ranked-partition
  -- DELETE that drops older rows that would collide with the target
  -- on the constraint's other key columns, and then do one batched
  -- UPDATE to repoint whatever older rows survive.
  --
  -- Per-child changes vs Round 9:
  --   * fk_type is detected from pg_attribute and all casts happen
  --     on the small dup_pairs side so c.<fk> stays native and a
  --     child-side index on the FK can be used (Round 9 cast
  --     c.<fk>::text and forced seq scans on every child — that's
  --     what timed out government).
  --   * Non-FK key columns are pulled via pg_get_indexdef(idx, pos)
  --     instead of pg_attribute on the index relation. That returns
  --     the real SQL expression for expression keys too — e.g.
  --     "COALESCE(sold_price, 0::numeric)" for
  --     sales_property_date_price_uidx — so the PARTITION BY matches
  --     the full unique key. Round 9 filtered expression slots out
  --     with `attname NOT LIKE 'pg_expression_%'` and under-
  --     partitioned, missing collisions.
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

      FOR uc IN
        SELECT i3.indexrelid,
               i3.indkey::smallint[] AS idx_keys,
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
        -- Skip indexes that don't include the FK column at all.
        IF uc.fk_attnum IS NULL
           OR NOT (uc.fk_attnum = ANY(uc.idx_keys)) THEN
          CONTINUE;
        END IF;

        -- Walk the index key positions and build two parallel strings:
        --   select_extra:   "<expr> AS _pk_2, <expr> AS _pk_3, ..."
        --   partition_list: "_pk_2, _pk_3, ..."
        -- We alias each non-FK key position so the PARTITION BY in the
        -- CTE can refer to the CTE's output column by name, which lets
        -- expression keys participate in the partition without having
        -- to qualify their column references.
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
          '    LEFT JOIN dup_pairs dp '
          '           ON dp.older_id::%5$s = c.%1$I '
          '   WHERE c.%1$I = ANY(ARRAY( '
          '           SELECT older_id::%5$s  FROM dup_pairs '
          '           UNION '
          '           SELECT target_id::%5$s FROM dup_pairs '
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

      -- One batched UPDATE per child covers every older→target pair.
      -- Native-type cast on dp.* so the filter and assignment stay on
      -- the child's FK column and can use its index.
      EXECUTE format(
        'UPDATE %1$I AS child '
        '   SET %2$I = dp.target_id::%3$s '
        '  FROM dup_pairs dp '
        ' WHERE child.%2$I = dp.older_id::%3$s',
        child_table, child_fk, fk_type
      );
    END LOOP;
  END IF;

  -- Finally remove every stale duplicate in one DELETE. Native-type
  -- cast on the dup_pairs side so the properties PK index can be used.
  EXECUTE format($sql$
    DELETE FROM properties
     WHERE property_id = ANY(ARRAY(
             SELECT older_id::%1$s FROM dup_pairs))
  $sql$, properties_pk_type);

  -- Re-enable user triggers on every table we disabled above.
  EXECUTE 'ALTER TABLE properties ENABLE TRIGGER USER';
  IF fk_tables IS NOT NULL THEN
    FOR i IN 1 .. array_length(fk_tables, 1)
    LOOP
      EXECUTE format('ALTER TABLE %I ENABLE TRIGGER USER', fk_tables[i]);
    END LOOP;
  END IF;
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
