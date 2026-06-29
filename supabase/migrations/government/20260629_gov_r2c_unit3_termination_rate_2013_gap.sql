-- R2-C Unit 3 (gov) — gap the spurious flat-zero 2013 in
-- cm_gov_lease_termination_rate_m.
--
-- Grounded live 2026-06-29 (gov scknotsqkcheojiaewwh): all 12 months of 2013
-- carry terminated_ttm = 0 and terminated_outside_firm_term_pct = 0.0000; the
-- first real value is 2014-01 (terminated_ttm 865, rate 0.1577). The departure
-- numerator compares the current clean snapshot to one ~12 months prior, but
-- 2013 is the first snapshot year — there is NO prior-year snapshot — so the
-- LATERAL keys on prior_snap = NULL, matches nothing, and COALESCEs to 0,
-- producing a fake flat-zero first year.
--
-- Fix: when prior_snap does not exist, the TTM departure counts are UNKNOWN, not
-- zero — emit NULL for terminated_ttm / terminated_outside_firm_term and NULL
-- the rate. The line then STARTS at 2014 (first real reading) instead of a
-- fabricated 0% 2013. Charts render NULL as a gap.
--
-- Reversible: restore the COALESCE(..,0) in dep and the prior rate CASE.

CREATE OR REPLACE VIEW public.cm_gov_lease_termination_rate_m AS
 WITH snap_agg AS MATERIALIZED (
         SELECT s.snapshot_date,
            count(*) AS total_active,
            count(*) FILTER (WHERE s.latest_action = ANY (ARRAY['Succeeding'::text, 'Extension'::text])) AS soft_term
           FROM gsa_snapshots s
          GROUP BY s.snapshot_date
        ), flagged AS MATERIALIZED (
         SELECT sa.snapshot_date,
            sa.total_active,
            ( SELECT percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (t.total_active::double precision)) AS percentile_cont
                   FROM ( SELECT p.total_active
                           FROM snap_agg p
                          WHERE p.snapshot_date < sa.snapshot_date
                          ORDER BY p.snapshot_date DESC
                         LIMIT 6) t) AS trailing_median,
            ( SELECT count(*) AS count
                   FROM snap_agg p
                  WHERE p.snapshot_date < sa.snapshot_date) AS n_prior
           FROM snap_agg sa
        ), clean_snap AS MATERIALIZED (
         SELECT flagged.snapshot_date
           FROM flagged
          WHERE flagged.n_prior < 3 OR flagged.trailing_median IS NULL OR abs(flagged.total_active::double precision - flagged.trailing_median) <= (0.015::double precision * flagged.trailing_median)
        ), months AS (
         SELECT (date_trunc('month'::text, g.d) + '1 mon -1 days'::interval)::date AS period_end
           FROM generate_series('2013-01-01'::date::timestamp with time zone, cm_last_completed_quarter_end()::timestamp with time zone, '1 mon'::interval) g(d)
        ), active AS (
         SELECT m.period_end,
            COALESCE(s.total_active, 0::bigint) AS total_leases_active,
            COALESCE(s.soft_term, 0::bigint) AS leases_outside_firm_term
           FROM months m
             LEFT JOIN LATERAL ( SELECT sa.total_active,
                    sa.soft_term
                   FROM snap_agg sa
                  WHERE sa.snapshot_date <= m.period_end
                  ORDER BY sa.snapshot_date DESC
                 LIMIT 1) s ON true
        ), endpoints AS MATERIALIZED (
         SELECT m.period_end,
            ( SELECT max(c.snapshot_date) AS max
                   FROM clean_snap c
                  WHERE c.snapshot_date <= m.period_end) AS cur_snap,
            ( SELECT max(c.snapshot_date) AS max
                   FROM clean_snap c
                  WHERE c.snapshot_date <= (m.period_end - '1 year'::interval)::date) AS prior_snap
           FROM months m
        ), dep AS (
         SELECT e.period_end,
            -- R2-C Unit 3: no prior-year snapshot -> departures are UNKNOWN (NULL),
            -- not zero. Gaps the fabricated flat-zero first year (2013).
            CASE WHEN e.prior_snap IS NULL THEN NULL::bigint ELSE COALESCE(t.terminated_ttm, 0::bigint) END AS terminated_ttm,
            CASE WHEN e.prior_snap IS NULL THEN NULL::bigint ELSE COALESCE(t.terminated_outside_firm_term, 0::bigint) END AS terminated_outside_firm_term
           FROM endpoints e
             LEFT JOIN LATERAL ( SELECT count(a.lease_number) AS terminated_ttm,
                    count(a.lease_number) FILTER (WHERE a.latest_action = ANY (ARRAY['Succeeding'::text, 'Extension'::text])) AS terminated_outside_firm_term
                   FROM gsa_snapshots a
                  WHERE a.snapshot_date = e.prior_snap AND e.cur_snap IS NOT NULL AND NOT (EXISTS ( SELECT 1
                           FROM gsa_snapshots b
                          WHERE b.snapshot_date = e.cur_snap AND b.lease_number = a.lease_number))) t ON true
        ), base AS (
         SELECT a.period_end,
            a.total_leases_active,
            d.terminated_ttm,
            a.leases_outside_firm_term,
            d.terminated_outside_firm_term
           FROM active a
             JOIN dep d USING (period_end)
        )
 SELECT period_end,
    total_leases_active,
    terminated_ttm,
    leases_outside_firm_term,
    terminated_outside_firm_term,
    round(avg(leases_outside_firm_term) OVER w, 1) AS avg_leases_outside_firm_term_ttm,
        CASE
            WHEN terminated_outside_firm_term IS NULL THEN NULL::numeric
            WHEN avg(leases_outside_firm_term) OVER w > 0::numeric THEN round(terminated_outside_firm_term::numeric / avg(leases_outside_firm_term) OVER w, 4)
            ELSE NULL::numeric
        END AS terminated_outside_firm_term_pct
   FROM base
  WINDOW w AS (ORDER BY period_end ROWS BETWEEN 11 PRECEDING AND CURRENT ROW)
  ORDER BY period_end;
