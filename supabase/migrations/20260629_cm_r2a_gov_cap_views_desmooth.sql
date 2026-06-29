-- =============================================================================
-- R2-A Unit 1 — de-smooth the gov cap-by-term views. Project: GovLease
-- (scknotsqkcheojiaewwh). Applied live 2026-06-29.
--
-- Scott's recurring complaint ("gov Cap by Remaining Lease Term doesn't move
-- logically / doesn't match PDF"; "gov Sold Cap by Term still too smooth")
-- traces to a residual centered moving-average window applied ON TOP of the
-- already-2yr-TTM + n>=5 per-bucket density gate. Same root cause + same fix as
-- T3/T3b (dia): drop the window, KEEP the density gate. The cap lines now show
-- real month-over-month movement; the n>=5 gate stays the honesty floor.
--
-- Views (all had a final-SELECT `avg(<col>) OVER w` + a `WINDOW w` clause):
--   cm_gov_cap_by_term_m       — was ROWS BETWEEN 3 PRECEDING AND 3 FOLLOWING
--   cm_gov_cap_by_term_q       — was ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING
--   cm_gov_sold_cap_by_term_dot — was ROWS BETWEEN 3 PRECEDING AND 3 FOLLOWING
-- KEEP: 2yr TTM blend, the n>=5 density gate, the cap basis, the bucket scheme,
-- and the byte-identical output column shape (incl. cap_by_term_m's cap_5to10
-- alias = cap_6to10). Only the moving average goes.
--
-- Reversible: re-create each prior body by restoring the final SELECT to
--   avg(<col>_g) OVER w AS <col>  + WINDOW w AS (ORDER BY period_end
--   ROWS BETWEEN N PRECEDING AND N FOLLOWING)  (N = 3 / 1 / 3 respectively).
-- View defs only; no data/row writes. No JS change here (≤12 api/*.js).
-- =============================================================================

CREATE OR REPLACE VIEW public.cm_gov_cap_by_term_m AS
 WITH months AS (
         SELECT (date_trunc('month'::text, g.d) + '1 mon -1 days'::interval)::date AS period_end
           FROM generate_series('2005-01-01'::date::timestamp with time zone, cm_last_completed_quarter_end()::timestamp with time zone, '1 mon'::interval) g(d)
        ), classified AS MATERIALIZED (
         SELECT s.sale_date,
                CASE WHEN s.cap_rate_quality = 'implausible_unverified'::text THEN NULL::numeric ELSE s.sold_cap_rate END AS cap,
            COALESCE(LEAST(s.firm_term_years_at_sale, ( SELECT (gl.termination_date - s.sale_date)::numeric / 365.0
                   FROM gsa_leases gl
                  WHERE gl.property_id = s.property_id AND gl.lease_expiration >= s.sale_date AND gl.termination_date IS NOT NULL
                  ORDER BY gl.lease_expiration DESC LIMIT 1), ( SELECT l.firm_term_years - (s.sale_date - l.commencement_date)::numeric / 365.0
                   FROM leases l
                  WHERE l.property_id = s.property_id AND l.expiration_date >= s.sale_date AND l.commencement_date IS NOT NULL AND l.firm_term_years IS NOT NULL
                  ORDER BY l.expiration_date DESC LIMIT 1)), s.firm_term_years,
                CASE WHEN s.lease_expiration IS NOT NULL AND s.lease_expiration >= s.sale_date THEN (s.lease_expiration - s.sale_date)::numeric / 365.0 ELSE NULL::numeric END) AS firm_rem
           FROM sales_transactions s
          WHERE s.sale_date IS NOT NULL AND s.sold_price > 0::numeric AND s.sold_cap_rate >= 0.04 AND s.sold_cap_rate <= 0.12 AND NOT COALESCE(s.exclude_from_market_metrics, false)
        ), ttm AS (
         SELECT m.period_end,
            percentile_disc(0.5::double precision) WITHIN GROUP (ORDER BY c.cap) FILTER (WHERE c.firm_rem > 10::numeric) AS c10,
            count(*) FILTER (WHERE c.firm_rem > 10::numeric) AS n10,
            percentile_disc(0.5::double precision) WITHIN GROUP (ORDER BY c.cap) FILTER (WHERE c.firm_rem > 6::numeric AND c.firm_rem <= 10::numeric) AS c610,
            count(*) FILTER (WHERE c.firm_rem > 6::numeric AND c.firm_rem <= 10::numeric) AS n610,
            percentile_disc(0.5::double precision) WITHIN GROUP (ORDER BY c.cap) FILTER (WHERE c.firm_rem IS NOT NULL AND c.firm_rem <= 6::numeric) AS c5,
            count(*) FILTER (WHERE c.firm_rem IS NOT NULL AND c.firm_rem <= 6::numeric) AS n5,
            percentile_disc(0.5::double precision) WITHIN GROUP (ORDER BY c.cap) FILTER (WHERE c.cap IS NOT NULL AND c.firm_rem IS NULL) AS cout,
            count(*) FILTER (WHERE c.cap IS NOT NULL AND c.firm_rem IS NULL) AS nout
           FROM months m
             LEFT JOIN classified c ON c.sale_date > (m.period_end - '2 years'::interval)::date AND c.sale_date <= m.period_end
          GROUP BY m.period_end
        ), gated AS (
         SELECT ttm.period_end,
                CASE WHEN ttm.n10 >= 5 THEN ttm.c10 ELSE NULL::numeric END AS cap_10plus_g,
                CASE WHEN ttm.n610 >= 5 THEN ttm.c610 ELSE NULL::numeric END AS cap_6to10_g,
                CASE WHEN ttm.n5 >= 5 THEN ttm.c5 ELSE NULL::numeric END AS cap_less5_g,
                CASE WHEN ttm.nout >= 5 THEN ttm.cout ELSE NULL::numeric END AS cap_outside_g
           FROM ttm
        )
 SELECT period_end,
    'all'::text AS subspecialty,
    cap_10plus_g AS cap_10plus,
    cap_6to10_g AS cap_6to10,
    cap_6to10_g AS cap_5to10,
    cap_less5_g AS cap_less5,
    cap_outside_g AS cap_outside_firm
   FROM gated
  ORDER BY period_end;

CREATE OR REPLACE VIEW public.cm_gov_cap_by_term_q AS
 WITH quarters AS (
         SELECT (date_trunc('quarter'::text, g.d) + '3 mons -1 days'::interval)::date AS period_end
           FROM generate_series('2005-01-01'::date::timestamp with time zone, cm_last_completed_quarter_end()::timestamp with time zone, '3 mons'::interval) g(d)
        ), classified AS MATERIALIZED (
         SELECT s.sale_date,
                CASE WHEN s.cap_rate_quality = 'implausible_unverified'::text THEN NULL::numeric ELSE s.sold_cap_rate END AS cap,
            COALESCE(LEAST(s.firm_term_years_at_sale, ( SELECT (gl.termination_date - s.sale_date)::numeric / 365.0
                   FROM gsa_leases gl
                  WHERE gl.property_id = s.property_id AND gl.lease_expiration >= s.sale_date AND gl.termination_date IS NOT NULL
                  ORDER BY gl.lease_expiration DESC LIMIT 1), ( SELECT l.firm_term_years - (s.sale_date - l.commencement_date)::numeric / 365.0
                   FROM leases l
                  WHERE l.property_id = s.property_id AND l.expiration_date >= s.sale_date AND l.commencement_date IS NOT NULL AND l.firm_term_years IS NOT NULL
                  ORDER BY l.expiration_date DESC LIMIT 1)), s.firm_term_years,
                CASE WHEN s.lease_expiration IS NOT NULL AND s.lease_expiration >= s.sale_date THEN (s.lease_expiration - s.sale_date)::numeric / 365.0 ELSE NULL::numeric END) AS firm_rem
           FROM sales_transactions s
          WHERE s.sale_date IS NOT NULL AND s.sold_price > 0::numeric AND s.sold_cap_rate >= 0.04 AND s.sold_cap_rate <= 0.12 AND NOT COALESCE(s.exclude_from_market_metrics, false)
        ), ttm AS (
         SELECT q.period_end,
            percentile_disc(0.5::double precision) WITHIN GROUP (ORDER BY c.cap) FILTER (WHERE c.firm_rem > 10::numeric) AS c10,
            count(*) FILTER (WHERE c.firm_rem > 10::numeric) AS n10,
            percentile_disc(0.5::double precision) WITHIN GROUP (ORDER BY c.cap) FILTER (WHERE c.firm_rem > 6::numeric AND c.firm_rem <= 10::numeric) AS c610,
            count(*) FILTER (WHERE c.firm_rem > 6::numeric AND c.firm_rem <= 10::numeric) AS n610,
            percentile_disc(0.5::double precision) WITHIN GROUP (ORDER BY c.cap) FILTER (WHERE c.firm_rem IS NOT NULL AND c.firm_rem <= 6::numeric) AS c5,
            count(*) FILTER (WHERE c.firm_rem IS NOT NULL AND c.firm_rem <= 6::numeric) AS n5,
            percentile_disc(0.5::double precision) WITHIN GROUP (ORDER BY c.cap) FILTER (WHERE c.cap IS NOT NULL AND c.firm_rem IS NULL) AS cout,
            count(*) FILTER (WHERE c.cap IS NOT NULL AND c.firm_rem IS NULL) AS nout
           FROM quarters q
             LEFT JOIN classified c ON c.sale_date > (q.period_end - '2 years'::interval)::date AND c.sale_date <= q.period_end
          GROUP BY q.period_end
        ), gated AS (
         SELECT ttm.period_end,
                CASE WHEN ttm.n10 >= 5 THEN ttm.c10 ELSE NULL::numeric END AS cap_10plus_g,
                CASE WHEN ttm.n610 >= 5 THEN ttm.c610 ELSE NULL::numeric END AS cap_6to10_g,
                CASE WHEN ttm.n5 >= 5 THEN ttm.c5 ELSE NULL::numeric END AS cap_less5_g,
                CASE WHEN ttm.nout >= 5 THEN ttm.cout ELSE NULL::numeric END AS cap_outside_g
           FROM ttm
        )
 SELECT period_end,
    'all'::text AS subspecialty,
    cap_10plus_g AS cap_10plus,
    cap_6to10_g AS cap_6to10,
    cap_less5_g AS cap_less5,
    cap_outside_g AS cap_outside_firm
   FROM gated
  ORDER BY period_end;

CREATE OR REPLACE VIEW public.cm_gov_sold_cap_by_term_dot AS
 WITH months AS (
         SELECT (date_trunc('month'::text, g.d) + '1 mon -1 days'::interval)::date AS period_end
           FROM generate_series('2005-01-01'::date::timestamp with time zone, cm_last_completed_quarter_end()::timestamp with time zone, '1 mon'::interval) g(d)
        ), classified AS MATERIALIZED (
         SELECT s.sale_date,
                CASE WHEN s.cap_rate_quality = 'implausible_unverified'::text THEN NULL::numeric ELSE s.sold_cap_rate END AS cap,
            COALESCE(LEAST(s.firm_term_years_at_sale, ( SELECT (gl.termination_date - s.sale_date)::numeric / 365.0
                   FROM gsa_leases gl
                  WHERE gl.property_id = s.property_id AND gl.lease_expiration >= s.sale_date AND gl.termination_date IS NOT NULL
                  ORDER BY gl.lease_expiration DESC LIMIT 1), ( SELECT l.firm_term_years - (s.sale_date - l.commencement_date)::numeric / 365.0
                   FROM leases l
                  WHERE l.property_id = s.property_id AND l.expiration_date >= s.sale_date AND l.commencement_date IS NOT NULL AND l.firm_term_years IS NOT NULL
                  ORDER BY l.expiration_date DESC LIMIT 1)), s.firm_term_years,
                CASE WHEN s.lease_expiration IS NOT NULL AND s.lease_expiration >= s.sale_date THEN (s.lease_expiration - s.sale_date)::numeric / 365.0 ELSE NULL::numeric END) AS firm_rem
           FROM sales_transactions s
          WHERE s.sale_date IS NOT NULL AND s.sold_price > 0::numeric AND s.sold_cap_rate >= 0.04 AND s.sold_cap_rate <= 0.12 AND NOT COALESCE(s.exclude_from_market_metrics, false)
        ), ttm AS (
         SELECT m.period_end,
            percentile_disc(0.5::double precision) WITHIN GROUP (ORDER BY c.cap) FILTER (WHERE c.firm_rem >= 10::numeric) AS cap_10plus_raw,
            count(*) FILTER (WHERE c.firm_rem >= 10::numeric) AS n_10plus,
            percentile_disc(0.5::double precision) WITHIN GROUP (ORDER BY c.cap) FILTER (WHERE c.firm_rem >= 6::numeric AND c.firm_rem < 10::numeric) AS cap_5to10_raw,
            count(*) FILTER (WHERE c.firm_rem >= 6::numeric AND c.firm_rem < 10::numeric) AS n_5to10,
            percentile_disc(0.5::double precision) WITHIN GROUP (ORDER BY c.cap) FILTER (WHERE c.firm_rem > 0::numeric AND c.firm_rem < 6::numeric) AS cap_less5_raw,
            count(*) FILTER (WHERE c.firm_rem > 0::numeric AND c.firm_rem < 6::numeric) AS n_less5,
            percentile_disc(0.5::double precision) WITHIN GROUP (ORDER BY c.cap) FILTER (WHERE c.firm_rem <= 0::numeric) AS cap_outside_raw,
            count(*) FILTER (WHERE c.firm_rem <= 0::numeric) AS n_outside
           FROM months m
             LEFT JOIN classified c ON c.sale_date > (m.period_end - '2 years'::interval)::date AND c.sale_date <= m.period_end
          GROUP BY m.period_end
        ), gated AS (
         SELECT ttm.period_end,
                CASE WHEN ttm.n_10plus >= 5 THEN ttm.cap_10plus_raw ELSE NULL::numeric END AS cap_10plus_g,
                CASE WHEN ttm.n_5to10 >= 5 THEN ttm.cap_5to10_raw ELSE NULL::numeric END AS cap_5to10_g,
                CASE WHEN ttm.n_less5 >= 5 THEN ttm.cap_less5_raw ELSE NULL::numeric END AS cap_less5_g,
                CASE WHEN ttm.n_outside >= 5 THEN ttm.cap_outside_raw ELSE NULL::numeric END AS cap_outside_g
           FROM ttm
        )
 SELECT period_end,
    'all'::text AS subspecialty,
    cap_10plus_g AS cap_10plus,
    cap_5to10_g AS cap_5to10,
    cap_less5_g AS cap_less5,
    cap_outside_g AS cap_outside_firm
   FROM gated
  ORDER BY period_end;
