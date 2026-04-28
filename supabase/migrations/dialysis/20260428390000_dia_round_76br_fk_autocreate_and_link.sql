-- ============================================================================
-- Round 76br — Auto-create missing contact/tenant rows + link FKs
--
-- Round 76bq linked the brokers/leases/recorded_owners that already had
-- a matching contact/tenant in the target table. The remaining gaps
-- (1,320 brokers + 151 leases + 59 recorded_owners) couldn't match
-- because no row existed in contacts/tenants for that name.
--
-- This round auto-creates the missing rows + links them.
--
-- Net outcome:
--   brokers.contact_id NULL:           1,611 → 7    (-1,604, 99.6% coverage)
--   recorded_owners.contact_id NULL:      69 → 0    (perfect)
--   leases.tenant_id NULL (active):      174 → 16   (remaining are
--                                                    unique-index conflicts)
-- ============================================================================

-- 1. Auto-create contacts for unmatched brokers
INSERT INTO public.contacts (contact_name, role, notes)
  SELECT DISTINCT TRIM(b.broker_name), 'broker',
    'Auto-created Round 76br from broker_id ' || b.broker_id
  FROM public.brokers b
  WHERE b.contact_id IS NULL
    AND b.broker_name IS NOT NULL
    AND TRIM(b.broker_name) NOT IN ('', 'None')
    AND length(b.broker_name) BETWEEN 2 AND 200
ON CONFLICT DO NOTHING;

WITH match AS (
  SELECT DISTINCT ON (b.broker_id) b.broker_id, c.contact_id
  FROM public.brokers b
  JOIN public.contacts c ON normalize_entity_name(c.contact_name) = normalize_entity_name(b.broker_name)
  WHERE b.contact_id IS NULL
  ORDER BY b.broker_id, c.contact_id
)
UPDATE public.brokers b SET contact_id = m.contact_id
  FROM match m WHERE b.broker_id = m.broker_id;

-- 2. Auto-create tenants for unmatched lease tenants
INSERT INTO public.tenants (name, operator_type)
  SELECT DISTINCT TRIM(l.tenant), 'auto_created'
  FROM public.leases l
  WHERE l.is_active = TRUE AND l.tenant IS NOT NULL AND l.tenant_id IS NULL
    AND length(TRIM(l.tenant)) BETWEEN 2 AND 200
    AND NOT EXISTS (SELECT 1 FROM public.tenants t
                    WHERE normalize_entity_name(t.name) = normalize_entity_name(l.tenant))
ON CONFLICT DO NOTHING;

WITH candidate AS (
  SELECT DISTINCT ON (l.property_id, l.lease_start, l.lease_expiration)
    l.lease_id, t.tenant_id, l.property_id, l.lease_start, l.lease_expiration
  FROM public.leases l
  JOIN public.tenants t ON normalize_entity_name(t.name) = normalize_entity_name(l.tenant)
  WHERE l.is_active = TRUE AND l.tenant IS NOT NULL AND l.tenant_id IS NULL
  ORDER BY l.property_id, l.lease_start, l.lease_expiration, l.lease_id
)
UPDATE public.leases l SET tenant_id = c.tenant_id
  FROM candidate c
 WHERE l.lease_id = c.lease_id
   AND NOT EXISTS (
     SELECT 1 FROM public.leases existing
     WHERE existing.lease_id <> l.lease_id
       AND existing.property_id = c.property_id
       AND existing.tenant_id = c.tenant_id
       AND COALESCE(existing.lease_start::text, '') = COALESCE(c.lease_start::text, '')
       AND COALESCE(existing.lease_expiration::text, '') = COALESCE(c.lease_expiration::text, '')
   );

-- 3. Auto-create contacts for unmatched recorded_owners
INSERT INTO public.contacts (contact_name, role, notes)
  SELECT DISTINCT ro.name, 'recorded_owner', 'Auto-created Round 76br'
  FROM public.recorded_owners ro
  WHERE ro.contact_id IS NULL
    AND length(TRIM(ro.name)) BETWEEN 2 AND 200
    AND NOT EXISTS (SELECT 1 FROM public.contacts c
                    WHERE normalize_entity_name(c.contact_name) = normalize_entity_name(ro.name))
ON CONFLICT DO NOTHING;

WITH match AS (
  SELECT DISTINCT ON (ro.recorded_owner_id) ro.recorded_owner_id, c.contact_id
  FROM public.recorded_owners ro
  JOIN public.contacts c ON normalize_entity_name(c.contact_name) = normalize_entity_name(ro.name)
  WHERE ro.contact_id IS NULL
  ORDER BY ro.recorded_owner_id, c.contact_id
)
UPDATE public.recorded_owners ro SET contact_id = m.contact_id
  FROM match m WHERE ro.recorded_owner_id = m.recorded_owner_id;
