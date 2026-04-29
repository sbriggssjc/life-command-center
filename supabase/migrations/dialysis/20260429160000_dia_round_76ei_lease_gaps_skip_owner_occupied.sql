-- ============================================================================
-- Round 76ei — Lease backfill: silently filter out operator-owned properties
--
-- Audit of the 4,381-row Lease Backfill queue showed 3,673 (84%) of the
-- "missing_lease_row" candidates already have ownership_history rows with
-- owner_type='operator' and ownership_end IS NULL — i.e., the operator
-- already owns the property outright. There is no lease to find on
-- owner-occupied commercial real estate; the queue was inflating because
-- v_clinic_lease_data_gaps didn't check ownership_history before flagging
-- "no lease row exists."
--
-- This migration patches the matview's missing_lease_row_flag to also
-- require "no current operator-ownership record exists." The 3,673 rows
-- silently disappear from the queue. The remaining ~708 are properties
-- where either we have no ownership data OR the recorded owner is a
-- third party (genuine missing lease research).
--
-- Apply on dialysis Supabase project (zqzrriwuavgrquhisnoa).
-- ============================================================================

CREATE OR REPLACE VIEW public.v_clinic_lease_data_gaps AS
WITH latest_inventory AS (
  SELECT DISTINCT COALESCE(f.clinic_id, f.medicare_id) AS clinic_id,
                  f.total_patients,
                  f.snapshot_date AS latest_snapshot_date
  FROM facility_patient_counts f
  JOIN v_clinic_snapshot_months m ON f.snapshot_date = m.latest_snapshot_date
),
latest_lease AS (
  SELECT DISTINCT ON (l.property_id)
         l.property_id, l.lease_id, l.lease_start, l.lease_expiration, l.renewal_options
  FROM leases l
  WHERE l.property_id IS NOT NULL
  ORDER BY l.property_id, l.lease_expiration DESC NULLS LAST, l.lease_start DESC NULLS LAST, l.lease_id DESC
),
base AS (
  SELECT
    li.clinic_id,
    mc.facility_name, mc.address, mc.city, mc.state, mc.zip_code,
    normalize_operator_name(mc.owner_name, mc.chain_organization) AS operator_name,
    mc.chain_organization AS parent_organization,
    li.latest_snapshot_date, li.total_patients,
    p.property_id,
    ll.lease_id, ll.lease_start, ll.lease_expiration, ll.renewal_options,
    -- existing flags
    CASE WHEN p.property_id IS NULL THEN true ELSE false END AS missing_property_link_flag,
    -- Round 76ei: only flag missing_lease_row when there's NO current operator-
    -- ownership record. A property the operator already owns ("fee simple
    -- owner-occupied") has no lease and never will — skip it.
    CASE
      WHEN ll.lease_id IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM ownership_history oh
         WHERE oh.property_id = p.property_id
           AND oh.owner_type = 'operator'
           AND oh.ownership_end IS NULL
       )
      THEN true ELSE false
    END AS missing_lease_row_flag,
    CASE WHEN ll.lease_expiration IS NOT NULL AND ll.lease_expiration < CURRENT_DATE THEN true ELSE false END AS expired_lease_flag,
    CASE WHEN ll.lease_expiration IS NOT NULL AND ll.lease_expiration < li.latest_snapshot_date THEN true ELSE false END AS lease_before_latest_inventory_flag,
    CASE WHEN ll.lease_start IS NOT NULL AND ll.lease_expiration IS NOT NULL AND ll.lease_expiration <= ll.lease_start THEN true ELSE false END AS invalid_lease_term_flag,
    CASE WHEN ll.lease_expiration IS NOT NULL AND ll.lease_expiration <= (CURRENT_DATE + INTERVAL '1 year') THEN true ELSE false END AS expires_within_12_months_flag
  FROM latest_inventory li
  LEFT JOIN medicare_clinics mc ON mc.medicare_id = li.clinic_id
  LEFT JOIN properties p ON p.medicare_id = li.clinic_id
  LEFT JOIN latest_lease ll ON ll.property_id = p.property_id
)
SELECT
  CASE
    WHEN base.missing_property_link_flag           THEN 'missing_property_link'
    WHEN base.missing_lease_row_flag               THEN 'missing_lease_row'
    WHEN base.invalid_lease_term_flag              THEN 'invalid_lease_term'
    WHEN base.lease_before_latest_inventory_flag   THEN 'lease_stale_vs_inventory'
    WHEN base.expired_lease_flag                   THEN 'expired_lease_on_active_clinic'
    WHEN base.expires_within_12_months_flag        THEN 'expiring_within_12_months'
    ELSE 'other'
  END AS gap_type,
  base.clinic_id, base.facility_name, base.address, base.city, base.state, base.zip_code,
  base.operator_name, base.parent_organization,
  base.latest_snapshot_date, base.total_patients,
  base.property_id, base.lease_id, base.lease_start, base.lease_expiration, base.renewal_options,
  CASE
    WHEN base.missing_property_link_flag           THEN 'Active clinic is not linked to a property row.'
    WHEN base.missing_lease_row_flag               THEN 'Property is linked, no lease row, and operator does not currently own (per ownership_history).'
    WHEN base.invalid_lease_term_flag              THEN 'Lease expiration is on or before lease start.'
    WHEN base.lease_before_latest_inventory_flag   THEN 'Lease expiration predates the latest active inventory snapshot.'
    WHEN base.expired_lease_flag                   THEN 'Lease expiration is already in the past for an active clinic.'
    WHEN base.expires_within_12_months_flag        THEN 'Lease expiration is within 12 months.'
    ELSE 'Lease data needs review.'
  END AS gap_reason
FROM base
WHERE base.missing_property_link_flag
   OR base.missing_lease_row_flag
   OR base.invalid_lease_term_flag
   OR base.lease_before_latest_inventory_flag
   OR base.expired_lease_flag
   OR base.expires_within_12_months_flag
ORDER BY
  CASE
    WHEN base.missing_property_link_flag           THEN 1
    WHEN base.missing_lease_row_flag               THEN 2
    WHEN base.invalid_lease_term_flag              THEN 3
    WHEN base.lease_before_latest_inventory_flag   THEN 4
    WHEN base.expired_lease_flag                   THEN 5
    WHEN base.expires_within_12_months_flag        THEN 6
    ELSE 9
  END,
  base.clinic_id;

GRANT SELECT ON public.v_clinic_lease_data_gaps TO anon;
