-- Migration: dia CM chart views — Round 68-A follow-up: close the synthetic price/cap leak
-- Project: Dialysis_DB (zqzrriwuavgrquhisnoa).
--
-- DEFECT (found 2026-06-05, post-backfill audit):
-- The Round 68-A synthesis was specified "price-less by construction" and
-- 20260605_cm_round68a_synthetic_listing_views.sql therefore asserted that the
-- cap/price CHILD views built on cm_dialysis_active_listings_* (asking_cap_
-- quartiles_active_m/q, asking_cap_by_term_m, available_cap_dot,
-- on_market_snapshot_q) plus cm_dialysis_available_market_size_q.avg_cap_* were
-- "cap/price-safe WITHOUT a guard because synthetic rows carry NULL cap/price".
--
-- That assumption is FALSE in prod: 1,207 synthetic rows all carry sold_price and
-- ~34 also carry last_price / initial_price / cap_rate. The result is a real leak
-- of synthetic (imputed) listings into PRICE-DERIVED chart metrics:
--   * 84 synthetic (listing x quarter) rows with an in-band cap (0.04-0.12) reach
--     cm_dialysis_active_listings_q across 38 quarters (2015-06 .. 2025-09),
--     contaminating the asking-cap quartile / cap-by-term / cap-dot / on-market-
--     snapshot series and available_market_size avg_cap_total / avg_cap_core_10plus.
-- This violates the R68-A hard constraint: "Synthetic rows must never feed
-- price-derived metrics." The 6 explicitly-guarded EXCLUDE views (DOM & % of Ask,
-- Bid-Ask, Seller Sentiment) were already safe and are unchanged.
--
-- FIX (structural, invariant to row data):
-- 1. cm_dialysis_active_listings_m / _q — NULL last_cap_rate, last_price,
--    initial_price and force had_price_change=false for data_source=
--    'synthetic_from_sale'. Every cap/price child band/NULL-filters on these, so
--    this single guard at the active-listings layer propagates to ALL FIVE child
--    views with no per-child edit. is_core_10plus / listing_id / firm_term /
--    period_end are untouched, so the active-universe COUNT charts (which INCLUDE
--    synthetic) are byte-identical.
-- 2. cm_dialysis_available_market_size_q — this view reads available_listings
--    directly; exclude synthetic from avg_cap_total / avg_cap_core_10plus while
--    KEEPING them in count_total / count_core_10plus (the INCLUDE side).
-- 3. Data hygiene — NULL the ask-price/cap columns on the synthetic rows so the
--    raw table matches the "price-less by construction" contract. Safe + durable:
--    trg_listing_cap_rate_snapshot() no-ops when COALESCE(last_price,initial_price)
--    IS NULL, so it will NOT recompute a cap after this UPDATE; the other
--    available_listings triggers fire on broker/status/date columns, not these.
--    sold_date / off_market_date / sale_transaction_id are preserved (the INCLUDE
--    views need them); sold_price is preserved (DOM view is data_source-guarded and
--    sold_price keeps the status='sold' row internally consistent).
--
-- Column names / order / types preserved exactly (CREATE OR REPLACE VIEW is
-- append-only — CLAUDE.md BD gotcha #1). Only WHERE/SELECT expressions change.

-- ===========================================================================
-- 1) Active Listings (monthly) — synthetic price/cap nulled at the source layer
-- ===========================================================================
CREATE OR REPLACE VIEW public.cm_dialysis_active_listings_m AS
 WITH month_anchors AS (
         SELECT (date_trunc('month'::text, g.d) + '1 mon -1 days'::interval)::date AS period_end
           FROM generate_series('2010-01-01'::date::timestamp with time zone, cm_last_completed_quarter_end()::timestamp with time zone, '1 mon'::interval) g(d)
        ), active_pairs AS (
         SELECT q.period_end,
            al.listing_id,
            al.property_id,
            al.listing_date,
            CASE WHEN al.data_source = 'synthetic_from_sale' THEN NULL::numeric(15,2) ELSE al.last_price END AS last_price,
            CASE WHEN al.data_source = 'synthetic_from_sale' THEN NULL::numeric ELSE COALESCE(al.cap_rate, al.last_cap_rate, al.current_cap_rate) END AS last_cap_rate,
            CASE WHEN al.data_source = 'synthetic_from_sale' THEN NULL::numeric(15,2) ELSE al.initial_price END AS initial_price,
            al.seller_name,
            p.operator,
            p.tenant,
            p.building_name,
            p.true_owner_name,
            CASE WHEN al.data_source = 'synthetic_from_sale' THEN NULL::integer
                 ELSE q.period_end - al.listing_date END AS days_on_market,
            CASE WHEN al.data_source = 'synthetic_from_sale' THEN false
                 ELSE al.initial_price IS NOT NULL AND al.last_price IS NOT NULL AND al.initial_price <> al.last_price END AS had_price_change,
            ( SELECT EXTRACT(epoch FROM l.lease_expiration::timestamp without time zone - q.period_end::timestamp without time zone) / (86400.0 * 365.25)
                   FROM leases l
                  WHERE l.property_id = al.property_id AND l.is_active = true AND (lower(COALESCE(l.status, ''::text)) <> ALL (ARRAY['superseded'::text, 'superseded_duplicate'::text, 'expired'::text, 'terminated'::text, 'placeholder'::text, 'closed'::text, 'closed but obligated'::text])) AND l.lease_expiration IS NOT NULL AND l.lease_expiration >= q.period_end AND (l.lease_start IS NULL OR l.lease_start <= q.period_end)
                  ORDER BY l.lease_expiration DESC
                 LIMIT 1) AS firm_term_years
           FROM month_anchors q
             JOIN available_listings al ON al.listing_date IS NOT NULL AND al.listing_date <= q.period_end AND (al.sold_date IS NULL OR al.sold_date > q.period_end) AND (al.off_market_date IS NOT NULL AND al.off_market_date > q.period_end OR al.off_market_date IS NULL AND COALESCE(al.last_seen, al.url_last_checked, al.last_verified_at::date, al.listing_date) >= (q.period_end - '120 days'::interval)::date) AND (al.is_active = true OR al.data_source = 'synthetic_from_sale' OR (lower(COALESCE(al.status, ''::character varying)::text) = ANY (ARRAY['active'::text, 'available'::text, 'for sale'::text, 'under contract'::text, 'draft-commenced'::text, 'superseded'::text])))
             LEFT JOIN properties p ON p.property_id = al.property_id
        )
 SELECT active_pairs.period_end,
    'all'::text AS subspecialty,
    active_pairs.listing_id,
    active_pairs.property_id,
    active_pairs.listing_date,
    active_pairs.days_on_market,
    active_pairs.last_price,
    active_pairs.last_cap_rate,
    active_pairs.initial_price,
    active_pairs.had_price_change,
    active_pairs.firm_term_years,
    active_pairs.firm_term_years >= 10::numeric AS is_core_10plus
   FROM active_pairs;

-- ===========================================================================
-- 2) Active Listings (quarterly) — same source-layer guard
-- ===========================================================================
CREATE OR REPLACE VIEW public.cm_dialysis_active_listings_q AS
 WITH quarter_anchors AS (
         SELECT (date_trunc('quarter'::text, g.d) + '3 mons -1 days'::interval)::date AS period_end
           FROM generate_series('2013-01-01'::date::timestamp with time zone, cm_last_completed_quarter_end()::timestamp with time zone, '3 mons'::interval) g(d)
        ), active_pairs AS (
         SELECT q.period_end,
            al.listing_id,
            al.property_id,
            al.listing_date,
            CASE WHEN al.data_source = 'synthetic_from_sale' THEN NULL::numeric(15,2) ELSE al.last_price END AS last_price,
            CASE WHEN al.data_source = 'synthetic_from_sale' THEN NULL::numeric ELSE COALESCE(al.cap_rate, al.last_cap_rate, al.current_cap_rate) END AS last_cap_rate,
            CASE WHEN al.data_source = 'synthetic_from_sale' THEN NULL::numeric(15,2) ELSE al.initial_price END AS initial_price,
            al.seller_name,
            p.operator,
            p.tenant,
            p.building_name,
            p.true_owner_name,
            CASE WHEN al.data_source = 'synthetic_from_sale' THEN NULL::integer
                 ELSE q.period_end - al.listing_date END AS days_on_market,
            CASE WHEN al.data_source = 'synthetic_from_sale' THEN false
                 ELSE al.initial_price IS NOT NULL AND al.last_price IS NOT NULL AND al.initial_price <> al.last_price END AS had_price_change,
            ( SELECT EXTRACT(epoch FROM l.lease_expiration::timestamp without time zone - q.period_end::timestamp without time zone) / (86400.0 * 365.25)
                   FROM leases l
                  WHERE l.property_id = al.property_id AND l.is_active = true AND (lower(COALESCE(l.status, ''::text)) <> ALL (ARRAY['superseded'::text, 'superseded_duplicate'::text, 'expired'::text, 'terminated'::text, 'placeholder'::text, 'closed'::text, 'closed but obligated'::text])) AND l.lease_expiration IS NOT NULL AND l.lease_expiration >= q.period_end AND (l.lease_start IS NULL OR l.lease_start <= q.period_end)
                  ORDER BY l.lease_expiration DESC
                 LIMIT 1) AS firm_term_years
           FROM quarter_anchors q
             JOIN available_listings al ON al.listing_date IS NOT NULL AND al.listing_date <= q.period_end AND (al.off_market_date IS NULL OR al.off_market_date > q.period_end) AND (al.sold_date IS NULL OR al.sold_date > q.period_end) AND (al.is_active = true OR al.data_source = 'synthetic_from_sale' OR (lower(COALESCE(al.status, ''::character varying)::text) = ANY (ARRAY['active'::text, 'available'::text, 'for sale'::text, 'under contract'::text, 'draft-commenced'::text, 'superseded'::text])))
             LEFT JOIN properties p ON p.property_id = al.property_id
        )
 SELECT active_pairs.period_end,
    'all'::text AS subspecialty,
    active_pairs.listing_id,
    active_pairs.property_id,
    active_pairs.listing_date,
    active_pairs.days_on_market,
    active_pairs.last_price,
    active_pairs.last_cap_rate,
    active_pairs.initial_price,
    active_pairs.had_price_change,
    active_pairs.firm_term_years,
    active_pairs.firm_term_years >= 10::numeric AS is_core_10plus,
        CASE
            WHEN active_pairs.operator ~~* '%davita%'::text THEN 'DaVita'::text
            WHEN active_pairs.operator ~~* '%fresenius%'::text OR active_pairs.operator ~~* '%fmc%'::text OR active_pairs.operator ~~* '%fkc%'::text THEN 'FMC'::text
            WHEN active_pairs.operator ~~* '%u.s. renal%'::text OR active_pairs.operator ~~* '%us renal%'::text OR active_pairs.operator ~~* '%usrc%'::text THEN 'US Renal'::text
            WHEN active_pairs.operator IS NOT NULL AND TRIM(BOTH FROM active_pairs.operator) <> ''::text THEN 'Other'::text
            WHEN active_pairs.seller_name ~~* '%davita%'::text THEN 'DaVita'::text
            WHEN active_pairs.seller_name ~~* '%fresenius%'::text OR active_pairs.seller_name ~~* '%fmc%'::text OR active_pairs.seller_name ~~* '%fkc%'::text THEN 'FMC'::text
            WHEN active_pairs.seller_name ~~* '%u.s. renal%'::text OR active_pairs.seller_name ~~* '%us renal%'::text OR active_pairs.seller_name ~~* '%usrc%'::text THEN 'US Renal'::text
            WHEN active_pairs.tenant::text ~~* '%davita%'::text THEN 'DaVita'::text
            WHEN active_pairs.tenant::text ~~* '%fresenius%'::text OR active_pairs.tenant::text ~~* '%fmc%'::text OR active_pairs.tenant::text ~~* '%fkc%'::text THEN 'FMC'::text
            WHEN active_pairs.tenant::text ~~* '%u.s. renal%'::text OR active_pairs.tenant::text ~~* '%us renal%'::text OR active_pairs.tenant::text ~~* '%usrc%'::text THEN 'US Renal'::text
            WHEN active_pairs.building_name ~~* '%davita%'::text THEN 'DaVita'::text
            WHEN active_pairs.building_name ~~* '%fresenius%'::text OR active_pairs.building_name ~~* '%fmc%'::text OR active_pairs.building_name ~~* '%fkc%'::text THEN 'FMC'::text
            WHEN active_pairs.building_name ~~* '%u.s. renal%'::text OR active_pairs.building_name ~~* '%us renal%'::text OR active_pairs.building_name ~~* '%usrc%'::text THEN 'US Renal'::text
            WHEN active_pairs.true_owner_name ~~* '%davita%'::text THEN 'DaVita'::text
            WHEN active_pairs.true_owner_name ~~* '%fresenius%'::text OR active_pairs.true_owner_name ~~* '%fmc%'::text OR active_pairs.true_owner_name ~~* '%fkc%'::text THEN 'FMC'::text
            WHEN active_pairs.true_owner_name ~~* '%u.s. renal%'::text OR active_pairs.true_owner_name ~~* '%us renal%'::text OR active_pairs.true_owner_name ~~* '%usrc%'::text THEN 'US Renal'::text
            WHEN (active_pairs.seller_name IS NULL OR TRIM(BOTH FROM active_pairs.seller_name) = ''::text) AND (active_pairs.tenant IS NULL OR TRIM(BOTH FROM active_pairs.tenant) = ''::text) AND (active_pairs.building_name IS NULL OR TRIM(BOTH FROM active_pairs.building_name) = ''::text) AND (active_pairs.true_owner_name IS NULL OR TRIM(BOTH FROM active_pairs.true_owner_name) = ''::text) THEN 'Unknown'::text
            ELSE 'Other'::text
        END AS tenant_bucket,
    active_pairs.operator
   FROM active_pairs;

-- ===========================================================================
-- 3) Available Market Size — keep synthetic in the COUNTS, drop from avg_cap_*
-- ===========================================================================
CREATE OR REPLACE VIEW public.cm_dialysis_available_market_size_q AS
 WITH quarter_anchors AS (
   SELECT (date_trunc('quarter', g.d) + '3 mons -1 days'::interval)::date AS period_end
   FROM generate_series('2013-01-01'::date::timestamptz, cm_last_completed_quarter_end()::timestamptz, '3 mons'::interval) g(d)
 ), sentinel_dates AS (
   SELECT listing_date FROM available_listings
   WHERE listing_date IS NOT NULL AND data_source IS DISTINCT FROM 'synthetic_from_sale'
   GROUP BY listing_date HAVING count(*) >= 15
 ), marketed AS (
   SELECT q.period_end,
     al.listing_id,
     (al.data_source IS NOT DISTINCT FROM 'synthetic_from_sale') AS is_synth,  -- NULL-safe: organic rows carry data_source=NULL
     COALESCE(al.cap_rate, al.last_cap_rate, al.current_cap_rate) AS cap,
     (( SELECT EXTRACT(epoch FROM l.lease_expiration::timestamp without time zone - q.period_end::timestamp without time zone) / (86400.0 * 365.25)
          FROM leases l
         WHERE l.property_id = al.property_id AND l.is_active = true
           AND (lower(COALESCE(l.status, ''::text)) <> ALL (ARRAY['superseded'::text, 'superseded_duplicate'::text, 'expired'::text, 'terminated'::text, 'placeholder'::text, 'closed'::text, 'closed but obligated'::text]))
           AND l.lease_expiration IS NOT NULL AND l.lease_expiration >= q.period_end AND (l.lease_start IS NULL OR l.lease_start <= q.period_end)
         ORDER BY l.lease_expiration DESC LIMIT 1)) >= 10::numeric AS is_core
   FROM quarter_anchors q
   JOIN available_listings al ON al.listing_date IS NOT NULL
     AND al.listing_date > (q.period_end - '1 year'::interval)::date
     AND al.listing_date <= q.period_end
     AND NOT (al.sold_date IS NOT NULL AND al.sold_date <= al.listing_date)
     AND (al.data_source = 'synthetic_from_sale' OR al.listing_date NOT IN (SELECT listing_date FROM sentinel_dates))
 )
 SELECT marketed.period_end,
   'all'::text AS subspecialty,
   count(*) AS count_total,
   count(*) FILTER (WHERE marketed.is_core) AS count_core_10plus,
   avg(marketed.cap) FILTER (WHERE NOT marketed.is_synth AND marketed.cap >= 0.04 AND marketed.cap <= 0.12) AS avg_cap_total,
   CASE WHEN count(*) FILTER (WHERE NOT marketed.is_synth AND marketed.is_core AND marketed.cap >= 0.04 AND marketed.cap <= 0.12) >= 3
        THEN avg(marketed.cap) FILTER (WHERE NOT marketed.is_synth AND marketed.is_core AND marketed.cap >= 0.04 AND marketed.cap <= 0.12)
        ELSE NULL::numeric END AS avg_cap_core_10plus
 FROM marketed
 GROUP BY marketed.period_end
 HAVING count(*) >= 5
 ORDER BY marketed.period_end;

-- ===========================================================================
-- 4) Data hygiene — make the raw synthetic rows truly price-less (idempotent).
-- Safe: trg_listing_cap_rate_snapshot() no-ops when last_price+initial_price are
-- NULL, so it will not recompute cap_rate after this write. sold_price /
-- sold_date / off_market_date / sale_transaction_id are intentionally retained.
-- ===========================================================================
UPDATE public.available_listings
   SET last_price       = NULL,
       initial_price    = NULL,
       cap_rate         = NULL,
       last_cap_rate    = NULL,
       current_cap_rate = NULL,
       initial_cap_rate = NULL
 WHERE data_source = 'synthetic_from_sale'
   AND (last_price IS NOT NULL OR initial_price IS NOT NULL OR cap_rate IS NOT NULL
        OR last_cap_rate IS NOT NULL OR current_cap_rate IS NOT NULL OR initial_cap_rate IS NOT NULL);
