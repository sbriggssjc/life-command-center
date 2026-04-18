-- =====================================================================
-- Address dedup migration — PART 4 of 5: delete olders + normalize
-- =====================================================================
-- Depends on Parts 1–3. Deletes the older properties whose children
-- have been successfully repointed, rewrites any remaining addresses
-- to the canonical abbreviated form, and adds the lower(address)
-- index that the runtime lookup uses.
--
-- Safe to re-run: the address rewrite is filtered by
-- `address IS DISTINCT FROM normalize_address_txt(address)` so it's
-- a no-op after the first successful run.
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
