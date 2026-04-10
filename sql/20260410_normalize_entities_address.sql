-- Normalize asset-entity addresses to collapse abbreviation variants
-- ("Street" vs "St", "Road" vs "Rd", "Avenue" vs "Ave") so the pre-insert
-- dedup check in entities-handler.js stops letting CoStar create duplicates
-- every time it spells a street type differently from the CMS record.
--
-- Mirrors the normalizeAddress() function in api/_shared/entity-link.js.
--
-- Run as a one-off against the LCC ops Supabase project. Idempotent.

BEGIN;

-- 1. Add the normalized_address column to entities.
ALTER TABLE entities
  ADD COLUMN IF NOT EXISTS normalized_address text;

-- 2. SQL mirror of normalizeAddress() from api/_shared/entity-link.js.
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

-- 3. Populate normalized_address for every existing asset.
UPDATE entities
   SET normalized_address = normalize_address_txt(address)
 WHERE entity_type = 'asset'
   AND address IS NOT NULL
   AND (normalized_address IS NULL
        OR normalized_address IS DISTINCT FROM normalize_address_txt(address));

-- 4. Index for fast lookups from the dedup check.
CREATE INDEX IF NOT EXISTS idx_entities_normalized_address
  ON entities (workspace_id, normalized_address)
  WHERE entity_type = 'asset';

-- 5. Merge existing duplicate pairs. For each (workspace_id, normalized_address,
-- lower(city)) bucket with more than one asset, keep the most-recently-updated
-- record (assumed to be the CoStar sidebar ingest) and merge metadata plus all
-- relational pointers from the older CMS record into it before deleting the
-- older row.
DO $merge$
DECLARE
  dup       RECORD;
  older_id  uuid;
  target_id uuid;
BEGIN
  FOR dup IN
    SELECT workspace_id,
           normalized_address,
           lower(city)                                                   AS city_key,
           array_agg(id ORDER BY updated_at DESC NULLS LAST,
                                created_at DESC NULLS LAST)              AS ids
      FROM entities
     WHERE entity_type = 'asset'
       AND normalized_address IS NOT NULL
       AND normalized_address <> ''
       AND city IS NOT NULL
     GROUP BY workspace_id, normalized_address, lower(city)
    HAVING count(*) > 1
  LOOP
    target_id := dup.ids[1];

    FOREACH older_id IN ARRAY dup.ids[2:array_length(dup.ids, 1)]
    LOOP
      -- Merge metadata: older fields fill gaps on the target, target keys win.
      UPDATE entities tgt
         SET metadata   = COALESCE(old.metadata, '{}'::jsonb)
                          || COALESCE(tgt.metadata, '{}'::jsonb),
             updated_at = now()
        FROM entities old
       WHERE tgt.id = target_id
         AND old.id = older_id;

      -- Move external identities, skipping ones that would collide on
      -- (source_system, source_type, external_id) for the target.
      UPDATE external_identities ei
         SET entity_id = target_id
       WHERE ei.entity_id = older_id
         AND NOT EXISTS (
           SELECT 1 FROM external_identities ei2
            WHERE ei2.entity_id     = target_id
              AND ei2.source_system = ei.source_system
              AND ei2.source_type   = ei.source_type
              AND ei2.external_id   = ei.external_id
         );
      DELETE FROM external_identities WHERE entity_id = older_id;

      -- Move aliases (dedup by alias_canonical on the target).
      UPDATE entity_aliases ea
         SET entity_id = target_id
       WHERE ea.entity_id = older_id
         AND NOT EXISTS (
           SELECT 1 FROM entity_aliases ea2
            WHERE ea2.entity_id        = target_id
              AND ea2.alias_canonical  = ea.alias_canonical
         );
      DELETE FROM entity_aliases WHERE entity_id = older_id;

      -- Move entity relationships in both directions.
      UPDATE entity_relationships
         SET from_entity_id = target_id
       WHERE from_entity_id = older_id;
      UPDATE entity_relationships
         SET to_entity_id = target_id
       WHERE to_entity_id = older_id;

      -- Move downstream work items and activity.
      UPDATE action_items    SET entity_id = target_id WHERE entity_id = older_id;
      UPDATE activity_events SET entity_id = target_id WHERE entity_id = older_id;
      UPDATE watchers        SET entity_id = target_id WHERE entity_id = older_id;

      -- Finally remove the stale duplicate.
      DELETE FROM entities WHERE id = older_id;
    END LOOP;
  END LOOP;
END
$merge$;

COMMIT;

-- Sanity check (run after commit):
--   SELECT workspace_id, normalized_address, lower(city), count(*)
--     FROM entities
--    WHERE entity_type = 'asset' AND normalized_address <> ''
--    GROUP BY 1, 2, 3 HAVING count(*) > 1;
