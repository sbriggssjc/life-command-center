-- =============================================================================
-- CM gov "Leasing Summary" — dedupe new-lease events to ONE row per lease.
-- Project: government (scknotsqkcheojiaewwh). Views live immediately (no deploy).
-- Rendered by the CM export Data_Leasing_Summary tab via cm_gov_leasing_summary.
--
-- FINDING (grounded live 2026-08-13):
--   The view counted RAW gsa_lease_events rows of event_type='new_award', but a
--   single lease's new-award is re-emitted across many monthly GSA snapshot
--   diffs, so each lease appears ~7.5x in TTM. That inflated every measure and
--   broke alignment with the rest of the export:
--
--     period            raw view    truth (distinct new leases)
--     current_quarter    50   50          50   $14.6M     (ok — no dups yet)
--     ttm                7,474 leases     353   $192.8M   (was 7,474 / $3.9B)
--     last_5_years       9,750 leases   2,599   $1.65B    (was 9,750 / $5.4B)
--
--   The tell: TTM (7,474) was nearly as large as the full 5-year window (9,750)
--   and TTM total rent ($3.9B) was ~2.4x the entire 5-year total should be — a
--   subset larger than its superset. Recent months were re-diffed most, so the
--   duplication was heaviest in TTM.
--
-- FIX:
--   Reduce to the FIRST new_award per lease_number (DISTINCT ON, earliest
--   event_date) BEFORE bucketing, then bucket each lease by that first-award
--   date. This counts a genuinely-new lease once, in the period it was first
--   awarded — a later snapshot re-detecting the same lease as "new_award" no
--   longer double-counts it. current_quarter is unchanged (those leases have a
--   single award so far). Column list/order is unchanged (export reads by name).
--
-- NOTE (producer): the upstream duplication (gsa_monthly_diff re-emitting
--   new_award for an already-awarded lease on each snapshot) is a data-quality
--   issue worth fixing at the source, but the view is now robust regardless.
--
-- Reversible: re-create the prior body (raw-event count) from git history.
-- =============================================================================

CREATE OR REPLACE VIEW public.cm_gov_leasing_summary AS
WITH first_award AS (
    SELECT DISTINCT ON (e.lease_number)
        e.lease_number,
        e.event_date,
        e.lease_rsf,
        e.annual_rent,
        CASE
            WHEN e.lease_rsf > 0 THEN e.annual_rent / e.lease_rsf::numeric
            ELSE NULL::numeric
        END AS rent_psf
    FROM gsa_lease_events e
    WHERE e.event_type = 'new_award'::text
      AND e.event_date IS NOT NULL
      AND e.lease_rsf > 0
    ORDER BY e.lease_number, e.event_date
),
periods AS (
    SELECT 'current_quarter'::text AS period_label,
        date_trunc('quarter'::text, CURRENT_DATE::timestamp with time zone)::date AS period_start,
        CURRENT_DATE AS period_end,
        3::numeric AS months_in_period
    UNION ALL
    SELECT 'ttm'::text,
        (CURRENT_DATE - '1 year'::interval)::date,
        CURRENT_DATE,
        12::numeric
    UNION ALL
    SELECT 'last_5_years'::text,
        (CURRENT_DATE - '5 years'::interval)::date,
        CURRENT_DATE,
        60::numeric
)
SELECT p.period_label,
    count(n.*) AS new_lease_count,
    count(n.*)::numeric / p.months_in_period AS monthly_avg_count,
    sum(n.lease_rsf) AS total_lsf,
    sum(n.lease_rsf)::numeric / p.months_in_period AS monthly_avg_lsf,
    avg(n.lease_rsf) AS avg_lease_size,
    sum(n.annual_rent) AS total_rent,
    sum(n.annual_rent) / p.months_in_period AS monthly_avg_rent,
    avg(n.annual_rent) AS avg_annual_rent,
    avg(n.rent_psf) AS avg_rent_per_sf
FROM periods p
    LEFT JOIN first_award n ON n.event_date >= p.period_start AND n.event_date <= p.period_end
GROUP BY p.period_label, p.months_in_period
ORDER BY (
    CASE p.period_label
        WHEN 'current_quarter'::text THEN 1
        WHEN 'ttm'::text THEN 2
        ELSE 3
    END);
