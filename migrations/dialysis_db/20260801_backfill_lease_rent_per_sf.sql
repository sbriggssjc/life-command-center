-- Backfill blank lease rent/SF from sourced annual rent and property building size.
-- Fill-blanks only: preserves curated / previously populated lease.rent_per_sf.

UPDATE public.leases AS l
SET rent_per_sf = ROUND((l.annual_rent::numeric / NULLIF(p.building_size::numeric, 0))::numeric, 2)
FROM public.properties AS p
WHERE p.property_id = l.property_id
  AND l.rent_per_sf IS NULL
  AND l.annual_rent IS NOT NULL
  AND l.annual_rent > 0
  AND p.building_size IS NOT NULL
  AND p.building_size > 0;

-- Expected gold-standard check:
-- lease_id 16307 / property_id 23654 => 181,959 / 6,308 = 28.85
SELECT
  l.lease_id,
  l.property_id,
  l.annual_rent,
  p.building_size,
  l.rent_per_sf
FROM public.leases AS l
JOIN public.properties AS p ON p.property_id = l.property_id
WHERE l.lease_id = 16307;
