-- =====================================================================
-- Address dedup migration — PART 2 of 5: merge fields on properties
-- =====================================================================
-- Depends on Part 1 having populated lcc_dedup_pairs.
--
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
