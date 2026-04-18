-- =====================================================================
-- Address dedup migration — PART 3 of 5: repoint FK children
-- =====================================================================
-- Depends on Part 1 having populated lcc_dedup_pairs and Part 2
-- having merged properties fields.
--
-- THE SLOW PART. For each child table that FKs into
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
-- large DB, run it via psql — the cumulative scan time across many
-- FK children can exceed any HTTP window.
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
