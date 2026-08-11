-- Government capital markets — Case for Renewal monthly TTM lease-level source.
--
-- Decision:
--   Do not import/extend the legacy 1991 annual event history for this chart.
--   The current source, gsa_lease_events.event_type='new_award', is a snapshot
--   diff/event table and repeatedly accumulates bulk first-of-month clusters
--   (2019-03-01, 2026-03-01, 2026-05-01, 2026-06-01). Filtering individual
--   sentinel dates just moves the failure forward.
--
-- Replacement:
--   Count lease-level trailing-12-month New actions from gsa_leases where
--   latest_action='New' and lease_effective falls in the TTM window. This is the
--   same action basis used by cm_gov_lease_renewal_rate_m for first-generation
--   commencements. Rent/SF uses only plausible rows in the $5-$100/SF band,
--   matching the nearby GSA renewal-rent outlier discipline.
--
-- Contract:
--   The chart/export code now prefers period_end when present, but this view
--   keeps the original first four columns because CREATE OR REPLACE VIEW cannot
--   reorder or rename existing view columns. period_end and rent_sample_count
--   are appended for the monthly export contract.

CREATE OR REPLACE VIEW public.cm_gov_case_for_renewal_y AS
WITH months AS (
  SELECT (date_trunc('month', g.d) + interval '1 month - 1 day')::date AS period_end
  FROM generate_series(
    '2014-01-01'::date::timestamp with time zone,
    public.cm_last_completed_quarter_end()::timestamp with time zone,
    interval '1 month'
  ) AS g(d)
),
new_leases AS (
  SELECT
    lease_effective,
    lease_rsf,
    annual_rent,
    CASE
      WHEN lease_rsf > 0 AND annual_rent > 0
        THEN annual_rent / lease_rsf::numeric
      ELSE NULL::numeric
    END AS rent_psf
  FROM public.gsa_leases
  WHERE latest_action = 'New'
    AND lease_effective IS NOT NULL
)
SELECT
  EXTRACT(year FROM m.period_end)::integer AS year,
  count(nl.*) AS commencement_count,
  avg(nl.rent_psf) FILTER (WHERE nl.rent_psf BETWEEN 5 AND 100) AS avg_rent_per_sf,
  sum(nl.lease_rsf) FILTER (WHERE nl.lease_rsf > 0) AS total_lsf,
  m.period_end,
  count(nl.*) FILTER (WHERE nl.rent_psf BETWEEN 5 AND 100) AS rent_sample_count
FROM months m
LEFT JOIN new_leases nl
  ON nl.lease_effective > m.period_end - interval '1 year'
 AND nl.lease_effective <= m.period_end
GROUP BY m.period_end
ORDER BY m.period_end;

COMMENT ON VIEW public.cm_gov_case_for_renewal_y IS
  'Monthly TTM GSA New lease commencements from gsa_leases.latest_action=New. '
  'Replaces event-based gsa_lease_events.new_award annual history because that '
  'source carries recurring bulk first-of-month import clusters. Avg rent/SF is '
  'trimmed to $5-$100/SF; rent_sample_count reports the contributing lease rows.';

CREATE OR REPLACE VIEW public.v_cm_gov_gsa_new_award_bulk_clusters AS
SELECT
  event_date,
  event_type,
  count(*) AS event_count,
  count(DISTINCT lease_number) AS distinct_lease_count,
  min(created_at) AS first_created_at,
  max(created_at) AS last_created_at
FROM public.gsa_lease_events
WHERE event_type = 'new_award'
  AND event_date IS NOT NULL
GROUP BY event_date, event_type
HAVING count(*) > 1000
ORDER BY event_count DESC, event_date DESC;

COMMENT ON VIEW public.v_cm_gov_gsa_new_award_bulk_clusters IS
  'Audit view for suppressed gsa_lease_events.new_award bulk clusters. '
  'Case for Renewal no longer reads this event source; this view preserves '
  'visibility into recurring first-of-month import spikes.';
