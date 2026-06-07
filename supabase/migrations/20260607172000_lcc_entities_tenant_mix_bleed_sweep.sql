-- ===========================================================================
-- Unit 2 sweep: soft-flag historical tenant-mix bleed-through org entities
-- Target DB: LCC Opps (xengecqvemvfknjvbvrq)
-- Date: 2026-06-07
--
-- Problem: before the entity-bridge fix (unpackTenant now mints ONLY the
-- primary tenant), the bridge minted the WHOLE CoStar tenant-mix list as
-- first-class org entities. A multi-tenant capture (property 31457, Delano CA)
-- leaked co-tenant labels ("Massage Therapist", "Wing King Express", "Chicago
-- Steak House") into the entity graph, polluting name-match pickers + entity
-- search. These are leaf orgs with NO portfolio facts, NO Salesforce identity,
-- and ONLY non-primary 'leases' relationships to a single asset (the precise
-- structural signature of a tenant-mix leaf: the old code stamped
-- metadata.is_primary_tenant='false' on every non-primary co-tenant lease).
--
-- Disposition (Scott, 2026-06-07): full reversible soft-flag, BUCKETED so the
-- existing junk-lane bulk-disposition path can work each bucket in one verdict
-- (precedent: R7 Phase 2.5's 1,009 mistyped-person flag). Zero hard-deletes.
--   * tenant_mix_role_label — bare job/role/category labels ("Massage
--     Therapist", "Salon/Barber/Spa", "Public Administration", "Unkwn"): the
--     high-confidence-junk bucket. Role keywords gated to <=2 words so real
--     proper-noun clinics ("Mile High Pain Therapy") + agencies ("US
--     Attorney's Office") do NOT land here.
--   * tenant_mix_co_tenant — plausible real businesses that are just irrelevant
--     co-tenants ("Wing King Express", "ICON Clinical Research, Inc.").
--   * tenant_mix_review — borderline names (single odd tokens / fragments:
--     "MRINetwork", "P 3rd", "Bakery"): stay for the lane, not bulk-dismissed.
--
-- Live report at authoring time (2026-06-07): co_tenant 785 / review 67 /
-- role_label 11 (~862 total). 5 spot-checks/bucket captured in the session log.
--
-- Soft-flag only: metadata.junk_name_flagged=true + junk_name_source=<bucket>
-- (mirrors R4-A / R7-2.5). The entity graph keeps every row; the full tenant
-- mix also still lives in the asset's metadata.tenants. Idempotent: the
-- candidate CTE excludes already-flagged rows.
-- ===========================================================================

BEGIN;

WITH cand AS (
  SELECT e.id, e.name
  FROM public.entities e
  WHERE e.entity_type = 'organization'
    AND e.org_type = 'tenant'
    AND (e.metadata->>'junk_name_flagged') IS DISTINCT FROM 'true'
    AND NOT EXISTS (SELECT 1 FROM public.lcc_entity_portfolio_facts f WHERE f.entity_id = e.id)
    AND NOT EXISTS (SELECT 1 FROM public.external_identities x
                    WHERE x.entity_id = e.id AND lower(x.source_system) IN ('salesforce','sf'))
    -- at least one 'leases' relationship AND every relationship is a NON-PRIMARY
    -- lease from this entity (the tenant-mix-leaf signature) — so a real
    -- operator that is a primary tenant anywhere, or carries any other edge, is
    -- never swept.
    AND EXISTS (SELECT 1 FROM public.entity_relationships r
                WHERE r.from_entity_id = e.id AND r.relationship_type = 'leases')
    AND NOT EXISTS (
      SELECT 1 FROM public.entity_relationships r
      WHERE (r.from_entity_id = e.id OR r.to_entity_id = e.id)
        AND NOT (r.relationship_type = 'leases'
                 AND r.from_entity_id = e.id
                 AND COALESCE(r.metadata->>'is_primary_tenant','false') = 'false'))
),
bucketed AS (
  SELECT id,
    CASE
      WHEN name ~* '^(medical|office|retail|industrial|warehouse|flex|mixed[- ]?use|residential|hospitality|specialty|land|other)\s*$'
        OR name ~* '^(retailer|wholesaler|distributor|operator|manufacturer|supplier|service\s+provider|landlord|owner\s+occupier|owner[- ]?occupied)\s*$'
        OR name ~* '^(unkwn|unknown|n/?a|tbd|none|null|-+|\.{2,})\s*$'
        OR name ~* '^(agriculture|mining|utilities|construction|manufacturing|wholesale\s+trade|retail\s+trade|information|educational\s+services|other\s+services|public\s+administration|health\s+care(\s+and\s+social\s+assistance)?)\s*$'
        OR name ~* '^(smallest\s+space|max\s+contiguous|vacant\s+space|asking\s+rent|rent|service\s+type|tenancy|for\s+lease(\s+at\s+sale)?)\s*$'
        OR name ~* '^(population|households|daytime\s+employees|traffic(\s+vol)?)'
        OR name ~* '^[a-z\s]+,\s*[a-z]{2}(\s+\d{5}(-\d{4})?)?$'
        OR (array_length(regexp_split_to_array(btrim(name),'\s+'),1) <= 2
            AND name ~* '\m(therapist|therapy|massage|stylist|barber|cosmetolog|manicurist|esthetician|nails|notary|tutor|dentist|chiropractor|optometrist|podiatrist)s?\M')
      THEN 'tenant_mix_role_label'
      WHEN length(btrim(name)) < 4 OR name !~ '\s' OR name !~ '[A-Za-z]{3}'
      THEN 'tenant_mix_review'
      ELSE 'tenant_mix_co_tenant'
    END AS bucket
  FROM cand
)
UPDATE public.entities e
SET metadata = COALESCE(e.metadata, '{}'::jsonb) || jsonb_build_object(
      'junk_name_flagged',    true,
      'junk_name_flagged_at', now(),
      'junk_name_flagged_by', 'entities-domain round migration 20260607172000',
      'junk_name_source',     b.bucket,
      'junk_name_reason',     'tenant-mix bleed-through: non-primary CoStar tenant-mix co-tenant minted as org entity'
    ),
    updated_at = now()
FROM bucketed b
WHERE e.id = b.id;

COMMIT;

-- ---------------------------------------------------------------------------
-- Verification (run manually after apply):
--   SELECT metadata->>'junk_name_source' AS bucket, count(*)
--   FROM entities
--   WHERE metadata->>'junk_name_source' LIKE 'tenant_mix_%'
--   GROUP BY 1 ORDER BY 2 DESC;
-- Reversal (if ever needed — soft flag only):
--   UPDATE entities SET metadata = metadata - 'junk_name_flagged' - 'junk_name_source'
--     - 'junk_name_flagged_at' - 'junk_name_flagged_by' - 'junk_name_reason'
--   WHERE metadata->>'junk_name_source' LIKE 'tenant_mix_%';
-- ---------------------------------------------------------------------------
