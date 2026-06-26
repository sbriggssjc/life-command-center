-- 2026-06-25 — dia: make patient "Top Movers" reflect REAL period-over-period
-- movement, not CMS re-stamp noise.
--
-- WHY (grounded live on Dialysis_DB zqzrriwuavgrquhisnoa):
--   public.facility_patient_counts is a CMS-reporting-period time-series keyed
--   (medicare_id, snapshot_date). snapshot_date is derived from the CMS source
--   claims window (parse_cms_window). CMS publishes this dataset roughly
--   ANNUALLY, not monthly, so the newest GENUINE reporting period is ~2025-03.
--   The later snapshot_dates that end in 12-31 (e.g. 2025-12-31, 2026-12-31)
--   are annual claims-window-END *re-stamps* carrying near-identical data
--   (<2% of facilities differ; max delta ±135 patients).
--
--   The old v_facility_patient_counts_mom compared each facility's two NEWEST
--   snapshot_dates (2026-12-31 vs 2025-12-31 — two re-stamp markers), so
--   "Top Movers" ranked ~180 sub-1% backfill artifacts as if they were real
--   patient-volume movement.
--
-- FIX: compare the two most recent GENUINE monthly periods system-wide,
--   excluding the 12-31 annual window-END re-stamp markers. A "mover" is now a
--   facility whose count changed between those two real periods. Right now the
--   two newest genuine periods (2025-03-01 vs 2025-02-01) are byte-identical, so
--   the view returns ZERO non-zero deltas (the honest "no new period" state).
--   When CMS publishes a genuinely-new period the top-2 genuine periods shift
--   and real movers surface AUTOMATICALLY — no code change needed.
--
-- Column shape is byte-identical to the prior view (same names/order/types) so
-- every consumer (the dia Overview Top Movers tile, copilot-chat, the daily
-- briefing in api/operations.js) keeps working unchanged.
--
-- Reversible: re-create the prior body (per-facility lag over the raw series).
-- Additive/idempotent (CREATE OR REPLACE). No row writes.

CREATE OR REPLACE VIEW public.v_facility_patient_counts_mom AS
WITH genuine_periods AS (
  -- The CMS reporting periods we trust as distinct publications: real monthly
  -- markers only. Exclude 12-31 = annual claims-window-END re-stamps that carry
  -- duplicate data and would otherwise pollute the comparison.
  SELECT DISTINCT snapshot_date
  FROM public.facility_patient_counts
  WHERE to_char(snapshot_date, 'MM-DD') <> '12-31'
  ORDER BY snapshot_date DESC
  LIMIT 2
),
cur AS  ( SELECT max(snapshot_date) AS d FROM genuine_periods ),
prev AS ( SELECT min(snapshot_date) AS d FROM genuine_periods ),
cur_rows AS (
  SELECT COALESCE(clinic_id, medicare_id, ccn) AS cid, total_patients
  FROM public.facility_patient_counts
  WHERE snapshot_date = (SELECT d FROM cur)
    AND COALESCE(clinic_id, medicare_id, ccn) IS NOT NULL
),
prev_rows AS (
  SELECT COALESCE(clinic_id, medicare_id, ccn) AS cid, total_patients
  FROM public.facility_patient_counts
  WHERE snapshot_date = (SELECT d FROM prev)
    AND COALESCE(clinic_id, medicare_id, ccn) IS NOT NULL
)
SELECT
  c.cid                                            AS clinic_id,
  (SELECT d FROM cur)                              AS snapshot_date,
  c.total_patients                                 AS total_patients,
  p.total_patients                                 AS prev_total_patients,
  (c.total_patients - p.total_patients)            AS delta_patients,
  CASE
    WHEN p.total_patients > 0
      THEN (c.total_patients - p.total_patients)::numeric
           / NULLIF(p.total_patients, 0)::numeric
    ELSE NULL::numeric
  END                                              AS pct_change,
  m.facility_name,
  m.city,
  m.state,
  (c.total_patients - p.total_patients)            AS patient_delta,
  c.total_patients                                 AS patient_count
FROM cur_rows c
JOIN prev_rows p          ON p.cid = c.cid                 -- present in BOTH periods
JOIN public.medicare_clinics m ON m.medicare_id = c.cid
WHERE (c.total_patients - p.total_patients) IS NOT NULL;

COMMENT ON VIEW public.v_facility_patient_counts_mom IS
  'Patient-count movers across the two most recent GENUINE CMS reporting '
  'periods (12-31 annual window-END re-stamps excluded). snapshot_date = the '
  'newest genuine period being compared (the "as of" period). Returns no '
  'non-zero deltas when CMS has not published a new period; auto-populates when '
  'a genuine new period lands. See migration 20260625_dia_patient_counts_mom_genuine_period.sql.';
