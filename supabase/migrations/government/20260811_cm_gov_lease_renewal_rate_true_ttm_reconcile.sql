-- Government capital markets — lease renewal rate true TTM reconciliation.
--
-- The chart is intended to show rolling 12-month lease lifecycle counts. The
-- commencement-side categories are already lease-level TTM counts from
-- gsa_leases.lease_effective, but the exit-side history still mixed in two
-- problematic fields:
--   * gsa_lease_events.event_type='expired' carries snapshot/event churn.
--   * gsa_leases.termination_date is a firm-term / option date, not an actual
--     departure date.
--
-- This keeps the existing view columns but:
--   * re-bases expired_leases to lease-level lease_expiration dates;
--   * uses cm_gov_lease_termination_rate_m.terminated_ttm as the authoritative
--     snapshot-based true departure total;
--   * caps the charted terminated_leases + non_renewed_expirations split so the
--     two exit bars always equal net_departures_ttm and cannot overstate TTM
--     movement;
--   * brings the quarterly view up to the same appended-column contract used by
--     the workbook/chart code.

CREATE OR REPLACE VIEW public.cm_gov_lease_renewal_rate_m AS
WITH months AS (
  SELECT (date_trunc('month', g.d) + interval '1 month - 1 day')::date AS period_end
  FROM generate_series(
    '2014-01-01'::date::timestamp with time zone,
    cm_last_completed_quarter_end()::timestamp with time zone,
    interval '1 month'
  ) AS g(d)
),
lease_counts AS (
  SELECT
    m.period_end,
    count(*) FILTER (
      WHERE gl.latest_action = 'New'
        AND gl.lease_effective > m.period_end - interval '1 year'
        AND gl.lease_effective <= m.period_end
    ) AS first_generation_commencements,
    count(*) FILTER (
      WHERE gl.latest_action = ANY (ARRAY['New/Replacing','Renewal','Extension','Holdover'])
        AND gl.lease_effective > m.period_end - interval '1 year'
        AND gl.lease_effective <= m.period_end
    ) AS renewed_leases,
    count(*) FILTER (
      WHERE gl.latest_action = ANY (ARRAY['Succeeding','Superseding'])
        AND gl.lease_effective > m.period_end - interval '1 year'
        AND gl.lease_effective <= m.period_end
    ) AS succeeding_superseding_leases,
    count(*) FILTER (
      WHERE gl.lease_expiration > m.period_end - interval '1 year'
        AND gl.lease_expiration <= m.period_end
    ) AS expired_leases,
    count(*) FILTER (
      WHERE gl.termination_date > m.period_end - interval '1 year'
        AND gl.termination_date <= m.period_end
    ) AS firm_term_option_dates_ttm
  FROM months m
  LEFT JOIN gsa_leases gl
    ON (
      gl.lease_effective > m.period_end - interval '1 year'
      AND gl.lease_effective <= m.period_end
    )
    OR (
      gl.lease_expiration > m.period_end - interval '1 year'
      AND gl.lease_expiration <= m.period_end
    )
    OR (
      gl.termination_date > m.period_end - interval '1 year'
      AND gl.termination_date <= m.period_end
    )
  GROUP BY m.period_end
),
reconciled AS (
  SELECT
    lc.*,
    tr.terminated_ttm AS net_departures_ttm,
    CASE
      WHEN tr.terminated_ttm IS NULL THEN NULL::bigint
      ELSE LEAST(COALESCE(lc.firm_term_option_dates_ttm, 0::bigint), tr.terminated_ttm)
    END AS chart_terminated_leases
  FROM lease_counts lc
  LEFT JOIN cm_gov_lease_termination_rate_m tr USING (period_end)
)
SELECT
  period_end,
  first_generation_commencements,
  renewed_leases,
  succeeding_superseding_leases,
  COALESCE(expired_leases, 0::bigint) AS expired_leases,
  chart_terminated_leases AS terminated_leases,
  net_departures_ttm,
  CASE
    WHEN net_departures_ttm IS NULL THEN NULL::bigint
    ELSE GREATEST(net_departures_ttm - COALESCE(chart_terminated_leases, 0::bigint), 0::bigint)
  END AS non_renewed_expirations,
  CASE
    WHEN net_departures_ttm IS NULL THEN NULL::bigint
    ELSE GREATEST(
      COALESCE(expired_leases, 0::bigint)
      - GREATEST(net_departures_ttm - COALESCE(chart_terminated_leases, 0::bigint), 0::bigint),
      0::bigint
    )
  END AS expirations_renewed_or_held,
  firm_term_option_dates_ttm
FROM reconciled
ORDER BY period_end;

CREATE OR REPLACE VIEW public.cm_gov_lease_renewal_rate_q AS
WITH quarters AS (
  SELECT DISTINCT (date_trunc('quarter', g.d) + interval '3 months - 1 day')::date AS period_end
  FROM generate_series(
    '2014-01-01'::date::timestamp with time zone,
    cm_last_completed_quarter_end()::timestamp with time zone,
    interval '3 months'
  ) AS g(d)
),
lease_counts AS (
  SELECT
    q.period_end,
    count(*) FILTER (
      WHERE gl.latest_action = 'New'
        AND gl.lease_effective > q.period_end - interval '1 year'
        AND gl.lease_effective <= q.period_end
    ) AS first_generation_commencements,
    count(*) FILTER (
      WHERE gl.latest_action = ANY (ARRAY['New/Replacing','Renewal','Extension','Holdover'])
        AND gl.lease_effective > q.period_end - interval '1 year'
        AND gl.lease_effective <= q.period_end
    ) AS renewed_leases,
    count(*) FILTER (
      WHERE gl.latest_action = ANY (ARRAY['Succeeding','Superseding'])
        AND gl.lease_effective > q.period_end - interval '1 year'
        AND gl.lease_effective <= q.period_end
    ) AS succeeding_superseding_leases,
    count(*) FILTER (
      WHERE gl.lease_expiration > q.period_end - interval '1 year'
        AND gl.lease_expiration <= q.period_end
    ) AS expired_leases,
    count(*) FILTER (
      WHERE gl.termination_date > q.period_end - interval '1 year'
        AND gl.termination_date <= q.period_end
    ) AS firm_term_option_dates_ttm
  FROM quarters q
  LEFT JOIN gsa_leases gl
    ON (
      gl.lease_effective > q.period_end - interval '1 year'
      AND gl.lease_effective <= q.period_end
    )
    OR (
      gl.lease_expiration > q.period_end - interval '1 year'
      AND gl.lease_expiration <= q.period_end
    )
    OR (
      gl.termination_date > q.period_end - interval '1 year'
      AND gl.termination_date <= q.period_end
    )
  GROUP BY q.period_end
),
reconciled AS (
  SELECT
    lc.*,
    tr.terminated_ttm AS net_departures_ttm,
    CASE
      WHEN tr.terminated_ttm IS NULL THEN NULL::bigint
      ELSE LEAST(COALESCE(lc.firm_term_option_dates_ttm, 0::bigint), tr.terminated_ttm)
    END AS chart_terminated_leases
  FROM lease_counts lc
  LEFT JOIN cm_gov_lease_termination_rate_m tr USING (period_end)
)
SELECT
  period_end,
  first_generation_commencements,
  renewed_leases,
  succeeding_superseding_leases,
  COALESCE(expired_leases, 0::bigint) AS expired_leases,
  chart_terminated_leases AS terminated_leases,
  CASE WHEN net_departures_ttm IS NOT NULL THEN 'snapshot_departures'::text ELSE 'no_data'::text END AS terminated_source,
  net_departures_ttm,
  CASE
    WHEN net_departures_ttm IS NULL THEN NULL::bigint
    ELSE GREATEST(net_departures_ttm - COALESCE(chart_terminated_leases, 0::bigint), 0::bigint)
  END AS non_renewed_expirations,
  CASE
    WHEN net_departures_ttm IS NULL THEN NULL::bigint
    ELSE GREATEST(
      COALESCE(expired_leases, 0::bigint)
      - GREATEST(net_departures_ttm - COALESCE(chart_terminated_leases, 0::bigint), 0::bigint),
      0::bigint
    )
  END AS expirations_renewed_or_held,
  firm_term_option_dates_ttm
FROM reconciled
ORDER BY period_end;
