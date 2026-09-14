-- ============================================================================
-- CM historical as-of — period_end-keyed reconstruction of the dialysis
-- available-listing snapshot feeds.
-- ============================================================================
--
-- CONTEXT (G2 gap, 2026-08-07): the Capital Markets exporter can already
-- regenerate a workbook "as of" any completed quarter for its TIME-SERIES
-- sheets, and the on-market cohort table (cm_dialysis_on_market_snapshot_q)
-- already reconstructs the active-listing set at every quarter end. But three
-- snapshot feeds were CURRENT-SNAPSHOT ONLY — each wrapped
-- cm_dialysis_active_listings_q filtered to max(period_end):
--
--   * cm_dialysis_available_by_tenant       (tenant donuts + tenant table)
--   * cm_dialysis_available_by_term_bucket  (by-term summary combo)
--   * cm_dialysis_available_cap_dot         (available cap-rate dot cloud)
--
-- So a "2026-03-31" export mislabeled TODAY's active inventory as the Q1 set.
--
-- FIX: this migration adds period_end-keyed `_q` variants whose bodies are
-- byte-for-byte the current view logic MINUS the `latest` filter — they emit
-- one group per quarter anchor that cm_dialysis_active_listings_q already
-- reconstructs (2013-Q1 → last completed quarter). The exporter selects the
-- requested quarter (the greatest period_end <= as_of); selecting the latest
-- quarter reproduces the current views exactly (zero regression).
--
-- Discipline: additive · non-destructive · SECURITY INVOKER (inherits the
-- caller's grants, same as the base views) · reversible (DROP VIEW). The
-- current-snapshot views are left in place untouched.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Available by tenant, keyed by quarter end.
--    Body == cm_dialysis_available_by_tenant minus the `latest` CTE/join;
--    GROUP BY now carries period_end so every quarter emits its own tenant mix.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.cm_dialysis_available_by_tenant_q AS
SELECT
    al.period_end,
    'all'::text AS subspecialty,
    al.tenant_bucket AS tenant,
    count(*) AS count_active,
    sum(al.last_price) AS volume_available,
    avg(al.last_price) FILTER (WHERE al.last_price >= 100000::numeric AND al.last_price <= 30000000::numeric) AS avg_deal_size,
    avg(al.firm_term_years) FILTER (WHERE al.firm_term_years >= 0::numeric AND al.firm_term_years <= 30::numeric) AS avg_firm_term_years,
    avg(al.last_cap_rate) FILTER (WHERE al.last_cap_rate >= 0.04 AND al.last_cap_rate <= 0.12) AS avg_asking_cap,
    avg(al.days_on_market) FILTER (WHERE al.days_on_market >= 0 AND al.days_on_market <= 730) AS avg_dom,
    CASE al.tenant_bucket
        WHEN 'DaVita'::text THEN 1
        WHEN 'FMC'::text THEN 2
        WHEN 'US Renal'::text THEN 3
        WHEN 'Other'::text THEN 4
        WHEN 'Unknown'::text THEN 5
        ELSE 99
    END AS sort_order
FROM cm_dialysis_active_listings_q al
GROUP BY al.period_end, al.tenant_bucket
ORDER BY al.period_end DESC,
    CASE al.tenant_bucket
        WHEN 'DaVita'::text THEN 1
        WHEN 'FMC'::text THEN 2
        WHEN 'US Renal'::text THEN 3
        WHEN 'Other'::text THEN 4
        WHEN 'Unknown'::text THEN 5
        ELSE 99
    END;

-- ----------------------------------------------------------------------------
-- 2. Available by term bucket, keyed by quarter end.
--    Body == cm_dialysis_available_by_term_bucket minus the `latest` join;
--    the DISTINCT ON property dedup is now scoped PER period_end.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.cm_dialysis_available_by_term_bucket_q AS
WITH dedup AS (
    SELECT DISTINCT ON (al.period_end, al.property_id)
        al.period_end,
        al.property_id,
        al.firm_term_years,
        al.last_price,
        al.last_cap_rate
    FROM cm_dialysis_active_listings_q al
    ORDER BY al.period_end, al.property_id, al.firm_term_years DESC NULLS LAST, al.listing_id
), bucketed AS (
    SELECT
        d.period_end,
        CASE
            WHEN d.firm_term_years IS NULL THEN 'Undisclosed Term'::text
            WHEN d.firm_term_years < 5::numeric THEN 'Sub 5 Year Term'::text
            WHEN d.firm_term_years < 8::numeric THEN '5-8 Year Term'::text
            WHEN d.firm_term_years < 12::numeric THEN '8-12 Year Term'::text
            ELSE '12+ Year Term'::text
        END AS term_bucket,
        CASE
            WHEN d.firm_term_years IS NULL THEN 5
            WHEN d.firm_term_years < 5::numeric THEN 1
            WHEN d.firm_term_years < 8::numeric THEN 2
            WHEN d.firm_term_years < 12::numeric THEN 3
            ELSE 4
        END AS sort_order,
        d.last_price,
        d.last_cap_rate
    FROM dedup d
)
SELECT
    bucketed.period_end,
    'all'::text AS subspecialty,
    bucketed.term_bucket,
    bucketed.sort_order,
    count(*) AS n_listings,
    avg(bucketed.last_price) FILTER (WHERE bucketed.last_price >= 100000::numeric AND bucketed.last_price <= 30000000::numeric) AS avg_price,
    percentile_cont(0.25::double precision) WITHIN GROUP (ORDER BY (bucketed.last_cap_rate::double precision)) FILTER (WHERE bucketed.last_cap_rate >= 0.04 AND bucketed.last_cap_rate <= 0.12) AS lower_quartile_cap,
    percentile_cont(0.50::double precision) WITHIN GROUP (ORDER BY (bucketed.last_cap_rate::double precision)) FILTER (WHERE bucketed.last_cap_rate >= 0.04 AND bucketed.last_cap_rate <= 0.12) AS median_cap,
    percentile_cont(0.75::double precision) WITHIN GROUP (ORDER BY (bucketed.last_cap_rate::double precision)) FILTER (WHERE bucketed.last_cap_rate >= 0.04 AND bucketed.last_cap_rate <= 0.12) AS upper_quartile_cap,
    avg(bucketed.last_cap_rate) FILTER (WHERE bucketed.last_cap_rate >= 0.04 AND bucketed.last_cap_rate <= 0.12) AS avg_cap
FROM bucketed
GROUP BY bucketed.period_end, bucketed.term_bucket, bucketed.sort_order
ORDER BY bucketed.period_end DESC, bucketed.sort_order;

-- ----------------------------------------------------------------------------
-- 3. Available cap-rate dot cloud, keyed by quarter end.
--    Body == cm_dialysis_available_cap_dot minus the `latest` join.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.cm_dialysis_available_cap_dot_q AS
SELECT
    al.period_end,
    al.last_cap_rate AS cap_rate,
    al.firm_term_years,
    al.is_core_10plus,
    al.last_price
FROM cm_dialysis_active_listings_q al
WHERE al.last_cap_rate IS NOT NULL
  AND al.last_cap_rate >= 0.04 AND al.last_cap_rate <= 0.12
  AND al.firm_term_years IS NOT NULL
  AND al.firm_term_years >= 0::numeric AND al.firm_term_years <= 30::numeric
ORDER BY al.period_end DESC, al.firm_term_years;

-- ----------------------------------------------------------------------------
-- Grants — mirror the base snapshot views (read by the exporter via direct
-- PostgREST, and available to the anon/authenticated roles like their siblings).
-- ----------------------------------------------------------------------------
GRANT SELECT ON public.cm_dialysis_available_by_tenant_q      TO anon, authenticated, service_role;
GRANT SELECT ON public.cm_dialysis_available_by_term_bucket_q TO anon, authenticated, service_role;
GRANT SELECT ON public.cm_dialysis_available_cap_dot_q        TO anon, authenticated, service_role;

-- ============================================================================
-- REVERSAL
--   DROP VIEW IF EXISTS public.cm_dialysis_available_by_tenant_q;
--   DROP VIEW IF EXISTS public.cm_dialysis_available_by_term_bucket_q;
--   DROP VIEW IF EXISTS public.cm_dialysis_available_cap_dot_q;
-- ============================================================================
