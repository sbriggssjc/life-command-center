-- ============================================================================
-- CM Export Audit fixes — Dialysis DB (zqzrriwuavgrquhisnoa)
-- 2026-08-07
--
-- Fixes the chart-data issues found on the NM-CapMarkets-Dialysis 2026-06-30
-- export. Covers audit PART 1 item 3 (monthly-vs-quarterly schema drift) and
-- PART 2 items 4 & 5. All CREATE OR REPLACE VIEW edits keep the existing column
-- list/order intact and only APPEND new columns at the end (Postgres 42P16
-- append-only rule).
--
-- Reversible: each block re-creates a single view; the prior definition is
-- recoverable from git history / pg_views snapshot taken pre-change.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Item 3a — cm_dialysis_returns_indexes_m: add leveraged_return_low/high.
-- The sheet template `cash_leveraged_returns` (Data_Returns_Idx) was designed
-- against the _q view (which has low/high bands) but the export pulls the _m
-- view, which emitted only cash_return + leveraged_return_mid → "Leveraged
-- High (180bps)" / "Leveraged Low (220bps)" were ALL NULL. Add the two bands
-- using the SAME blended-cash construction the _m view already uses for mid
-- (low band = higher loan constant → lower return; high band = lower loan
-- constant). Columns appended at end.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW cm_dialysis_returns_indexes_m AS
WITH raw AS (
  SELECT m.period_end,
         m.subspecialty,
         CASE WHEN band_n.n >= 4
              THEN ((0.5 * m.avg_cap_rate_ttm)::double precision
                    + 0.25::double precision * COALESCE(m.lower_quartile_cap_ttm, m.avg_cap_rate_ttm::double precision)
                    + 0.25::double precision * COALESCE(m.upper_quartile_cap_ttm, m.avg_cap_rate_ttm::double precision))::numeric
              ELSE NULL::numeric END AS cash_return,
         CASE WHEN band_n.n >= 4 AND m.low_loan_constant IS NOT NULL AND m.high_loan_constant IS NOT NULL
              THEN ((((0.5 * m.avg_cap_rate_ttm)::double precision
                    + 0.25::double precision * COALESCE(m.lower_quartile_cap_ttm, m.avg_cap_rate_ttm::double precision)
                    + 0.25::double precision * COALESCE(m.upper_quartile_cap_ttm, m.avg_cap_rate_ttm::double precision))
                    - (((m.low_loan_constant + m.high_loan_constant) / 2.0) * 0.5)::double precision) / 0.5::double precision)::numeric
              ELSE NULL::numeric END AS leveraged_return_mid,
         -- Low band: highest cost of debt (high loan constant) → lowest return
         CASE WHEN band_n.n >= 4 AND m.high_loan_constant IS NOT NULL
              THEN ((((0.5 * m.avg_cap_rate_ttm)::double precision
                    + 0.25::double precision * COALESCE(m.lower_quartile_cap_ttm, m.avg_cap_rate_ttm::double precision)
                    + 0.25::double precision * COALESCE(m.upper_quartile_cap_ttm, m.avg_cap_rate_ttm::double precision))
                    - (m.high_loan_constant * 0.5)::double precision) / 0.5::double precision)::numeric
              ELSE NULL::numeric END AS leveraged_return_low,
         -- High band: lowest cost of debt (low loan constant) → highest return
         CASE WHEN band_n.n >= 4 AND m.low_loan_constant IS NOT NULL
              THEN ((((0.5 * m.avg_cap_rate_ttm)::double precision
                    + 0.25::double precision * COALESCE(m.lower_quartile_cap_ttm, m.avg_cap_rate_ttm::double precision)
                    + 0.25::double precision * COALESCE(m.upper_quartile_cap_ttm, m.avg_cap_rate_ttm::double precision))
                    - (m.low_loan_constant * 0.5)::double precision) / 0.5::double precision)::numeric
              ELSE NULL::numeric END AS leveraged_return_high
  FROM cm_dialysis_market_quarterly_master_m m
  LEFT JOIN LATERAL (
    SELECT count(*) AS n
    FROM sales_transactions s
    WHERE s.sale_date IS NOT NULL
      AND s.sale_date > (m.period_end - '1 year'::interval)::date
      AND s.sale_date <= m.period_end
      AND (CASE WHEN s.cap_rate_quality = 'implausible_unverified' THEN NULL::numeric ELSE s.cap_rate_final END) >= 0.04
      AND (CASE WHEN s.cap_rate_quality = 'implausible_unverified' THEN NULL::numeric ELSE s.cap_rate_final END) <= 0.12
      AND NOT COALESCE(s.exclude_from_market_metrics, false)
      AND (s.transaction_type IS NULL OR s.transaction_type = ANY (ARRAY['Investment'::text, 'Resale'::text]))
  ) band_n ON true
)
SELECT period_end, subspecialty, cash_return, leveraged_return_mid,
       leveraged_return_low, leveraged_return_high
FROM raw
ORDER BY subspecialty, period_end;

-- ----------------------------------------------------------------------------
-- Item 3b — cm_dialysis_valuation_index_m: expose avg_rent_psf + n_sales.
-- The sheet template `valuation_index` (Data_Val_Index) expects avg_rent_psf /
-- n_sales; the _m view emitted them under ttm_rent / ttm_n → ALL NULL. Alias
-- them (append-only). Dialysis genuinely has no expenses/NOI PSF in this view
-- (those columns stay absent → the exporter's schema-drift guard warns and the
-- R43 empty-column hide keeps them out of the sheet). avg_rent_psf mirrors the
-- gov _m view's column name so the shared template resolves for both verticals.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW cm_dialysis_valuation_index_m AS
WITH month_anchors AS (
  SELECT (date_trunc('month', g.d) + '1 mon -1 days'::interval)::date AS period_end
  FROM generate_series('2008-01-01'::date::timestamptz, cm_last_completed_quarter_end()::timestamptz, '1 mon'::interval) g(d)
), comps AS (
  SELECT s.sale_date,
         CASE WHEN s.cap_rate_quality = 'implausible_unverified' THEN NULL::numeric ELSE s.cap_rate_final END AS cap_rate,
         s.rent_at_sale / NULLIF(COALESCE(
           (SELECT l.leased_area FROM leases l
             WHERE l.property_id = s.property_id AND l.leased_area > 0
               AND (l.lease_expiration IS NULL OR l.lease_expiration >= s.sale_date)
               AND (l.lease_start IS NULL OR l.lease_start <= s.sale_date)
             ORDER BY l.lease_expiration DESC NULLS LAST LIMIT 1),
           (SELECT p.building_size FROM properties p WHERE p.property_id = s.property_id AND p.building_size > 0 LIMIT 1)), 0) AS rent_psf
  FROM sales_transactions s
  WHERE s.sale_date IS NOT NULL AND s.sold_price > 0
    AND NOT COALESCE(s.exclude_from_market_metrics, false) AND s.rent_at_sale > 0
), ttm AS (
  SELECT m.period_end,
         (avg(c.rent_psf) FILTER (WHERE c.rent_psf >= 10 AND c.rent_psf <= 80))::numeric(14,2) AS ttm_rent,
         (avg(c.cap_rate) FILTER (WHERE c.cap_rate >= 0.04 AND c.cap_rate <= 0.12))::numeric(8,5) AS ttm_cap,
         count(*) FILTER (WHERE c.rent_psf >= 10 AND c.rent_psf <= 80) AS ttm_n
  FROM month_anchors m
  LEFT JOIN comps c ON c.sale_date > (m.period_end - '2 years'::interval)::date AND c.sale_date <= m.period_end
  GROUP BY m.period_end
), base AS (
  SELECT (ttm.ttm_rent / NULLIF(ttm.ttm_cap, 0)) AS base_value
  FROM ttm WHERE ttm.ttm_n >= 30 AND ttm.ttm_cap > 0 AND ttm.ttm_rent > 0
  ORDER BY ttm.period_end LIMIT 1
), indexed AS (
  SELECT t.period_end, t.ttm_rent, t.ttm_cap, t.ttm_n,
         CASE WHEN t.ttm_cap > 0 AND t.ttm_rent > 0 AND b.base_value > 0
              THEN ((t.ttm_rent / t.ttm_cap) / b.base_value) * 100 ELSE NULL::numeric END AS valuation_index_raw
  FROM ttm t CROSS JOIN base b
  WHERE t.ttm_n >= 12 AND t.ttm_cap IS NOT NULL
), smoothed AS (
  SELECT indexed.period_end, indexed.ttm_rent, indexed.ttm_cap, indexed.ttm_n,
         avg(indexed.valuation_index_raw) OVER (ORDER BY indexed.period_end ROWS BETWEEN 2 PRECEDING AND 2 FOLLOWING) AS valuation_index
  FROM indexed
)
SELECT smoothed.period_end,
       'all'::text AS subspecialty,
       smoothed.ttm_rent,
       smoothed.ttm_cap,
       smoothed.ttm_n,
       smoothed.ttm_cap AS avg_cap_rate,
       round(smoothed.valuation_index, 2) AS valuation_index,
       CASE WHEN lag(smoothed.valuation_index, 12) OVER (ORDER BY smoothed.period_end) IS NOT NULL
             AND lag(smoothed.valuation_index, 12) OVER (ORDER BY smoothed.period_end) <> 0
            THEN (smoothed.valuation_index / lag(smoothed.valuation_index, 12) OVER (ORDER BY smoothed.period_end)) - 1
            ELSE NULL::numeric END AS yoy_change_pct,
       -- Appended aliases for the shared sheet template:
       smoothed.ttm_rent AS avg_rent_psf,
       smoothed.ttm_n    AS n_sales
FROM smoothed
WHERE smoothed.valuation_index IS NOT NULL
ORDER BY smoothed.period_end;

-- ----------------------------------------------------------------------------
-- Item 4 — cm_dialysis_asking_cap_by_term_m: n = COUNT(DISTINCT listing_id),
-- cap = one-value-per-listing (latest ask within the 2-yr TTM window).
-- The prior view counted listing-HISTORY observations (each listing recurs in
-- every monthly active row it is live in) → n = 1,894 vs 204 active listings,
-- and its bucket cap was observation-weighted. Dedup to the latest observation
-- per (period, listing_id) before aggregating so counts equal distinct
-- listings and each listing contributes one cap. Output columns unchanged.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW cm_dialysis_asking_cap_by_term_m AS
WITH base AS (
  SELECT period_end AS obs_end, listing_id,
         last_cap_rate AS cap, firm_term_years AS term
  FROM cm_dialysis_active_listings_m
  WHERE last_cap_rate IS NOT NULL AND last_cap_rate >= 0.04 AND last_cap_rate <= 0.12
    AND firm_term_years IS NOT NULL AND listing_id IS NOT NULL
), anchors AS (
  SELECT DISTINCT obs_end AS period_end FROM base
), windowed AS (
  SELECT a.period_end, b.listing_id, b.cap, b.term,
         row_number() OVER (PARTITION BY a.period_end, b.listing_id ORDER BY b.obs_end DESC) AS rn
  FROM anchors a
  JOIN base b ON b.obs_end > (a.period_end - '2 years'::interval)::date AND b.obs_end <= a.period_end
), latest AS (
  SELECT period_end, listing_id, cap, term FROM windowed WHERE rn = 1
), ttm AS (
  SELECT period_end,
         avg(cap) FILTER (WHERE term >= 12) AS cap_12plus_raw,
         count(*)  FILTER (WHERE term >= 12) AS cap_12plus_n,
         avg(cap) FILTER (WHERE term >= 8 AND term < 12) AS cap_8to12_raw,
         count(*)  FILTER (WHERE term >= 8 AND term < 12) AS cap_8to12_n,
         avg(cap) FILTER (WHERE term > 5 AND term < 8) AS cap_6to8_raw,
         count(*)  FILTER (WHERE term > 5 AND term < 8) AS cap_6to8_n,
         avg(cap) FILTER (WHERE term <= 5) AS cap_5orless_raw,
         count(*)  FILTER (WHERE term <= 5) AS cap_5orless_n
  FROM latest GROUP BY period_end
)
SELECT period_end, 'all'::text AS subspecialty,
       CASE WHEN cap_12plus_n  >= 5 THEN cap_12plus_raw  END AS cap_12plus,
       CASE WHEN cap_8to12_n   >= 5 THEN cap_8to12_raw   END AS cap_8to12,
       CASE WHEN cap_6to8_n    >= 5 THEN cap_6to8_raw    END AS cap_6to8,
       CASE WHEN cap_5orless_n >= 5 THEN cap_5orless_raw END AS cap_5orless,
       cap_12plus_n, cap_8to12_n, cap_6to8_n, cap_5orless_n
FROM ttm
ORDER BY period_end;

-- ----------------------------------------------------------------------------
-- Item 5 — cm_dialysis_rent_box_q: emit a row for EVERY quarter in the covered
-- range (min lease quarter → last completed quarter), including quarters with
-- n_leases < 6. Quartile fields are nulled below the density floor rather than
-- the whole row being dropped, so the chart draws labeled thin quarters instead
-- of silent gaps. Note: leases DO carry 2026+ lease_start dates, so the prior
-- mid-series gaps (no 2023, no 2024-Q3, no 2025 Q1-Q3) were caused SOLELY by
-- the n_leases >= 6 row filter, not by missing lease-comp ingestion.
-- Output columns unchanged.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW cm_dialysis_rent_box_q AS
WITH quarterly_leases AS (
  SELECT DISTINCT (date_trunc('quarter', l.lease_start::timestamptz) + '3 mons -1 days'::interval)::date AS period_end,
         l.lease_start, l.leased_area, l.rent_per_sf
  FROM leases l
  WHERE l.lease_start IS NOT NULL AND l.rent_per_sf IS NOT NULL
    AND l.rent_per_sf >= 5 AND l.rent_per_sf <= 100
), bounds AS (
  SELECT min(period_end) AS lo, cm_last_completed_quarter_end() AS hi FROM quarterly_leases
), q_anchors AS (
  SELECT (date_trunc('quarter', g.d) + '3 mons -1 days'::interval)::date AS period_end
  FROM bounds b, generate_series(b.lo::timestamptz, b.hi::timestamptz, '3 mons'::interval) g(d)
), agg AS (
  SELECT qa.period_end,
         count(ql.rent_per_sf) AS n_leases,
         (min(ql.rent_per_sf))::numeric(10,2) AS rent_min,
         (percentile_cont(0.25) WITHIN GROUP (ORDER BY ql.rent_per_sf::double precision))::numeric(10,2) AS rent_lower_quartile,
         (percentile_cont(0.50) WITHIN GROUP (ORDER BY ql.rent_per_sf::double precision))::numeric(10,2) AS rent_median,
         (percentile_cont(0.75) WITHIN GROUP (ORDER BY ql.rent_per_sf::double precision))::numeric(10,2) AS rent_upper_quartile,
         (max(ql.rent_per_sf))::numeric(10,2) AS rent_max
  FROM q_anchors qa
  LEFT JOIN quarterly_leases ql ON ql.period_end = qa.period_end
  GROUP BY qa.period_end
)
SELECT period_end,
       'all'::text AS subspecialty,
       n_leases,
       (CASE WHEN n_leases >= 6 THEN rent_min            END)::numeric(10,2) AS rent_min,
       (CASE WHEN n_leases >= 6 THEN rent_lower_quartile END)::numeric(10,2) AS rent_lower_quartile,
       (CASE WHEN n_leases >= 6 THEN rent_median         END)::numeric(10,2) AS rent_median,
       (CASE WHEN n_leases >= 6 THEN rent_upper_quartile END)::numeric(10,2) AS rent_upper_quartile,
       (CASE WHEN n_leases >= 6 THEN rent_max            END)::numeric(10,2) AS rent_max
FROM agg
ORDER BY period_end;

-- ----------------------------------------------------------------------------
-- Item 8 (E) — declare the canonical closed-sale price-realization basis via
-- column comments so the two DOM / %-of-ask forks can never be conflated.
-- The EXPORT (Data_DOM_Ask) reads cm_dialysis_dom_pct_ask_m — % of ORIGINAL
-- LIST (sold_price / initial_price). cm_dialysis_dom_pct_ask_q computes % of
-- LAST ask (sold_price / last_price) and is NOT consumed by the export.
-- ----------------------------------------------------------------------------
COMMENT ON COLUMN cm_dialysis_dom_pct_ask_m.pct_of_ask IS
  'CANONICAL (report basis): sale price as % of ORIGINAL LIST price (sold_price / initial_price), TTM avg. This is the value the CM export Data_DOM_Ask sheet reads. Label it "% of Original List".';
COMMENT ON COLUMN cm_dialysis_dom_pct_ask_q.pct_of_ask IS
  'NON-CANONICAL fork: sale price as % of LAST ask (sold_price / last_price), TTM avg. NOT consumed by the CM export. If ever surfaced, label it "% of Last Ask" — do not conflate with the % of Original List basis used by the report.';
