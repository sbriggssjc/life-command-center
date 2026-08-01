-- Dossier v2 P3 — relocation lineage + market competition rent pressure.
--
-- Scope:
-- - Add minimal lineage columns that older clinic_history_unified restores may
--   not have.
-- - Backfill CCN 442740 with ONLY known facts: operator prior certification
--   date 2003-02-01, current facility certification date 2017-10-27, current
--   site/stations from CMS/property rows. Prior address/chairs remain null.
-- - Snapshot the linked NPI into clinic_npi_registry_history when available.
-- - Add read-only dossier surfaces for relocation lineage and nearby dialysis
--   competition with rent/SF when a lease is on file.

BEGIN;

ALTER TABLE IF EXISTS public.clinic_history_unified
  ADD COLUMN IF NOT EXISTS old_values jsonb,
  ADD COLUMN IF NOT EXISTS changed_fields jsonb,
  ADD COLUMN IF NOT EXISTS station_count integer;

CREATE INDEX IF NOT EXISTS idx_clinic_history_unified_ccn_type_effective
  ON public.clinic_history_unified (medicare_id, change_type, effective_date DESC);

INSERT INTO public.clinic_history_unified (
  medicare_id,
  change_type,
  change_source,
  effective_date,
  snapshot_date,
  facility_name,
  address,
  city,
  state,
  zip_code,
  station_count,
  status,
  old_values,
  new_values,
  changed_fields,
  source,
  notes
)
SELECT
  mc.medicare_id,
  'address'::text,
  'dossier_relocation_backfill'::text,
  mc.certification_date::date,
  CURRENT_DATE,
  mc.facility_name,
  p.address,
  p.city,
  p.state,
  COALESCE(p.zip_code, mc.zip_code),
  COALESCE(mc.stations, mc.number_of_chairs),
  COALESCE(mc.status, CASE WHEN mc.is_active THEN 'active' ELSE NULL END),
  jsonb_build_object(
    'prior_certification_date', DATE '2003-02-01',
    'prior_address', NULL,
    'prior_city', NULL,
    'prior_state', NULL,
    'prior_zip_code', NULL,
    'prior_station_count', NULL
  ),
  jsonb_build_object(
    'current_certification_date', mc.certification_date::date,
    'current_address', p.address,
    'current_city', p.city,
    'current_state', p.state,
    'current_zip_code', COALESCE(p.zip_code, mc.zip_code),
    'current_station_count', COALESCE(mc.stations, mc.number_of_chairs),
    'distance_miles', NULL,
    'lineage_status', 'prior_site_not_on_file'
  ),
  '["certification_date","address","station_count"]'::jsonb,
  'manual:dossier_relocation_backfill'::text,
  'property_id=23654; prior site Not on file; source facts supplied for 5247 Airways dossier'
FROM public.medicare_clinics mc
JOIN public.properties p ON p.property_id = 23654
WHERE mc.medicare_id = '442740'
  AND NOT EXISTS (
    SELECT 1
    FROM public.clinic_history_unified h
    WHERE h.medicare_id = '442740'
      AND h.change_source = 'dossier_relocation_backfill'
      AND h.notes = 'property_id=23654; prior site Not on file; source facts supplied for 5247 Airways dossier'
  );

INSERT INTO public.clinic_npi_registry_history (
  npi,
  snapshot_date,
  organization_name,
  npi_status,
  practice_address,
  practice_city,
  practice_state,
  practice_zip,
  primary_taxonomy,
  is_esrd_taxonomy
)
SELECT
  mc.npi,
  CURRENT_DATE,
  COALESCE(NULLIF(mc.facility_name, ''), NULLIF(mc.chain_organization, ''), NULLIF(mc.owner_name, '')),
  CASE WHEN COALESCE(mc.is_active, true) THEN 'A' ELSE 'D' END,
  p.address,
  p.city,
  p.state,
  COALESCE(p.zip_code, mc.zip_code),
  NULL,
  true
FROM public.medicare_clinics mc
JOIN public.properties p ON p.property_id = 23654
WHERE mc.medicare_id = '442740'
  AND NULLIF(mc.npi, '') IS NOT NULL
ON CONFLICT (npi, snapshot_date) DO NOTHING;

CREATE OR REPLACE VIEW public.v_clinic_relocation_lineage AS
WITH hist AS (
  SELECT
    h.*,
    row_number() OVER (
      PARTITION BY h.medicare_id
      ORDER BY
        CASE WHEN h.change_source = 'dossier_relocation_backfill' THEN 0 ELSE 1 END,
        h.effective_date DESC NULLS LAST,
        h.created_at DESC NULLS LAST
    ) AS rn
  FROM public.clinic_history_unified h
  WHERE h.change_type IN ('address', 'snapshot', 'capacity', 'general')
)
SELECT
  mc.medicare_id,
  mc.property_id,
  mc.npi,
  mc.facility_name,
  COALESCE(mc.stations, mc.number_of_chairs) AS current_stations,
  mc.certification_date::date AS facility_certification_date,
  COALESCE(
    mc.original_certification_date::date,
    (h.old_values->>'prior_certification_date')::date
  ) AS original_certification_date,
  h.old_values->>'prior_address' AS prior_address,
  h.old_values->>'prior_city' AS prior_city,
  h.old_values->>'prior_state' AS prior_state,
  h.old_values->>'prior_zip_code' AS prior_zip_code,
  NULLIF(h.old_values->>'prior_station_count', '')::integer AS prior_stations,
  h.new_values->>'current_address' AS current_address,
  h.new_values->>'current_city' AS current_city,
  h.new_values->>'current_state' AS current_state,
  h.new_values->>'current_zip_code' AS current_zip_code,
  NULLIF(h.new_values->>'distance_miles', '')::numeric AS distance_miles,
  COALESCE(h.new_values->>'lineage_status', CASE WHEN h.id IS NULL THEN 'not_on_file' ELSE 'history_on_file' END) AS lineage_status,
  h.source,
  h.notes,
  h.created_at
FROM public.medicare_clinics mc
LEFT JOIN hist h ON h.medicare_id = mc.medicare_id AND h.rn = 1;

GRANT SELECT ON public.v_clinic_relocation_lineage TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.dia_nearby_dialysis_competition(
  p_latitude numeric,
  p_longitude numeric,
  p_radius_miles numeric DEFAULT 5,
  p_limit integer DEFAULT 25,
  p_exclude_medicare_id text DEFAULT NULL
) RETURNS TABLE(
  medicare_id text,
  property_id integer,
  facility_name text,
  address text,
  city text,
  state text,
  distance_miles numeric,
  operator text,
  stations integer,
  patients integer,
  annual_rent numeric,
  rent_per_sf numeric,
  rent_source text,
  lease_expiration date
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH cand AS (
    SELECT
      mc.medicare_id,
      COALESCE(mc.property_id, p.property_id) AS property_id,
      mc.facility_name,
      COALESCE(p.address, mc.address) AS address,
      COALESCE(p.city, mc.city) AS city,
      COALESCE(p.state, mc.state) AS state,
      p.latitude,
      p.longitude,
      COALESCE(NULLIF(mc.chain_organization, ''), NULLIF(mc.owner_name, ''), NULLIF(p.operator, ''), NULLIF(p.tenant, '')) AS operator,
      COALESCE(mc.stations, mc.number_of_chairs) AS stations,
      mc.latest_estimated_patients AS patients,
      p.building_size
    FROM public.medicare_clinics mc
    JOIN public.properties p
      ON p.property_id = mc.property_id
      OR (mc.property_id IS NULL AND p.medicare_id = mc.medicare_id)
    WHERE p.latitude IS NOT NULL
      AND p.longitude IS NOT NULL
      AND COALESCE(mc.is_active, true) = true
      AND (p_exclude_medicare_id IS NULL OR mc.medicare_id <> p_exclude_medicare_id)
  ),
  dist AS (
    SELECT
      c.*,
      round(public.dia_haversine_miles(p_latitude, p_longitude, c.latitude, c.longitude), 3) AS distance_miles
    FROM cand c
    WHERE c.latitude BETWEEN p_latitude - (p_radius_miles / 69.0)
                         AND p_latitude + (p_radius_miles / 69.0)
      AND c.longitude BETWEEN p_longitude - (p_radius_miles / (69.0 * GREATEST(cos(radians(p_latitude)), 0.01)))
                          AND p_longitude + (p_radius_miles / (69.0 * GREATEST(cos(radians(p_latitude)), 0.01)))
  )
  SELECT
    d.medicare_id,
    d.property_id,
    d.facility_name,
    d.address,
    d.city,
    d.state,
    d.distance_miles,
    d.operator,
    d.stations,
    d.patients,
    lr.annual_rent,
    COALESCE(lr.rent_per_sf, round((lr.annual_rent / NULLIF(d.building_size, 0))::numeric, 2)) AS rent_per_sf,
    CASE
      WHEN lr.rent_per_sf IS NOT NULL THEN 'leases.rent_per_sf'
      WHEN lr.annual_rent IS NOT NULL AND d.building_size IS NOT NULL THEN 'Derived: leases.annual_rent / properties.building_size'
      ELSE NULL
    END AS rent_source,
    lr.lease_expiration
  FROM dist d
  LEFT JOIN LATERAL (
    SELECT l.annual_rent, l.rent_per_sf, l.lease_expiration
    FROM public.leases l
    WHERE l.property_id = d.property_id
      AND l.superseded_at IS NULL
    ORDER BY COALESCE(l.is_active, false) DESC, l.lease_expiration DESC NULLS LAST, l.lease_start DESC NULLS LAST
    LIMIT 1
  ) lr ON true
  WHERE d.distance_miles <= p_radius_miles
  ORDER BY d.distance_miles ASC, d.medicare_id ASC
  LIMIT GREATEST(p_limit, 0);
$$;

GRANT EXECUTE ON FUNCTION public.dia_nearby_dialysis_competition(numeric,numeric,numeric,integer,text)
  TO anon, authenticated, service_role;

COMMENT ON VIEW public.v_clinic_relocation_lineage IS
  'Dossier read model for clinic relocation lineage. Prior-site nulls mean Not on file, not inferred.';

COMMENT ON FUNCTION public.dia_nearby_dialysis_competition(numeric,numeric,numeric,integer,text) IS
  'Dossier v2 market competition: nearby dialysis CCNs by lat/lng with operator, stations, patients, and rent/SF when a lease is on file.';

COMMIT;
