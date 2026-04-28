-- ============================================================================
-- Round 76ak — column-migration backfill + ownership FK enrichment
--
-- Two latent bugs surfaced by the deep audit:
--
-- 1. The `annual_rent` column was added to dia.leases but no one migrated
--    data from the legacy `rent` column. 4,107 leases had rent in the old
--    column but NULL in the canonical one. Cap-rate analytics, OM rent
--    projections, and v_sales_comps views all read annual_rent and so
--    silently treated those leases as rent-free.
--
-- 2. The intake-promoter (api/_handlers/intake-promoter.js) was still
--    writing only to `rent`, never to `annual_rent`. Every email-intake
--    lease since the column rename was rent-blind even though the OM
--    extraction snapshot HAD the data. Fixed in the same Round 76ak
--    JS change.
--
-- Plus opportunistic backfills:
--   - cap_rate <-> current_cap_rate column-migration gap (1,071 rows)
--   - sales_transactions.rent_at_sale derived from sold_price * cap_rate
--   - properties.last_known_rent from active leases
--   - properties.recorded_owner_id from latest sale
--   - properties.true_owner_id   from latest sale
--   - contacts.salesforce_id <- legacy sf_contact_id (358 rows)
--   - properties.tenant from any lease (not just active) — adds 266 fills
--   - operator stubs for 67 unmatched lease.operator names
--
-- Apply on dialysis Supabase project (zqzrriwuavgrquhisnoa).
-- ============================================================================

-- ── 1. Lease column migration: rent -> annual_rent ─────────────────────────
UPDATE public.leases SET annual_rent = rent
 WHERE annual_rent IS NULL AND rent IS NOT NULL AND rent > 0;

UPDATE public.leases SET cap_rate = current_cap_rate
 WHERE cap_rate IS NULL AND current_cap_rate IS NOT NULL;

UPDATE public.leases SET current_cap_rate = cap_rate
 WHERE current_cap_rate IS NULL AND cap_rate IS NOT NULL;

-- ── 2. Sales rent_at_sale derived from sold_price * cap_rate ───────────────
UPDATE public.sales_transactions
   SET rent_at_sale = ROUND(sold_price * cap_rate / 100.0)::numeric,
       rent_source = COALESCE(rent_source, 'derived_from_cap_rate')
 WHERE rent_at_sale IS NULL
   AND sold_price IS NOT NULL AND sold_price > 0
   AND cap_rate IS NOT NULL AND cap_rate > 0
   AND cap_rate < 25;

-- ── 3. properties.last_known_rent <- active lease's annual_rent ────────────
WITH active_lease AS (
  SELECT DISTINCT ON (l.property_id) l.property_id, l.annual_rent
  FROM public.leases l
  WHERE l.is_active = TRUE AND l.annual_rent IS NOT NULL AND l.annual_rent > 0
  ORDER BY l.property_id, l.lease_start DESC NULLS LAST, l.lease_id DESC
)
UPDATE public.properties p SET last_known_rent = al.annual_rent
  FROM active_lease al
 WHERE p.property_id = al.property_id AND p.last_known_rent IS NULL;

-- ── 4. properties.recorded_owner_id + true_owner_id <- latest sale ─────────
WITH latest_recorded AS (
  SELECT DISTINCT ON (st.property_id) st.property_id, st.recorded_owner_id
  FROM public.sales_transactions st
  WHERE st.recorded_owner_id IS NOT NULL
  ORDER BY st.property_id, st.sale_date DESC NULLS LAST, st.sale_id DESC
)
UPDATE public.properties p SET recorded_owner_id = lr.recorded_owner_id
  FROM latest_recorded lr
 WHERE p.property_id = lr.property_id AND p.recorded_owner_id IS NULL;

WITH latest_true AS (
  SELECT DISTINCT ON (st.property_id) st.property_id, st.true_owner_id
  FROM public.sales_transactions st
  WHERE st.true_owner_id IS NOT NULL
  ORDER BY st.property_id, st.sale_date DESC NULLS LAST, st.sale_id DESC
)
UPDATE public.properties p SET true_owner_id = lt.true_owner_id
  FROM latest_true lt
 WHERE p.property_id = lt.property_id AND p.true_owner_id IS NULL;

-- ── 5. contacts.salesforce_id <- sf_contact_id (column-migration gap) ──────
UPDATE public.contacts SET salesforce_id = sf_contact_id
 WHERE salesforce_id IS NULL AND sf_contact_id IS NOT NULL;

-- ── 6. properties.tenant from any lease (not just active) ──────────────────
WITH any_lease AS (
  SELECT DISTINCT ON (l.property_id) l.property_id, l.tenant
  FROM public.leases l
  WHERE l.tenant IS NOT NULL AND TRIM(l.tenant) <> ''
  ORDER BY l.property_id, l.is_active DESC, l.lease_start DESC NULLS LAST, l.lease_id DESC
)
UPDATE public.properties p SET tenant = al.tenant
  FROM any_lease al
 WHERE p.property_id = al.property_id AND (p.tenant IS NULL OR TRIM(p.tenant) = '');

-- ── 7. Create operator stubs for unmatched lease.operator names ────────────
WITH new_ops AS (
  SELECT DISTINCT TRIM(l.operator) AS opname
  FROM public.leases l
  WHERE l.operator IS NOT NULL AND TRIM(l.operator) <> '' AND l.operator_id IS NULL
)
INSERT INTO public.operators (name, normalized_name, notes)
SELECT
  no2.opname,
  LOWER(REGEXP_REPLACE(no2.opname, '[^A-Za-z0-9]+', '', 'g')),
  'Auto-created Round 76ak from lease.operator backfill'
FROM new_ops no2
WHERE NOT EXISTS (SELECT 1 FROM public.operators o2 WHERE LOWER(o2.name) = LOWER(no2.opname));

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

-- ── 8. Tag CMS-only orphan property stubs ──────────────────────────────────
UPDATE public.properties
   SET notes = COALESCE(NULLIF(notes,'')||E'\n','')
              ||'[Round 76ak 2026-04-28] CMS-stub-no-RE-address: no leases, sales, or listings — placeholder'
 WHERE (address IS NULL OR TRIM(address) = '')
   AND NOT EXISTS (SELECT 1 FROM public.leases l WHERE l.property_id = properties.property_id)
   AND NOT EXISTS (SELECT 1 FROM public.sales_transactions s WHERE s.property_id = properties.property_id)
   AND NOT EXISTS (SELECT 1 FROM public.available_listings a WHERE a.property_id = properties.property_id);
