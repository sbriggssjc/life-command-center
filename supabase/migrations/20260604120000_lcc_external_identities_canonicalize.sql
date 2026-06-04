-- ===========================================================================
-- R4-A: external_identities canonicalization (4th dia/gov alias-class fix)
-- Target DB: LCC Opps (xengecqvemvfknjvbvrq)
-- Date: 2026-06-04
--
-- Problem (2026-06-04 round-4 live audit): domain-DB external_identities rows
-- used FIVE source_system spellings and two source_type conventions for the
-- same concepts, fragmenting the entity graph:
--
--   gov_supabase/true_owner 3397 · dia_db/property 1341 · gov_db/property 1180
--   dia_supabase/true_owner 631 · dia_supabase/asset 348 · gov_supabase/asset 3
--   (gov/asset 2 was already canonical)
--
-- Symptom: the create-from-intake flow wrote dia property 44309's identity as
-- (dia_db, property); the unified detail page resolves the property-anchor
-- entity via the canonical (dia|gov, asset, <property_id>) convention (see
-- 20260603140000), so it rendered "(Unknown)" / "LCC Entity Not Registered" /
-- "Ownership Not Resolved" even though the entity existed and was linked.
--
-- Canonical scheme (also documented in CLAUDE.md):
--   - source_system: 'dia' | 'gov'  for the two domain DBs
--   - source_type  : 'asset'        for the property-anchor entity
--                     (property/clinic/facility are synonyms → collapse to asset)
--   - source_type  : 'true_owner'   for an owner-entity identity
--   - external_id  : domain properties.property_id  (for assets)
--
-- Non-domain rows (costar/rca/crexi/loopnet/salesforce/email_intake) are left
-- untouched. email_intake rows key on a staged-intake UUID, NOT a domain
-- property id, so they are a distinct intake-channel identity and are NOT
-- remapped (verified: 231/231 external_ids are UUIDs, zero numeric).
--
-- Idempotent: re-running normalizes nothing further (no rows match the
-- deprecated spellings) and the dedup pass finds no collisions.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Collision-safe dedup BEFORE the relabel.
--    Two deprecated rows (e.g. dia_db/property/<pid> and dia_supabase/asset/<pid>)
--    can normalize to the same canonical key (dia/asset/<pid>) and would violate
--    the unique (workspace_id, source_system, source_type, external_id).
--    Keep the OLDEST row per canonical key (including any already-canonical
--    row), delete the newer duplicates. (Live audit 2026-06-04: zero current
--    collisions — this is a safety net for future re-runs.)
-- ---------------------------------------------------------------------------
WITH allrows AS (
  SELECT
    id, workspace_id, entity_id, created_at, source_system, source_type, external_id,
    CASE
      WHEN source_system IN ('dia','dia_db','dia_supabase','dialysis')      THEN 'dia'
      WHEN source_system IN ('gov','gov_db','gov_supabase','government')     THEN 'gov'
      ELSE source_system
    END AS cs,
    CASE
      WHEN source_system IN ('dia','dia_db','dia_supabase','dialysis',
                             'gov','gov_db','gov_supabase','government')
           AND source_type IN ('property','asset','clinic','facility') THEN 'asset'
      ELSE source_type
    END AS ct
  FROM public.external_identities
  WHERE source_system IN ('dia','dia_db','dia_supabase','dialysis',
                          'gov','gov_db','gov_supabase','government')
),
ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY workspace_id, cs, ct, external_id
           ORDER BY created_at NULLS LAST, id
         ) AS rn
  FROM allrows
)
DELETE FROM public.external_identities x
USING ranked r
WHERE x.id = r.id
  AND r.rn > 1;

-- ---------------------------------------------------------------------------
-- 2. Collapse the property-anchor source_type synonyms to 'asset' (domain rows
--    only — leave vendor 'property' rows, which key on listing ids). Done first,
--    while the deprecated source_system still identifies the domain rows.
--    'true_owner' is untouched.
-- ---------------------------------------------------------------------------
UPDATE public.external_identities
SET source_type = 'asset'
WHERE source_system IN ('dia','dia_db','dia_supabase','dialysis',
                        'gov','gov_db','gov_supabase','government')
  AND source_type IN ('property','clinic','facility');

-- ---------------------------------------------------------------------------
-- 3. Normalize source_system to the canonical short forms.
-- ---------------------------------------------------------------------------
UPDATE public.external_identities
SET source_system = CASE
      WHEN source_system IN ('dia_db','dia_supabase','dialysis') THEN 'dia'
      ELSE 'gov'
    END
WHERE source_system IN ('dia_db','dia_supabase','dialysis',
                        'gov_db','gov_supabase','government');

-- ---------------------------------------------------------------------------
-- 4. Junk entity-name disposition (soft). The entity-sync/creation boundary
--    historically lacked the junk filter the sidebar pipeline has, so CoStar
--    "Buyer/Seller Contacts" panel-header + phone bleed-through landed as
--    entity names (e.g. P0.5: "Seller ContactsCraig Burrows(916) 768-5544 (p)").
--    Flag them in metadata for review — DO NOT hard-delete (preserve any real
--    linkage; a human or the merge queue dispositions them). Idempotent.
-- ---------------------------------------------------------------------------
UPDATE public.entities
SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'junk_name_flagged',    true,
      'junk_name_flagged_at', now(),
      'junk_name_flagged_by', 'R4-A migration 20260604120000',
      'junk_name_reason',     'entity name contains phone/email/Buyer-or-Seller-Contacts header bleed-through'
    ),
    updated_at = now()
WHERE (metadata->>'junk_name_flagged') IS DISTINCT FROM 'true'
  AND name IS NOT NULL
  AND (
        name ~ '\(\d{3}\)\s*\d{3}[-.\s]?\d{4}'                       -- (916) 768-5544
     OR name ~ '\m\d{3}[-.]\d{3}[-.]\d{4}\M'                        -- 916-768-5544
     OR name ~* '(buyer|seller)\s*contacts?'                        -- Buyer/Seller Contacts
     OR name ~* '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'    -- embedded email
     OR name ~* '\(\s*[pcmf]\s*\)'                                  -- (p)/(c)/(m)/(f)
  );

COMMIT;

-- ---------------------------------------------------------------------------
-- Verification (run manually after apply):
--   SELECT source_system, source_type, count(*)
--   FROM external_identities GROUP BY 1,2 ORDER BY 3 DESC;
--   -- expect ZERO rows with dia_db/gov_db/dia_supabase/gov_supabase/dialysis/government
--
--   SELECT source_system, source_type, external_id, entity_id
--   FROM external_identities WHERE external_id = '44309';  -- → (dia, asset, 44309)
-- ---------------------------------------------------------------------------
