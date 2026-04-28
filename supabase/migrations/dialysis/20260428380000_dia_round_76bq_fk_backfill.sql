-- ============================================================================
-- Round 76bq — Dia FK linking backfill (broker → contact, lease → tenant,
--               recorded_owner → contact)
--
-- Audit findings:
--   1,611 of 1,651 brokers (97.6%) had no contact_id link
--      174 active leases had tenant text but NULL tenant_id FK
--       69 recorded_owners had no contact_id
--
-- All three are name-match backfills — go through normalize_entity_name()
-- to pair the FK by canonical name.
--
-- Lease backfill is conservative: only sets tenant_id when doing so
-- wouldn't create a unique-constraint conflict on
-- (property_id, tenant_id, lease_start, lease_expiration). Picks one
-- canonical lease per (property_id, dates) to handle duplicate-row edge.
--
-- Net deltas:
--   brokers no contact:        1,611 → 1,320 (-291)
--   recorded_owners no contact:    69 →    59 (-10)
--   leases no tenant_id:          174 →   151 (-23)
-- ============================================================================

-- 1. brokers.contact_id from contacts.contact_name
WITH match AS (
  SELECT DISTINCT ON (b.broker_id) b.broker_id, c.contact_id
  FROM public.brokers b
  JOIN public.contacts c ON normalize_entity_name(c.contact_name) = normalize_entity_name(b.broker_name)
  WHERE b.contact_id IS NULL AND b.broker_name IS NOT NULL
  ORDER BY b.broker_id, c.contact_id
)
UPDATE public.brokers b SET contact_id = m.contact_id
  FROM match m WHERE b.broker_id = m.broker_id;

-- 2. leases.tenant_id from tenants.name (de-duped per property+dates)
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

-- 3. recorded_owners.contact_id from contacts.contact_name
WITH match AS (
  SELECT DISTINCT ON (ro.recorded_owner_id) ro.recorded_owner_id, c.contact_id
  FROM public.recorded_owners ro
  JOIN public.contacts c ON normalize_entity_name(c.contact_name) = normalize_entity_name(ro.name)
  WHERE ro.contact_id IS NULL
  ORDER BY ro.recorded_owner_id, c.contact_id
)
UPDATE public.recorded_owners ro SET contact_id = m.contact_id
  FROM match m WHERE ro.recorded_owner_id = m.recorded_owner_id;
