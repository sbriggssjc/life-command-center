-- R4-B: gov overview server-side aggregates — true totals, not page caps.
--
-- The live overview was computing several headline numbers client-side over
-- page-limited arrays (sales .limit(1000), gsa .limit(500), frpp .limit(5000),
-- leads .limit(1000)) and labeling the LIMIT as a TOTAL. This rebuilds
-- mv_gov_overview_stats so every headline number is a server-side aggregate
-- over the full table, and fixes the lease-expiration semantics.
--
-- Lease-expiration forensic (2026-06-04): the "EXPIRING < 1 YEAR = 7,722"
-- number was bucketed off `firm_term_remaining`, which is correctly clamped to
-- 0 once the FIRM term elapses (a 5yr-firm lease inside a 15yr term hits 0 the
-- day firm term ends, even though the lease runs another decade). 7,320 seasoned
-- excel_master leases pile into the 0-1yr bucket that way. Bucketing off the
-- ACTUAL lease_expiration date instead gives the defensible distribution:
--   already expired (incl. ~4,798 stale/holdover, 4,002 expired >1yr ago) |
--   <6mo=407 | <1yr=793 | 1-2yr=692 | 2-5yr=1,434 | 5+yr=2,858.
-- firm-term fields are KEPT (firm term is a real risk metric) but the dashboard
-- "Lease Expiration" tiles switch to the lease_expiration buckets.
--
-- Idempotent: DROP MATERIALIZED VIEW IF EXISTS + CREATE (Postgres has no
-- CREATE OR REPLACE MATERIALIZED VIEW). No other object depends on it.

DROP MATERIALIZED VIEW IF EXISTS public.mv_gov_overview_stats CASCADE;

CREATE MATERIALIZED VIEW public.mv_gov_overview_stats AS
WITH prop_stats AS (
  SELECT
    count(*) AS total_properties,
    count(*) FILTER (WHERE sf_leased > 0) AS properties_with_sf,
    COALESCE(sum(sf_leased) FILTER (WHERE sf_leased > 0), 0)::bigint AS total_sf,
    COALESCE(sum(gross_rent), 0) AS total_gross_rent,
    count(*) FILTER (WHERE gross_rent_psf > 0) AS properties_with_rent_psf,
    CASE WHEN count(*) FILTER (WHERE gross_rent_psf > 0) > 0
         THEN round(avg(gross_rent_psf) FILTER (WHERE gross_rent_psf > 0), 2) ELSE 0 END AS avg_rent_psf,
    count(DISTINCT agency) FILTER (WHERE agency IS NOT NULL AND agency !~* 'SERVICES DIVISION$') AS agencies_tracked,
    COALESCE(sum(noi), 0) AS total_noi,
    -- firm-term cohort (kept for the firm-term tiles)
    count(*) FILTER (WHERE firm_term_remaining IS NOT NULL) AS properties_with_term,
    count(*) FILTER (WHERE firm_term_remaining <= 1) AS expiring_lt_1yr,
    count(*) FILTER (WHERE firm_term_remaining <= 2) AS expiring_lt_2yr,
    count(*) FILTER (WHERE firm_term_remaining > 2 AND firm_term_remaining <= 5) AS term_2_5yr,
    count(*) FILTER (WHERE firm_term_remaining > 5) AS term_5plus,
    CASE WHEN count(*) FILTER (WHERE firm_term_remaining IS NOT NULL) > 0
         THEN round(avg(firm_term_remaining) FILTER (WHERE firm_term_remaining IS NOT NULL), 1) ELSE 0 END AS avg_firm_term,
    -- lease-expiration cohort (actual lease_expiration date — the correct
    -- field for "lease expiration risk")
    count(*) FILTER (WHERE lease_expiration IS NOT NULL) AS properties_with_lease_exp,
    count(*) FILTER (WHERE lease_expiration < CURRENT_DATE) AS lease_expired_count,
    count(*) FILTER (WHERE lease_expiration < CURRENT_DATE - INTERVAL '1 year') AS lease_expired_stale,
    count(*) FILTER (WHERE lease_expiration >= CURRENT_DATE AND lease_expiration < CURRENT_DATE + INTERVAL '6 months') AS exp_lease_lt_6mo,
    count(*) FILTER (WHERE lease_expiration >= CURRENT_DATE AND lease_expiration < CURRENT_DATE + INTERVAL '1 year') AS exp_lease_lt_1yr,
    count(*) FILTER (WHERE lease_expiration >= CURRENT_DATE + INTERVAL '1 year' AND lease_expiration < CURRENT_DATE + INTERVAL '2 years') AS exp_lease_1_2yr,
    count(*) FILTER (WHERE lease_expiration >= CURRENT_DATE + INTERVAL '2 years' AND lease_expiration < CURRENT_DATE + INTERVAL '5 years') AS exp_lease_2_5yr,
    count(*) FILTER (WHERE lease_expiration >= CURRENT_DATE + INTERVAL '5 years') AS exp_lease_5plus
  FROM properties
),
lease_buckets AS (
  -- legacy firm-term distribution (kept for back-compat consumers)
  SELECT jsonb_build_array(
    jsonb_build_object('label','Expired / < 0 yrs','count',count(*) FILTER (WHERE firm_term_remaining < 0),'color','#ef4444'),
    jsonb_build_object('label','0 – 1 years','count',count(*) FILTER (WHERE firm_term_remaining >= 0 AND firm_term_remaining <= 1),'color','#f87171'),
    jsonb_build_object('label','1 – 2 years','count',count(*) FILTER (WHERE firm_term_remaining > 1 AND firm_term_remaining <= 2),'color','#fb923c'),
    jsonb_build_object('label','2 – 3 years','count',count(*) FILTER (WHERE firm_term_remaining > 2 AND firm_term_remaining <= 3),'color','#fbbf24'),
    jsonb_build_object('label','3 – 5 years','count',count(*) FILTER (WHERE firm_term_remaining > 3 AND firm_term_remaining <= 5),'color','#34d399'),
    jsonb_build_object('label','5 – 10 years','count',count(*) FILTER (WHERE firm_term_remaining > 5 AND firm_term_remaining <= 10),'color','#22d3ee'),
    jsonb_build_object('label','10+ years','count',count(*) FILTER (WHERE firm_term_remaining > 10),'color','#60a5fa')
  ) AS lease_distribution
  FROM properties WHERE firm_term_remaining IS NOT NULL
),
lease_exp_buckets AS (
  -- authoritative distribution by actual lease_expiration date
  SELECT jsonb_build_array(
    jsonb_build_object('label','Expired / holdover','count',count(*) FILTER (WHERE lease_expiration < CURRENT_DATE),'color','#ef4444'),
    jsonb_build_object('label','< 6 months','count',count(*) FILTER (WHERE lease_expiration >= CURRENT_DATE AND lease_expiration < CURRENT_DATE + INTERVAL '6 months'),'color','#f87171'),
    jsonb_build_object('label','6 – 12 months','count',count(*) FILTER (WHERE lease_expiration >= CURRENT_DATE + INTERVAL '6 months' AND lease_expiration < CURRENT_DATE + INTERVAL '1 year'),'color','#fb923c'),
    jsonb_build_object('label','1 – 2 years','count',count(*) FILTER (WHERE lease_expiration >= CURRENT_DATE + INTERVAL '1 year' AND lease_expiration < CURRENT_DATE + INTERVAL '2 years'),'color','#fbbf24'),
    jsonb_build_object('label','2 – 5 years','count',count(*) FILTER (WHERE lease_expiration >= CURRENT_DATE + INTERVAL '2 years' AND lease_expiration < CURRENT_DATE + INTERVAL '5 years'),'color','#34d399'),
    jsonb_build_object('label','5+ years','count',count(*) FILTER (WHERE lease_expiration >= CURRENT_DATE + INTERVAL '5 years'),'color','#60a5fa')
  ) AS lease_distribution_by_expiry
  FROM properties WHERE lease_expiration IS NOT NULL
),
agency_agg AS (
  SELECT agency AS name, count(*) AS cnt, COALESCE(sum(gross_rent),0) AS rent,
         COALESCE(sum(sf_leased),0)::bigint AS sf,
         COALESCE(sum(firm_term_remaining) FILTER (WHERE firm_term_remaining IS NOT NULL),0) AS term_sum,
         count(*) FILTER (WHERE firm_term_remaining IS NOT NULL) AS term_count
  FROM properties
  -- R4-B agency-pollution guard: USPS facility "* SERVICES DIVISION" rows are
  -- vendor/division names, not leasing agencies — keep them out of rollups.
  WHERE agency IS NOT NULL AND agency !~* 'SERVICES DIVISION$'
  GROUP BY agency
),
top_agencies_by_count AS (
  SELECT jsonb_agg(jsonb_build_object('name',name,'count',cnt,'rent',rent,'sf',sf,'termSum',term_sum,'termCount',term_count) ORDER BY cnt DESC) AS j
  FROM (SELECT * FROM agency_agg ORDER BY cnt DESC LIMIT 12) t
),
top_agencies_by_rent AS (
  SELECT jsonb_agg(jsonb_build_object('name',name,'count',cnt,'rent',rent) ORDER BY rent DESC) AS j
  FROM (SELECT * FROM agency_agg ORDER BY rent DESC LIMIT 10) t
),
state_agg AS (
  SELECT state AS name, count(*) AS cnt, COALESCE(sum(gross_rent),0) AS rent, COALESCE(sum(sf_leased),0)::bigint AS sf
  FROM properties WHERE state IS NOT NULL GROUP BY state
),
top_states_by_count AS (
  SELECT jsonb_agg(jsonb_build_object('name',name,'count',cnt,'rent',rent,'sf',sf) ORDER BY cnt DESC) AS j
  FROM (SELECT * FROM state_agg ORDER BY cnt DESC LIMIT 10) t
),
top_states_by_rent AS (
  SELECT jsonb_agg(jsonb_build_object('name',name,'rent',rent) ORDER BY rent DESC) AS j
  FROM (SELECT * FROM state_agg ORDER BY rent DESC LIMIT 10) t
),
contact_stats AS (SELECT count(*) AS total_contacts FROM contacts),
listing_stats AS (
  SELECT count(*) AS active_listings,
         round(avg(asking_cap_rate),4) AS avg_asking_cap,
         round(avg(asking_price),2) AS avg_asking_price
  FROM available_listings
),
ownership_stats AS (
  SELECT count(*) AS total_changes,
         count(*) FILTER (WHERE sale_price > 0) AS with_sale_price,
         COALESCE(sum(sale_price) FILTER (WHERE sale_price > 0),0) AS confirmed_value,
         count(*) FILTER (WHERE research_status IS NULL OR research_status='pending') AS needs_research
  FROM ownership_history
),
loan_stats AS (SELECT count(*) AS total_loans FROM loans),
sale_stats AS (
  SELECT count(*) AS total_sales,
         round(avg(sold_cap_rate) FILTER (WHERE sold_cap_rate > 0.01 AND sold_cap_rate < 0.25),4) AS avg_sold_cap_rate,
         count(*) FILTER (WHERE sold_cap_rate > 0.01 AND sold_cap_rate < 0.25) AS sales_with_cap,
         count(*) FILTER (WHERE sold_price > 0) AS sales_priced_count,
         COALESCE(sum(sold_price) FILTER (WHERE sold_price > 0),0) AS sales_total_volume,
         round(avg(sold_price) FILTER (WHERE sold_price > 0)) AS sales_avg_price,
         count(*) FILTER (WHERE sale_date >= CURRENT_DATE - INTERVAL '12 months') AS sales_ttm_count,
         COALESCE(sum(sold_price) FILTER (WHERE sold_price > 0 AND sale_date >= CURRENT_DATE - INTERVAL '12 months'),0) AS sales_ttm_volume
  FROM sales_transactions
),
lead_stats AS (
  SELECT count(*) AS total_leads,
         count(*) FILTER (WHERE lead_temperature='hot') AS hot_leads,
         count(*) FILTER (WHERE lead_temperature='warm') AS warm_leads,
         count(*) FILTER (WHERE lead_temperature='cold') AS cold_leads,
         count(*) FILTER (WHERE estimated_value > 0) AS leads_with_value,
         COALESCE(sum(estimated_value) FILTER (WHERE estimated_value > 0),0) AS pipeline_value_total,
         round(avg(estimated_value) FILTER (WHERE estimated_value > 0)) AS avg_lead_value
  FROM prospect_leads
),
gsa_stats AS (
  SELECT
    (SELECT count(*) FROM gsa_lease_events) AS gsa_events_total,
    (SELECT count(*) FROM gsa_lease_events WHERE event_date >= date_trunc('year', CURRENT_DATE)) AS gsa_events_ytd,
    (SELECT count(*) FROM gsa_leases) AS gsa_leases_tracked,
    (SELECT COALESCE(sum(annual_rent) FILTER (WHERE annual_rent > 0),0) FROM gsa_leases) AS gsa_current_annual_rent
),
frpp_stats AS (
  SELECT count(*) AS frpp_total,
         COALESCE(sum(square_feet),0)::bigint AS frpp_total_sf,
         COALESCE(sum(annual_rent_to_lessor),0) AS frpp_total_rent,
         count(DISTINCT using_agency) AS frpp_distinct_agencies
  FROM frpp_records
)
SELECT
  p.total_properties, p.properties_with_sf, p.total_sf, p.total_gross_rent,
  p.properties_with_rent_psf, p.avg_rent_psf, p.agencies_tracked, p.total_noi,
  p.properties_with_term, p.expiring_lt_1yr, p.expiring_lt_2yr, p.term_2_5yr,
  p.term_5plus, p.avg_firm_term,
  -- lease-expiration cohort (new, authoritative)
  p.properties_with_lease_exp, p.lease_expired_count, p.lease_expired_stale,
  p.exp_lease_lt_6mo, p.exp_lease_lt_1yr, p.exp_lease_1_2yr, p.exp_lease_2_5yr, p.exp_lease_5plus,
  leb.lease_distribution_by_expiry,
  lb.lease_distribution,
  (SELECT j FROM top_agencies_by_count) AS top_agencies_by_count,
  (SELECT j FROM top_agencies_by_rent) AS top_agencies_by_rent,
  (SELECT j FROM top_states_by_count) AS top_states_by_count,
  (SELECT j FROM top_states_by_rent) AS top_states_by_rent,
  c.total_contacts,
  li.active_listings, li.avg_asking_cap, li.avg_asking_price,
  o.total_changes, o.with_sale_price, o.confirmed_value, o.needs_research,
  ln.total_loans,
  s.total_sales, s.avg_sold_cap_rate, s.sales_with_cap,
  s.sales_priced_count, s.sales_total_volume, s.sales_avg_price, s.sales_ttm_count, s.sales_ttm_volume,
  ld.total_leads, ld.hot_leads, ld.warm_leads, ld.cold_leads,
  ld.leads_with_value, ld.pipeline_value_total, ld.avg_lead_value,
  g.gsa_events_total, g.gsa_events_ytd, g.gsa_leases_tracked, g.gsa_current_annual_rent,
  f.frpp_total, f.frpp_total_sf, f.frpp_total_rent, f.frpp_distinct_agencies,
  now() AS computed_at
FROM prop_stats p, lease_buckets lb, lease_exp_buckets leb, contact_stats c,
     listing_stats li, ownership_stats o, loan_stats ln, sale_stats s, lead_stats ld,
     gsa_stats g, frpp_stats f;

CREATE INDEX IF NOT EXISTS mv_gov_overview_stats_computed_at_idx
  ON public.mv_gov_overview_stats (computed_at);

REFRESH MATERIALIZED VIEW public.mv_gov_overview_stats;
