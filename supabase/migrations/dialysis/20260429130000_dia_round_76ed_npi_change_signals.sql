-- ============================================================================
-- Round 76ed — NPI change-detection signals
--
-- Phase 2 of the NPI registry coverage plan. The npi-registry-sync edge
-- function now writes a weekly snapshot to clinic_npi_registry_history with
-- diff flags (status_changed, address_changed, name_changed, official_changed,
-- is_new, replacement_npi). This migration extends mv_npi_inventory_signals
-- with five new UNION branches that surface those diffs as BD-actionable
-- signals on the dia.js NPI Intel screen:
--
--   • npi_deactivated  — NPPES marked the NPI inactive: clinic likely closed
--                        or merged. Confirm operating status.
--   • address_change   — NPPES practice address changed: clinic relocated;
--                        often a lease event worth a property note.
--   • name_change      — Org name changed: rebrand or ownership transition.
--   • official_change  — Authorized official changed: governance event.
--   • new_npi          — A new ESRD NPI appeared at an address that matches
--                        an active medicare_clinics row already in our
--                        inventory — likely the NPI we've been missing
--                        (auto-fill candidate).
--
-- Apply on dialysis Supabase project (zqzrriwuavgrquhisnoa).
-- ============================================================================

DROP VIEW IF EXISTS public.v_npi_inventory_signal_summary;
DROP VIEW IF EXISTS public.v_npi_inventory_signals;
DROP MATERIALIZED VIEW IF EXISTS public.mv_npi_inventory_signals;

CREATE MATERIALIZED VIEW public.mv_npi_inventory_signals AS
WITH dup_clusters AS (
  SELECT npi,
         COUNT(*)                                      AS cluster_size,
         COUNT(DISTINCT lower(regexp_replace(coalesce(address,''),'[^a-z0-9]+','','gi')) || '|' || upper(coalesce(state,''))) AS distinct_addrs,
         COUNT(DISTINCT lower(regexp_replace(coalesce(facility_name,''),'[^a-z0-9]+','','gi'))) AS distinct_names,
         COUNT(*) FILTER (WHERE is_primary_ccn) AS primary_count
  FROM public.medicare_clinics
  WHERE COALESCE(npi,'') <> ''
  GROUP BY npi
  HAVING COUNT(*) > 1
),
-- Latest history snapshot per NPI — drives change-detection branches
latest_hist AS (
  SELECT DISTINCT ON (npi)
         npi, snapshot_date, organization_name, npi_status, practice_address,
         practice_city, practice_state, practice_zip, authorized_official,
         primary_taxonomy, replacement_npi,
         is_new, status_changed, address_changed, name_changed, official_changed
  FROM public.clinic_npi_registry_history
  ORDER BY npi, snapshot_date DESC
)
-- ── missing_inventory_npi ────────────────────────────────────────────────
SELECT
  'missing_inventory_npi'::text AS signal_type,
  mc.medicare_id AS clinic_id,
  mc.npi,
  public.sanitize_facility_name(mc.facility_name, mc.address) AS facility_name,
  mc.address, mc.city, mc.state, mc.zip_code,
  mc.owner_name AS operator_name,
  mc.latest_estimated_patients AS latest_total_patients,
  mc.is_active,
  mc.last_seen_date,
  mc.cms_updated_at,
  1::integer AS cluster_size,
  false      AS same_address_in_cluster,
  NULL::text AS cluster_winner_medicare_id,
  'unresolved'::text AS severity,
  CASE
    WHEN mc.is_active AND mc.latest_estimated_patients >= 50 THEN 1
    WHEN mc.is_active AND mc.latest_estimated_patients >= 20 THEN 2
    WHEN mc.is_active                                       THEN 3
    ELSE 5
  END AS signal_priority,
  'Clinic record exists but NPI is blank — look up the NPI on the registry by name + address and patch medicare_clinics.npi.'::text AS signal_reason
FROM public.medicare_clinics mc
WHERE COALESCE(mc.npi,'') = ''
  AND mc.is_active = true

UNION ALL

-- ── duplicate_inventory_npi ─────────────────────────────────────────────
SELECT
  'duplicate_inventory_npi'::text AS signal_type,
  mc.medicare_id, mc.npi,
  public.sanitize_facility_name(mc.facility_name, mc.address),
  mc.address, mc.city, mc.state, mc.zip_code,
  mc.owner_name,
  mc.latest_estimated_patients,
  mc.is_active, mc.last_seen_date, mc.cms_updated_at,
  d.cluster_size,
  (d.distinct_addrs = 1) AS same_address_in_cluster,
  CASE
    WHEN d.distinct_addrs = 1 THEN
      (SELECT mc2.medicare_id FROM public.medicare_clinics mc2
       WHERE mc2.npi = mc.npi
       ORDER BY mc2.is_primary_ccn DESC NULLS LAST,
                mc2.is_active      DESC NULLS LAST,
                mc2.last_seen_date DESC NULLS LAST,
                mc2.cms_updated_at DESC NULLS LAST,
                mc2.latest_estimated_patients DESC NULLS LAST,
                mc2.medicare_id ASC
       LIMIT 1)
    ELSE NULL
  END,
  CASE
    WHEN d.distinct_addrs = 1 AND d.primary_count = 1 THEN 'auto_resolvable'
    WHEN d.distinct_addrs = 1                          THEN 'unresolved'
    WHEN d.distinct_names = 1                          THEN 'data_quality'
    ELSE 'data_error'
  END AS severity,
  CASE
    WHEN d.distinct_addrs = 1 AND d.primary_count = 1 THEN 5
    WHEN d.distinct_addrs > 1 AND d.distinct_names > 1 THEN 1
    WHEN d.distinct_names = 1 AND d.distinct_addrs > 1 THEN 2
    ELSE 3
  END AS signal_priority,
  CASE
    WHEN d.distinct_addrs = 1 AND d.primary_count = 1 THEN
      'Same physical clinic, multiple CCNs — non-primary CCN holds the same NPI for lineage. No action needed.'
    WHEN d.distinct_addrs = 1 THEN
      'Multiple CCNs at the same address share this NPI but no primary is selected. Auto-resolver will promote one on the next nightly run.'
    WHEN d.distinct_names = 1 THEN
      'Different addresses share this NPI under the same operator name — verify if this is a relocation, a closed sister site, or a data error.'
    ELSE
      'This NPI appears on rows with different names AND different addresses — almost certainly a typo on one row. Open both records and pick the correct NPI.'
  END
FROM public.medicare_clinics mc
JOIN dup_clusters d ON d.npi = mc.npi
WHERE mc.is_active = true

UNION ALL

-- ── npi_deactivated ─────────────────────────────────────────────────────
-- NPPES status changed from Active to anything else for an NPI we have a
-- live clinic record for. High-priority — likely closure or merger.
SELECT
  'npi_deactivated'::text,
  mc.medicare_id, mc.npi,
  public.sanitize_facility_name(mc.facility_name, mc.address),
  mc.address, mc.city, mc.state, mc.zip_code,
  mc.owner_name,
  mc.latest_estimated_patients,
  mc.is_active, mc.last_seen_date, mc.cms_updated_at,
  1::integer, false, h.replacement_npi,
  'data_quality'::text AS severity,
  1 AS signal_priority,  -- highest BD priority
  CASE
    WHEN h.replacement_npi IS NOT NULL THEN
      'NPPES deactivated this clinic''s NPI and pointed it to NPI ' || h.replacement_npi || '. Likely an operator change or merger — verify ownership and update inventory.'
    ELSE
      'NPPES marked this clinic''s NPI as ' || COALESCE(NULLIF(h.npi_status,''),'inactive') || '. Likely a closure or regulatory event — confirm operating status.'
  END
FROM latest_hist h
JOIN public.medicare_clinics mc ON mc.npi = h.npi
WHERE mc.is_active = true
  AND COALESCE(h.npi_status,'A') <> 'A'

UNION ALL

-- ── address_change ──────────────────────────────────────────────────────
-- NPPES practice address changed from prior snapshot. Often = relocation
-- (lease event worth tracking) or that the CMS address was always wrong.
SELECT
  'address_change'::text,
  mc.medicare_id, mc.npi,
  public.sanitize_facility_name(mc.facility_name, mc.address),
  mc.address, mc.city, mc.state, mc.zip_code,
  mc.owner_name,
  mc.latest_estimated_patients,
  mc.is_active, mc.last_seen_date, mc.cms_updated_at,
  1, false, NULL,
  'data_quality'::text,
  1,
  'NPPES practice address changed to ' || COALESCE(NULLIF(h.practice_address,''),'(blank)')
    || ', ' || COALESCE(NULLIF(h.practice_city,''),'') || ' ' || COALESCE(NULLIF(h.practice_state,''),'')
    || '. Likely a relocation — check for new lease or property record.'
FROM latest_hist h
JOIN public.medicare_clinics mc ON mc.npi = h.npi
WHERE mc.is_active = true
  AND h.address_changed = true
  AND COALESCE(h.npi_status,'A') = 'A'  -- skip if also deactivated (covered above)

UNION ALL

-- ── name_change ─────────────────────────────────────────────────────────
SELECT
  'name_change'::text,
  mc.medicare_id, mc.npi,
  public.sanitize_facility_name(mc.facility_name, mc.address),
  mc.address, mc.city, mc.state, mc.zip_code,
  mc.owner_name,
  mc.latest_estimated_patients,
  mc.is_active, mc.last_seen_date, mc.cms_updated_at,
  1, false, NULL,
  'data_quality'::text,
  2,
  'Org name on NPPES changed to "' || COALESCE(h.organization_name,'') || '". Likely rebrand or ownership transition — verify operator.'
FROM latest_hist h
JOIN public.medicare_clinics mc ON mc.npi = h.npi
WHERE mc.is_active = true
  AND h.name_changed = true
  AND h.address_changed = false  -- name+address together is usually a relocation, covered above
  AND COALESCE(h.npi_status,'A') = 'A'

UNION ALL

-- ── official_change ─────────────────────────────────────────────────────
SELECT
  'official_change'::text,
  mc.medicare_id, mc.npi,
  public.sanitize_facility_name(mc.facility_name, mc.address),
  mc.address, mc.city, mc.state, mc.zip_code,
  mc.owner_name,
  mc.latest_estimated_patients,
  mc.is_active, mc.last_seen_date, mc.cms_updated_at,
  1, false, NULL,
  'data_quality'::text,
  3,
  'Authorized official changed to "' || COALESCE(h.authorized_official,'') || '". Lower-priority governance signal.'
FROM latest_hist h
JOIN public.medicare_clinics mc ON mc.npi = h.npi
WHERE mc.is_active = true
  AND h.official_changed = true
  AND h.name_changed = false
  AND h.address_changed = false
  AND COALESCE(h.npi_status,'A') = 'A'

UNION ALL

-- ── new_npi ─────────────────────────────────────────────────────────────
-- A new ESRD NPI appeared in NPPES whose practice address matches an active
-- medicare_clinics row that has no NPI populated. This is the auto-fill
-- companion signal — surface it so the user can one-click adopt it.
SELECT
  'new_npi'::text,
  mc.medicare_id, h.npi,
  public.sanitize_facility_name(mc.facility_name, mc.address),
  mc.address, mc.city, mc.state, mc.zip_code,
  mc.owner_name,
  mc.latest_estimated_patients,
  mc.is_active, mc.last_seen_date, mc.cms_updated_at,
  1, false, NULL,
  'data_quality'::text,
  2,
  'New ESRD NPI ' || h.npi || ' (' || COALESCE(h.organization_name,'') || ') was registered at this address. Verify and adopt as this clinic''s NPI.'
FROM latest_hist h
JOIN public.medicare_clinics mc
  ON UPPER(BTRIM(mc.address)) = UPPER(BTRIM(h.practice_address))
 AND UPPER(BTRIM(mc.state))   = UPPER(BTRIM(h.practice_state))
WHERE mc.is_active = true
  AND COALESCE(mc.npi,'') = ''
  AND h.is_new = true
  AND COALESCE(h.npi_status,'A') = 'A'
;

CREATE UNIQUE INDEX mv_npi_inventory_signals_uniq
  ON public.mv_npi_inventory_signals (signal_type, clinic_id, npi);

CREATE INDEX mv_npi_inventory_signals_severity_idx
  ON public.mv_npi_inventory_signals (severity, signal_priority);

GRANT SELECT ON public.mv_npi_inventory_signals TO anon;

-- Wrapper view (PostgREST surface)
CREATE OR REPLACE VIEW public.v_npi_inventory_signals AS
SELECT
  signal_type, clinic_id, npi, facility_name, address, city, state, zip_code,
  operator_name, latest_total_patients, is_active, last_seen_date, cms_updated_at,
  cluster_size, same_address_in_cluster, cluster_winner_medicare_id,
  severity, signal_priority, signal_reason
FROM public.mv_npi_inventory_signals;

GRANT SELECT ON public.v_npi_inventory_signals TO anon;

-- Summary view
CREATE OR REPLACE VIEW public.v_npi_inventory_signal_summary AS
SELECT
  signal_type,
  COUNT(*)                                              AS signal_count,
  COUNT(*) FILTER (WHERE severity = 'auto_resolvable')  AS auto_resolvable_count,
  COUNT(*) FILTER (WHERE severity = 'data_quality')     AS data_quality_count,
  COUNT(*) FILTER (WHERE severity = 'data_error')       AS data_error_count,
  COUNT(*) FILTER (WHERE severity = 'unresolved')       AS unresolved_count
FROM public.v_npi_inventory_signals
GROUP BY signal_type;

GRANT SELECT ON public.v_npi_inventory_signal_summary TO anon;

-- Refresh once so the new branches populate.
REFRESH MATERIALIZED VIEW public.mv_npi_inventory_signals;
