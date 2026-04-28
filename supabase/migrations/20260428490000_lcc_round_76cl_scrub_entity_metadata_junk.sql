-- ============================================================================
-- Round 76cl — scrub LCC entities + entity metadata of pre-fix sidebar junk
--
-- User capture of 215-225 S Allison Ave (post-Rounds 76bz/cd/cg/ch deploys)
-- showed the LCC sidebar's comparison view rendering:
--   Tenant DB: My Data → DaVita Kidney Care, For Lease at Sale,
--                        Smallest Space, Office Avail, Rent
--
-- Root cause: while dia.properties was clean and the EXTENSION's regex
-- filters got tightened, the LCC Opps `entities.metadata` had captured
-- the junk values during pre-fix sidebar saves. The sidepanel's
-- renderIngestDiff reads `meta.tenant_name` and `meta.tenants[]` directly
-- with only a narrow inline regex, so polluted metadata leaks to the UI.
--
-- Also surfaced: 3 LCC entities still have the 'Properties | <addr>'
-- tab-title prefix in name + address (Round 76cg cleaned dia.properties
-- but didn't propagate to entities).
--
-- Scope (LCC Opps, asset/dia/gov entities only, ~2,744 rows):
--   3 with title-prefix in address
--   3 with title-prefix in name
--  25 with junk entries in metadata.tenants array
--  16 with junk metadata.tenant_name top-level
--
-- This migration:
--  1. Strip 'Section | ' tab-title prefix from entities.address + .name
--  2. Filter junk-name entries out of entities.metadata.tenants array
--  3. NULL-out entities.metadata.tenant_name when it matches a junk pattern
-- ============================================================================

-- 1. Strip tab-title prefix on entities.name + .address
UPDATE public.entities
   SET name    = REGEXP_REPLACE(name,    '^[A-Z][a-z]+ \| ', ''),
       address = REGEXP_REPLACE(address, '^[A-Z][a-z]+ \| ', '')
 WHERE name ~ '^[A-Z][a-z]+ \| ' OR address ~ '^[A-Z][a-z]+ \| ';

-- 2. Filter junk tenant entries out of metadata.tenants array. Walk the
--    array, keep only entries whose name doesn't match a junk pattern.
UPDATE public.entities e
   SET metadata = e.metadata || jsonb_build_object(
     'tenants', COALESCE(
       (SELECT jsonb_agg(t) FROM jsonb_array_elements(e.metadata->'tenants') t
         WHERE NOT (t->>'name' ~* '^(my\s+data|news|reports|directory|markets|public\s+records|rent|for\s+lease\s+at\s+sale|smallest\s+space|max\s+contiguous|office\s+avail|retail\s+avail|industrial\s+avail|service\s+type|owner\s+occup|legal\s+description|tenancy)$')
       ),
       '[]'::jsonb
     )
   )
 WHERE EXISTS (
   SELECT 1 FROM jsonb_array_elements(COALESCE(e.metadata->'tenants','[]'::jsonb)) t
    WHERE t->>'name' ~* '^(my\s+data|news|reports|directory|markets|public\s+records|rent|for\s+lease\s+at\s+sale|smallest\s+space|max\s+contiguous|office\s+avail|retail\s+avail|industrial\s+avail|service\s+type|owner\s+occup|legal\s+description|tenancy)$'
 );

-- 3. NULL-out metadata.tenant_name when it matches a junk pattern
UPDATE public.entities
   SET metadata = metadata - 'tenant_name'
 WHERE metadata->>'tenant_name' ~* '^(my\s+data|news|reports|directory|markets|public\s+records|rent|for\s+lease\s+at\s+sale|smallest\s+space|max\s+contiguous|office\s+avail|retail\s+avail|industrial\s+avail|service\s+type|owner\s+occup|legal\s+description|tenancy)$';
