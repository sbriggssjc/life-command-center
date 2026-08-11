-- Government capital markets — lease termination active denominators from clean snapshots only.
--
-- Live issue: cm_gov_lease_termination_rate_m/_q already built a clean_snap set
-- for departure endpoints, but the active denominator still selected from raw
-- snap_agg. That let the corrupt 2019-02 gsa_snapshots month (11 lease keys vs
-- an 8,051 header count) drive the stacked active bar.
--
-- This keeps the existing column contracts and changes only the active
-- denominator source: total_leases_active and leases_outside_firm_term now carry
-- forward from the latest clean snapshot on/before the period.
--
-- Source repair: 2022-10 and 2022-11 gsa_inventory_snapshot_lines were partial,
-- but same-month gsa_snapshots rows are available and near-header-complete. Insert
-- missing line rows from that same-month source only. 2019-02 is not reconstructed
-- because both per-lease sources are partial; it remains a source re-ingest item.

INSERT INTO public.gsa_inventory_snapshot_lines (
  snapshot_id,
  snapshot_date,
  lease_number,
  old_lease_number,
  location_code,
  city,
  county,
  address,
  state,
  zip_code,
  latitude,
  longitude,
  field_office_name,
  cen_bus_unit_ind,
  lease_effective,
  lease_expiration,
  termination_date,
  latest_action,
  fully_serviced,
  lease_rsf,
  structured_parking,
  surface_parking,
  pct_building,
  annual_rent,
  pct_office,
  pct_warehouse,
  pct_special,
  renewal_option_term,
  renewal_options_left,
  lessor_name,
  data_hash
)
SELECT
  i.snapshot_id,
  s.snapshot_date,
  s.lease_number,
  s.old_lease_number,
  s.location_code,
  s.city,
  s.county,
  s.address,
  s.state,
  s.zip_code,
  s.latitude,
  s.longitude,
  s.field_office_name,
  s.cen_bus_unit_ind,
  s.lease_effective,
  s.lease_expiration,
  s.termination_date,
  s.latest_action,
  s.fully_serviced,
  s.lease_rsf,
  s.structured_parking,
  s.surface_parking,
  s.pct_building,
  s.annual_rent,
  s.pct_office,
  s.pct_warehouse,
  s.pct_special,
  s.renewal_option_term,
  s.renewal_options_left,
  s.lessor_name,
  s.data_hash
FROM public.gsa_snapshots s
JOIN public.gsa_inventory_snapshots i
  ON i.snapshot_date = s.snapshot_date
WHERE s.snapshot_date IN (DATE '2022-10-01', DATE '2022-11-01')
ON CONFLICT (snapshot_date, lease_number) DO NOTHING;

UPDATE public.gsa_inventory_snapshots i
SET notes = concat_ws(
      ' ',
      NULLIF(i.notes, ''),
      '2026-08-11 CM repair: gsa_inventory_snapshot_lines backfilled from same-month gsa_snapshots where available; remaining count variance requires source re-ingest.'
    ),
    updated_at = now()
WHERE i.snapshot_date IN (DATE '2022-10-01', DATE '2022-11-01');

UPDATE public.gsa_inventory_snapshots i
SET notes = concat_ws(
      ' ',
      NULLIF(i.notes, ''),
      '2026-08-11 CM repair: per-lease rows are partial in both gsa_snapshots and gsa_inventory_snapshot_lines; termination-rate views skip this month as unclean pending source re-ingest.'
    ),
    updated_at = now()
WHERE i.snapshot_date = DATE '2019-02-01';

CREATE OR REPLACE VIEW public.cm_gov_lease_termination_rate_m AS
WITH snap_agg AS MATERIALIZED (
  SELECT
    s.snapshot_date,
    count(*) AS total_active,
    count(*) FILTER (
      WHERE s.latest_action = ANY (ARRAY['Succeeding'::text, 'Extension'::text])
    ) AS soft_term
  FROM public.gsa_snapshots s
  GROUP BY s.snapshot_date
),
flagged AS MATERIALIZED (
  SELECT
    sa.snapshot_date,
    sa.total_active,
    (
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY t.total_active::double precision)
      FROM (
        SELECT p.total_active
        FROM snap_agg p
        WHERE p.snapshot_date < sa.snapshot_date
        ORDER BY p.snapshot_date DESC
        LIMIT 6
      ) t
    ) AS trailing_median,
    (
      SELECT count(*)
      FROM snap_agg p
      WHERE p.snapshot_date < sa.snapshot_date
    ) AS n_prior
  FROM snap_agg sa
),
clean_snap AS MATERIALIZED (
  SELECT f.snapshot_date
  FROM flagged f
  WHERE f.n_prior < 3
     OR f.trailing_median IS NULL
     OR abs(f.total_active::double precision - f.trailing_median) <= (0.015 * f.trailing_median)
),
months AS (
  SELECT (date_trunc('month', g.d) + interval '1 month - 1 day')::date AS period_end
  FROM generate_series(
    DATE '2013-01-01'::timestamp with time zone,
    public.cm_last_completed_quarter_end()::timestamp with time zone,
    interval '1 month'
  ) AS g(d)
),
active AS (
  SELECT
    m.period_end,
    COALESCE(s.total_active, 0::bigint) AS total_leases_active,
    COALESCE(s.soft_term, 0::bigint) AS leases_outside_firm_term
  FROM months m
  LEFT JOIN LATERAL (
    SELECT sa.total_active, sa.soft_term
    FROM snap_agg sa
    JOIN clean_snap c USING (snapshot_date)
    WHERE sa.snapshot_date <= m.period_end
    ORDER BY sa.snapshot_date DESC
    LIMIT 1
  ) s ON true
),
endpoints AS MATERIALIZED (
  SELECT
    m.period_end,
    (
      SELECT max(c.snapshot_date)
      FROM clean_snap c
      WHERE c.snapshot_date <= m.period_end
    ) AS cur_snap,
    (
      SELECT max(c.snapshot_date)
      FROM clean_snap c
      WHERE c.snapshot_date <= (m.period_end - interval '1 year')::date
    ) AS prior_snap
  FROM months m
),
dep AS (
  SELECT
    e.period_end,
    CASE
      WHEN e.prior_snap IS NULL THEN NULL::bigint
      ELSE COALESCE(t.terminated_ttm, 0::bigint)
    END AS terminated_ttm,
    CASE
      WHEN e.prior_snap IS NULL THEN NULL::bigint
      ELSE COALESCE(t.terminated_outside_firm_term, 0::bigint)
    END AS terminated_outside_firm_term
  FROM endpoints e
  LEFT JOIN LATERAL (
    SELECT
      count(a.lease_number) AS terminated_ttm,
      count(a.lease_number) FILTER (
        WHERE a.latest_action = ANY (ARRAY['Succeeding'::text, 'Extension'::text])
      ) AS terminated_outside_firm_term
    FROM public.gsa_snapshots a
    WHERE a.snapshot_date = e.prior_snap
      AND e.cur_snap IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.gsa_snapshots b
        WHERE b.snapshot_date = e.cur_snap
          AND b.lease_number = a.lease_number
      )
  ) t ON true
),
base AS (
  SELECT
    a.period_end,
    a.total_leases_active,
    d.terminated_ttm,
    a.leases_outside_firm_term,
    d.terminated_outside_firm_term
  FROM active a
  JOIN dep d USING (period_end)
)
SELECT
  period_end,
  total_leases_active,
  terminated_ttm,
  leases_outside_firm_term,
  terminated_outside_firm_term,
  round(avg(leases_outside_firm_term) OVER w, 1) AS avg_leases_outside_firm_term_ttm,
  CASE
    WHEN terminated_outside_firm_term IS NULL THEN NULL::numeric
    WHEN avg(leases_outside_firm_term) OVER w > 0::numeric
      THEN round(terminated_outside_firm_term::numeric / avg(leases_outside_firm_term) OVER w, 4)
    ELSE NULL::numeric
  END AS terminated_outside_firm_term_pct
FROM base
WINDOW w AS (ORDER BY period_end ROWS BETWEEN 11 PRECEDING AND CURRENT ROW)
ORDER BY period_end;

CREATE OR REPLACE VIEW public.cm_gov_lease_termination_rate_q AS
WITH snap_agg AS MATERIALIZED (
  SELECT
    s.snapshot_date,
    count(*) AS total_active,
    count(*) FILTER (
      WHERE s.latest_action = ANY (ARRAY['Succeeding'::text, 'Extension'::text])
    ) AS soft_term
  FROM public.gsa_snapshots s
  GROUP BY s.snapshot_date
),
flagged AS MATERIALIZED (
  SELECT
    sa.snapshot_date,
    sa.total_active,
    (
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY t.total_active::double precision)
      FROM (
        SELECT p.total_active
        FROM snap_agg p
        WHERE p.snapshot_date < sa.snapshot_date
        ORDER BY p.snapshot_date DESC
        LIMIT 6
      ) t
    ) AS trailing_median,
    (
      SELECT count(*)
      FROM snap_agg p
      WHERE p.snapshot_date < sa.snapshot_date
    ) AS n_prior
  FROM snap_agg sa
),
clean_snap AS MATERIALIZED (
  SELECT f.snapshot_date
  FROM flagged f
  WHERE f.n_prior < 3
     OR f.trailing_median IS NULL
     OR abs(f.total_active::double precision - f.trailing_median) <= (0.015 * f.trailing_median)
),
quarters AS (
  SELECT cm_period_anchor.period_end
  FROM public.cm_period_anchor
  WHERE cm_period_anchor.period_end >= DATE '2013-04-01'
    AND cm_period_anchor.period_end <= public.cm_last_completed_quarter_end()
),
active AS (
  SELECT
    q.period_end,
    COALESCE(s.total_active, 0::bigint) AS total_leases_active,
    COALESCE(s.soft_term, 0::bigint) AS leases_outside_firm_term
  FROM quarters q
  LEFT JOIN LATERAL (
    SELECT sa.total_active, sa.soft_term
    FROM snap_agg sa
    JOIN clean_snap c USING (snapshot_date)
    WHERE sa.snapshot_date <= q.period_end
    ORDER BY sa.snapshot_date DESC
    LIMIT 1
  ) s ON true
),
endpoints AS MATERIALIZED (
  SELECT
    q.period_end,
    (
      SELECT max(c.snapshot_date)
      FROM clean_snap c
      WHERE c.snapshot_date <= q.period_end
    ) AS cur_snap,
    (
      SELECT max(c.snapshot_date)
      FROM clean_snap c
      WHERE c.snapshot_date <= (q.period_end - interval '1 year')::date
    ) AS prior_snap
  FROM quarters q
),
dep AS (
  SELECT
    e.period_end,
    COALESCE(t.terminated_ttm, 0::bigint) AS terminated_ttm
  FROM endpoints e
  LEFT JOIN LATERAL (
    SELECT count(a.lease_number) AS terminated_ttm
    FROM public.gsa_snapshots a
    WHERE a.snapshot_date = e.prior_snap
      AND e.cur_snap IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.gsa_snapshots b
        WHERE b.snapshot_date = e.cur_snap
          AND b.lease_number = a.lease_number
      )
  ) t ON true
)
SELECT
  a.period_end,
  a.total_leases_active,
  d.terminated_ttm,
  a.leases_outside_firm_term
FROM active a
JOIN dep d USING (period_end)
ORDER BY a.period_end;
