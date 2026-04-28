-- ============================================================================
-- Round 76aj — wide connectivity backfill across dialysis tables
--
-- Following the listings + sales cleanup in Rounds 76ag/76ah, this migration
-- closes joinability gaps surfaced by the deep DB audit:
--
--   ownership_history.no_owner_link   8,519 -> 874  (CMS chain rows tagged,
--                                                    real ownership rows
--                                                    backfilled from sale FK)
--   leases.tenant_no_id                1,662 -> 417 (case-insensitive name
--                                                    match against tenants)
--   leases.operator_no_id              3,081 -> 67  (against operators)
--   recorded_owners.no_contact         920 -> 663   (against contacts)
--   sale_brokers dangling sale FK      15 -> 0      (deleted)
--   properties.no_tenant               3,481 -> 3,259 (backfilled from
--                                                     active leases)
--
-- Apply on dialysis Supabase project (zqzrriwuavgrquhisnoa).
-- ============================================================================

-- ── 1. Tag CMS operator-chain rows so they stop appearing as broken ownership
UPDATE public.ownership_history
   SET ownership_source = 'cms_operator_chain',
       owner_type       = 'operator'
 WHERE owner_id IS NULL AND recorded_owner_id IS NULL AND true_owner_id IS NULL
   AND notes ~* '^CMS chain org';

-- ── 2. Inherit owner FK from linked sale where possible
UPDATE public.ownership_history oh
   SET recorded_owner_id = st.recorded_owner_id
  FROM public.sales_transactions st
 WHERE oh.sale_id = st.sale_id
   AND st.recorded_owner_id IS NOT NULL
   AND oh.recorded_owner_id IS NULL
   AND oh.owner_id IS NULL AND oh.true_owner_id IS NULL;

UPDATE public.ownership_history oh
   SET true_owner_id = st.true_owner_id
  FROM public.sales_transactions st
 WHERE oh.sale_id = st.sale_id
   AND st.true_owner_id IS NOT NULL
   AND oh.true_owner_id IS NULL;

-- ── 3. Backfill leases.tenant_id (collision-safe via DISTINCT ON)
WITH bestt AS (
  SELECT DISTINCT ON (LOWER(t.name)) LOWER(t.name) AS lname, t.tenant_id
  FROM public.tenants t WHERE t.name IS NOT NULL AND TRIM(t.name) <> ''
  ORDER BY LOWER(t.name), t.tenant_id
),
candidates AS (
  SELECT l.lease_id, l.property_id, bt.tenant_id AS new_tid, l.lease_start, l.lease_expiration
  FROM public.leases l
  JOIN bestt bt ON LOWER(TRIM(l.tenant)) = bt.lname
  WHERE l.tenant_id IS NULL AND l.tenant IS NOT NULL AND TRIM(l.tenant) <> ''
),
deduped AS (
  SELECT DISTINCT ON (property_id, new_tid,
                      COALESCE(lease_start::text,''),
                      COALESCE(lease_expiration::text,''))
    lease_id, property_id, new_tid, lease_start, lease_expiration
  FROM candidates
  ORDER BY property_id, new_tid,
           COALESCE(lease_start::text,''),
           COALESCE(lease_expiration::text,''),
           lease_id
),
safe AS (
  SELECT d.* FROM deduped d
  WHERE NOT EXISTS (
    SELECT 1 FROM public.leases l2
    WHERE l2.property_id = d.property_id
      AND l2.tenant_id   = d.new_tid
      AND COALESCE(l2.lease_start::text,'')      = COALESCE(d.lease_start::text,'')
      AND COALESCE(l2.lease_expiration::text,'') = COALESCE(d.lease_expiration::text,'')
      AND l2.lease_id <> d.lease_id
  )
)
UPDATE public.leases l SET tenant_id = s.new_tid FROM safe s WHERE l.lease_id = s.lease_id;

-- ── 4. Backfill leases.operator_id
WITH besto AS (
  SELECT DISTINCT ON (LOWER(o.name)) LOWER(o.name) AS lname, o.operator_id
  FROM public.operators o WHERE o.name IS NOT NULL AND TRIM(o.name) <> ''
  ORDER BY LOWER(o.name), o.operator_id
)
UPDATE public.leases l SET operator_id = bo.operator_id
  FROM besto bo
 WHERE l.operator_id IS NULL
   AND l.operator IS NOT NULL AND TRIM(l.operator) <> ''
   AND LOWER(TRIM(l.operator)) = bo.lname;

-- ── 5. Backfill recorded_owners.contact_id
WITH bestc AS (
  SELECT DISTINCT ON (LOWER(c.contact_name)) LOWER(c.contact_name) AS lname, c.contact_id
  FROM public.contacts c WHERE c.contact_name IS NOT NULL AND TRIM(c.contact_name) <> ''
  ORDER BY LOWER(c.contact_name), c.contact_id
)
UPDATE public.recorded_owners ro SET contact_id = bc.contact_id
  FROM bestc bc
 WHERE ro.contact_id IS NULL
   AND ro.name IS NOT NULL AND TRIM(ro.name) <> ''
   AND LOWER(TRIM(ro.name)) = bc.lname;

-- ── 6. Drop dangling sale_brokers (sale they reference no longer exists)
DELETE FROM public.sale_brokers sb
 WHERE NOT EXISTS (SELECT 1 FROM public.sales_transactions st WHERE st.sale_id = sb.sale_id);

-- ── 7. Backfill properties.tenant from the most recent active lease
WITH al AS (
  SELECT DISTINCT ON (l.property_id) l.property_id, l.tenant
  FROM public.leases l
  WHERE l.is_active = TRUE AND l.tenant IS NOT NULL AND TRIM(l.tenant) <> ''
  ORDER BY l.property_id, l.lease_start DESC NULLS LAST, l.lease_id DESC
)
UPDATE public.properties p SET tenant = al.tenant
  FROM al
 WHERE p.property_id = al.property_id AND (p.tenant IS NULL OR TRIM(p.tenant) = '');
