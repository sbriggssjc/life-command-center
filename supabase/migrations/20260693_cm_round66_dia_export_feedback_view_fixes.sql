-- =============================================================================
-- Migration: cm_dialysis Capital Markets view fixes
-- Project:   Dialysis_DB (zqzrriwuavgrquhisnoa)
-- Date:       2026-05-31
--
-- Fixes 10 Capital Markets views. All bodies were validated READ-ONLY against
-- the live DB before inclusion (executed the WITH/SELECT directly; confirmed
-- column lists match the pre-existing views exactly, and that numbers are sane:
-- cap rates in 0.04-0.12, counts non-negative, no all-NULL series where data
-- should exist).
--
-- COLUMN CONTRACT: every view returns EXACTLY the same column names in the same
-- order as before the migration. No renames, reorders, or drops. (No new columns
-- were appended either -- the downstream Excel chart mapper is fully preserved.)
--
-- Ordering matters: the upstream active-listings views are recreated first
-- because available_market_size_q / dom_price_change_active_m / asking_cap_by_term_m
-- read from them.
--
-- Shared root-cause fixes applied:
--   * firm-term lateral now requires the lease be genuinely active:
--       l.is_active = true
--       AND lower(COALESCE(l.status,'')) NOT IN
--           ('superseded','superseded_duplicate','expired','terminated',
--            'placeholder','closed','closed but obligated')
--       AND (l.lease_start IS NULL OR l.lease_start <= <anchor>)
--       AND l.lease_expiration >= <anchor>
--     (Previously superseded leases -- 4,914 rows, only 6 truly active --
--      contaminated the long-term cohort and inverted the cap structure.)
-- =============================================================================


-- -----------------------------------------------------------------------------
-- #5/#6/#9/#10 upstream: cm_dialysis_active_listings_m
--   * firm_term_years lateral: active-lease filter (fixes long-cohort contamination)
--   * DOM zombie bound: when off_market_date IS NULL, a listing is only still
--     "active" if a freshness signal (last_seen / url_last_checked /
--     last_verified_at / listing_date) is within 120 days of the snapshot.
--   Columns unchanged (12): period_end, subspecialty, listing_id, property_id,
--   listing_date, days_on_market, last_price, last_cap_rate, initial_price,
--   had_price_change, firm_term_years, is_core_10plus
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.cm_dialysis_active_listings_m AS
 WITH month_anchors AS (
         SELECT (date_trunc('month'::text, g.d) + '1 mon -1 days'::interval)::date AS period_end
           FROM generate_series('2010-01-01'::date::timestamp with time zone, cm_last_completed_quarter_end()::timestamp with time zone, '1 mon'::interval) g(d)
        ), active_pairs AS (
         SELECT q.period_end,
            al.listing_id,
            al.property_id,
            al.listing_date,
            al.last_price,
            COALESCE(al.cap_rate, al.last_cap_rate, al.current_cap_rate) AS last_cap_rate,
            al.initial_price,
            al.seller_name,
            p.operator,
            p.tenant,
            p.building_name,
            p.true_owner_name,
            q.period_end - al.listing_date AS days_on_market,
            al.initial_price IS NOT NULL AND al.last_price IS NOT NULL AND al.initial_price <> al.last_price AS had_price_change,
            ( SELECT EXTRACT(epoch FROM l.lease_expiration::timestamp without time zone - q.period_end::timestamp without time zone) / (86400.0 * 365.25)
                   FROM leases l
                  WHERE l.property_id = al.property_id
                    AND l.is_active = true
                    AND lower(COALESCE(l.status, ''::text)) <> ALL (ARRAY['superseded'::text, 'superseded_duplicate'::text, 'expired'::text, 'terminated'::text, 'placeholder'::text, 'closed'::text, 'closed but obligated'::text])
                    AND l.lease_expiration IS NOT NULL
                    AND l.lease_expiration >= q.period_end
                    AND (l.lease_start IS NULL OR l.lease_start <= q.period_end)
                  ORDER BY l.lease_expiration DESC
                 LIMIT 1) AS firm_term_years
           FROM month_anchors q
             JOIN available_listings al ON al.listing_date IS NOT NULL AND al.listing_date <= q.period_end
                  AND (al.sold_date IS NULL OR al.sold_date > q.period_end)
                  AND (
                        (al.off_market_date IS NOT NULL AND al.off_market_date > q.period_end)
                        OR (al.off_market_date IS NULL
                            AND COALESCE(al.last_seen, al.url_last_checked, al.last_verified_at::date, al.listing_date) >= (q.period_end - '120 days'::interval)::date)
                      )
                  AND (al.is_active = true OR (lower(COALESCE(al.status, ''::character varying)::text) = ANY (ARRAY['active'::text, 'available'::text, 'for sale'::text, 'under contract'::text, 'draft-commenced'::text, 'superseded'::text])))
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


-- -----------------------------------------------------------------------------
-- #5 upstream: cm_dialysis_active_listings_q
--   * firm_term_years lateral: active-lease filter (fixes long-cohort contamination)
--   (Quarterly view does NOT apply the DOM freshness bound -- it feeds
--    available_market_size_q which is a count/cap snapshot, not a DOM series, and
--    the original quarterly view never carried days_on_market into a ramp metric.
--    Left the active-set predicate identical to the original to preserve counts.)
--   Columns unchanged (14): period_end, subspecialty, listing_id, property_id,
--   listing_date, days_on_market, last_price, last_cap_rate, initial_price,
--   had_price_change, firm_term_years, is_core_10plus, tenant_bucket, operator
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.cm_dialysis_active_listings_q AS
 WITH quarter_anchors AS (
         SELECT (date_trunc('quarter'::text, g.d) + '3 mons -1 days'::interval)::date AS period_end
           FROM generate_series('2013-01-01'::date::timestamp with time zone, cm_last_completed_quarter_end()::timestamp with time zone, '3 mons'::interval) g(d)
        ), active_pairs AS (
         SELECT q.period_end,
            al.listing_id,
            al.property_id,
            al.listing_date,
            al.last_price,
            COALESCE(al.cap_rate, al.last_cap_rate, al.current_cap_rate) AS last_cap_rate,
            al.initial_price,
            al.seller_name,
            p.operator,
            p.tenant,
            p.building_name,
            p.true_owner_name,
            q.period_end - al.listing_date AS days_on_market,
            al.initial_price IS NOT NULL AND al.last_price IS NOT NULL AND al.initial_price <> al.last_price AS had_price_change,
            ( SELECT EXTRACT(epoch FROM l.lease_expiration::timestamp without time zone - q.period_end::timestamp without time zone) / (86400.0 * 365.25)
                   FROM leases l
                  WHERE l.property_id = al.property_id
                    AND l.is_active = true
                    AND lower(COALESCE(l.status, ''::text)) <> ALL (ARRAY['superseded'::text, 'superseded_duplicate'::text, 'expired'::text, 'terminated'::text, 'placeholder'::text, 'closed'::text, 'closed but obligated'::text])
                    AND l.lease_expiration IS NOT NULL
                    AND l.lease_expiration >= q.period_end
                    AND (l.lease_start IS NULL OR l.lease_start <= q.period_end)
                  ORDER BY l.lease_expiration DESC
                 LIMIT 1) AS firm_term_years
           FROM quarter_anchors q
             JOIN available_listings al ON al.listing_date IS NOT NULL AND al.listing_date <= q.period_end AND (al.off_market_date IS NULL OR al.off_market_date > q.period_end) AND (al.sold_date IS NULL OR al.sold_date > q.period_end) AND (al.is_active = true OR (lower(COALESCE(al.status, ''::character varying)::text) = ANY (ARRAY['active'::text, 'available'::text, 'for sale'::text, 'under contract'::text, 'draft-commenced'::text, 'superseded'::text])))
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


-- -----------------------------------------------------------------------------
-- #1 cm_dialysis_bid_ask_spread_m
--   * SIGNED spread = sold_cap (cap_rate) - last_ask_cap (last_cap_rate).
--   * achieved_last_ask_cap = avg_last_ask_cap + avg_signed_spread  (ADD),
--     restoring the identity "last ask + spread = sold cap".
--   >=5 sample gates preserved. Columns unchanged (10).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.cm_dialysis_bid_ask_spread_m AS
 WITH month_anchors AS (
         SELECT (date_trunc('month'::text, g.d) + '1 mon -1 days'::interval)::date AS period_end
           FROM generate_series('2001-01-01'::date::timestamp with time zone, CURRENT_DATE::timestamp with time zone, '1 mon'::interval) g(d)
        ), ttm_sold AS (
         SELECT m.period_end,
                CASE
                    WHEN al.last_cap_rate IS NOT NULL AND al.cap_rate IS NOT NULL THEN al.cap_rate - al.last_cap_rate
                    ELSE NULL::numeric
                END AS bid_ask_spread_bps,
                CASE
                    WHEN al.initial_price IS NOT NULL AND al.last_price IS NOT NULL AND al.initial_price <> al.last_price THEN true
                    WHEN al.initial_price IS NOT NULL AND al.last_price IS NOT NULL THEN false
                    ELSE NULL::boolean
                END AS had_price_change,
            al.last_cap_rate AS last_ask_cap
           FROM month_anchors m
             LEFT JOIN available_listings al ON al.sold_date > (m.period_end - '1 year'::interval)::date AND al.sold_date <= m.period_end
        ), agg AS (
         SELECT ttm_sold.period_end,
            count(*) FILTER (WHERE ttm_sold.bid_ask_spread_bps IS NOT NULL) AS n_with_spread,
            avg(ttm_sold.bid_ask_spread_bps) AS avg_bid_ask_spread_raw,
            count(*) FILTER (WHERE ttm_sold.had_price_change IS NOT NULL) AS n_with_pricing,
            count(*) FILTER (WHERE ttm_sold.had_price_change)::numeric / NULLIF(count(*) FILTER (WHERE ttm_sold.had_price_change IS NOT NULL), 0)::numeric AS pct_price_change_raw,
            avg(ttm_sold.last_ask_cap) FILTER (WHERE ttm_sold.last_ask_cap >= 0.04 AND ttm_sold.last_ask_cap <= 0.12) AS avg_last_ask_cap_raw,
            min(ttm_sold.last_ask_cap) FILTER (WHERE ttm_sold.last_ask_cap >= 0.04 AND ttm_sold.last_ask_cap <= 0.12) AS min_last_ask_cap_raw,
            max(ttm_sold.last_ask_cap) FILTER (WHERE ttm_sold.last_ask_cap >= 0.04 AND ttm_sold.last_ask_cap <= 0.12) AS max_last_ask_cap_raw,
            count(*) FILTER (WHERE ttm_sold.last_ask_cap >= 0.04 AND ttm_sold.last_ask_cap <= 0.12) AS n_with_last_cap
           FROM ttm_sold
          GROUP BY ttm_sold.period_end
        )
 SELECT agg.period_end,
    'all'::text AS subspecialty,
    agg.n_with_spread,
        CASE
            WHEN agg.n_with_spread >= 5 THEN agg.avg_bid_ask_spread_raw
            ELSE NULL::numeric
        END::numeric(8,5) AS avg_bid_ask_spread,
    agg.n_with_pricing,
        CASE
            WHEN agg.n_with_pricing >= 5 THEN agg.pct_price_change_raw
            ELSE NULL::numeric
        END AS pct_price_change,
        CASE
            WHEN agg.n_with_last_cap >= 5 THEN agg.avg_last_ask_cap_raw
            ELSE NULL::numeric
        END::numeric(8,5) AS avg_last_ask_cap,
        CASE
            WHEN agg.n_with_last_cap >= 5 THEN agg.min_last_ask_cap_raw
            ELSE NULL::numeric
        END::numeric(8,5) AS min_last_ask_cap,
        CASE
            WHEN agg.n_with_last_cap >= 5 THEN agg.max_last_ask_cap_raw
            ELSE NULL::numeric
        END::numeric(8,5) AS max_last_ask_cap,
        CASE
            WHEN agg.n_with_last_cap >= 5 AND agg.n_with_spread >= 5 THEN agg.avg_last_ask_cap_raw + agg.avg_bid_ask_spread_raw
            ELSE NULL::numeric
        END::numeric(8,5) AS achieved_last_ask_cap
   FROM agg
  ORDER BY agg.period_end;


-- -----------------------------------------------------------------------------
-- #2 cm_dialysis_nm_vs_market_m  (self-contained; no longer reads master_m)
--   * NM identified by sales_transactions.is_northmarq.
--   * NM n-gate (NM monthly TTM n>=3) applied BEFORE smoothing.
--   * Both NM and market legs smoothed with the SAME 9-month window (-4..+4).
--   * Market leg = NOT is_northmarq AND brokered, where brokered =
--       (listing_broker present OR procuring_broker present
--        OR listing_broker_id present OR procuring_broker_id present).
--   * cap = COALESCE(calculated_cap_rate, stated_cap_rate, cap_rate);
--     cap_rate_quality='implausible_unverified' nulled; exclude_from_market_metrics respected.
--   Columns unchanged (4): period_end, subspecialty, nm_cap_rate, market_cap_rate
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.cm_dialysis_nm_vs_market_m AS
 WITH month_anchors AS (
         SELECT (date_trunc('month'::text, g.d) + '1 mon -1 days'::interval)::date AS period_end
           FROM generate_series('2001-01-01'::date::timestamp with time zone, cm_last_completed_quarter_end()::timestamp with time zone, '1 mon'::interval) g(d)
        ), classified AS (
         SELECT s.sale_date,
                CASE
                    WHEN s.cap_rate_quality = 'implausible_unverified'::text THEN NULL::numeric
                    ELSE COALESCE(s.calculated_cap_rate, s.stated_cap_rate, s.cap_rate)
                END AS cap_rate,
            s.is_northmarq,
            (COALESCE(NULLIF(btrim(s.listing_broker), ''::text), NULLIF(btrim(s.procuring_broker), ''::text)) IS NOT NULL
                OR s.listing_broker_id IS NOT NULL
                OR s.procuring_broker_id IS NOT NULL) AS brokered
           FROM sales_transactions s
          WHERE s.sale_date IS NOT NULL AND s.sold_price IS NOT NULL AND s.sold_price > 0::numeric AND NOT COALESCE(s.exclude_from_market_metrics, false)
            AND (s.transaction_type IS NULL OR (s.transaction_type = ANY (ARRAY['Investment'::text, 'Resale'::text])))
            AND s.sale_date <= cm_last_completed_quarter_end()
        ), ttm AS (
         SELECT m.period_end,
            avg(c.cap_rate) FILTER (WHERE c.is_northmarq AND c.cap_rate >= 0.04 AND c.cap_rate <= 0.12) AS nm_raw,
            count(*) FILTER (WHERE c.is_northmarq AND c.cap_rate >= 0.04 AND c.cap_rate <= 0.12) AS nm_n,
            avg(c.cap_rate) FILTER (WHERE NOT c.is_northmarq AND c.brokered AND c.cap_rate >= 0.04 AND c.cap_rate <= 0.12) AS mkt_raw,
            count(*) FILTER (WHERE NOT c.is_northmarq AND c.brokered AND c.cap_rate >= 0.04 AND c.cap_rate <= 0.12) AS mkt_n
           FROM month_anchors m
             LEFT JOIN classified c ON c.sale_date > (m.period_end - '1 year'::interval)::date AND c.sale_date <= m.period_end
          GROUP BY m.period_end
        ), gated AS (
         SELECT ttm.period_end,
                CASE WHEN ttm.nm_n >= 3 THEN ttm.nm_raw ELSE NULL::numeric END AS nm_g,
                CASE WHEN ttm.mkt_n >= 3 THEN ttm.mkt_raw ELSE NULL::numeric END AS mkt_g
           FROM ttm
        )
 SELECT gated.period_end,
    'all'::text AS subspecialty,
    avg(gated.nm_g) OVER w AS nm_cap_rate,
    avg(gated.mkt_g) OVER w AS market_cap_rate
   FROM gated
  WINDOW w AS (ORDER BY gated.period_end ROWS BETWEEN 4 PRECEDING AND 4 FOLLOWING)
  ORDER BY gated.period_end;


-- -----------------------------------------------------------------------------
-- #3 cm_dialysis_notable_transactions
--   * One row per property: DISTINCT ON (COALESCE(property_id::text,
--     lower(btrim(address)))) ordered by sale_date DESC, sold_price DESC.
--   * rank() recomputed over the deduped set by sold_price DESC.
--   Columns unchanged (16): sale_id, subspecialty, sale_date, sale_price,
--   cap_rate, buyer_type, tenant_display, tenant, operator, city, state,
--   address, building_name, rank, property_display, buyer_type_display
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.cm_dialysis_notable_transactions AS
 WITH nm_sales AS (
         SELECT s.sale_id,
            s.sale_date,
            s.sold_price,
                CASE
                    WHEN s.cap_rate_quality = 'implausible_unverified'::text THEN NULL::numeric
                    ELSE COALESCE(s.cap_rate, s.calculated_cap_rate, s.stated_cap_rate)
                END AS cap_rate,
            s.buyer_type,
            p.tenant,
            p.operator,
            p.city,
            p.state,
            p.address,
            p.building_name,
            COALESCE(s.property_id::text, lower(btrim(p.address))) AS dedup_key
           FROM sales_transactions s
             LEFT JOIN properties p ON p.property_id = s.property_id
          WHERE s.is_northmarq = true AND s.sold_price IS NOT NULL AND s.sold_price > 0::numeric AND NOT COALESCE(s.exclude_from_market_metrics, false)
        ), deduped AS (
         SELECT DISTINCT ON (nm_sales.dedup_key)
            nm_sales.sale_id,
            nm_sales.sale_date,
            nm_sales.sold_price,
            nm_sales.cap_rate,
            nm_sales.buyer_type,
            nm_sales.tenant,
            nm_sales.operator,
            nm_sales.city,
            nm_sales.state,
            nm_sales.address,
            nm_sales.building_name
           FROM nm_sales
          ORDER BY nm_sales.dedup_key, nm_sales.sale_date DESC, nm_sales.sold_price DESC NULLS LAST
        )
 SELECT deduped.sale_id,
    'all'::text AS subspecialty,
    deduped.sale_date,
    deduped.sold_price AS sale_price,
    deduped.cap_rate,
    deduped.buyer_type,
    COALESCE(NULLIF(btrim(deduped.tenant::text), ''::text), NULLIF(btrim(deduped.operator), ''::text), '—'::text) AS tenant_display,
    deduped.tenant,
    deduped.operator,
    deduped.city,
    deduped.state,
    deduped.address,
    deduped.building_name,
    rank() OVER (ORDER BY deduped.sold_price DESC NULLS LAST)::integer AS rank,
    COALESCE(NULLIF(btrim(deduped.address), ''::text), NULLIF(btrim(deduped.building_name), ''::text), NULLIF(btrim(deduped.city::text), ''::text), '—'::text) AS property_display,
    COALESCE(NULLIF(btrim(deduped.buyer_type::text), ''::text), '—'::text) AS buyer_type_display
   FROM deduped
  ORDER BY deduped.sold_price DESC NULLS LAST;


-- -----------------------------------------------------------------------------
-- #4 cm_dialysis_industry_participants
--   * Blank chain_organization no longer competes for Top-10 (rank non-blank only).
--   * Everything beyond Top-10 PLUS the blank/unreported group collapses into a
--     single final row labeled 'Other / Independent'.
--   Columns unchanged (6): period_end, subspecialty, rank, operator,
--   clinic_count, pct_of_market
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.cm_dialysis_industry_participants AS
 WITH base AS (
         SELECT NULLIF(btrim(medicare_clinics.chain_organization), ''::text) AS operator
           FROM medicare_clinics
        ), tot AS (
         SELECT count(*)::numeric AS n
           FROM base
        ), agg AS (
         SELECT base.operator,
            count(*)::integer AS clinic_count,
            count(*)::numeric / (( SELECT tot.n FROM tot)) AS pct_of_market
           FROM base
          WHERE base.operator IS NOT NULL
          GROUP BY base.operator
        ), ranked AS (
         SELECT agg.operator,
            agg.clinic_count,
            agg.pct_of_market,
            row_number() OVER (ORDER BY agg.clinic_count DESC) AS rn
           FROM agg
        ), top10 AS (
         SELECT ranked.rn::integer AS rank,
            ranked.operator,
            ranked.clinic_count,
            ranked.pct_of_market
           FROM ranked
          WHERE ranked.rn <= 10
        ), other AS (
         SELECT 11 AS rank,
            'Other / Independent'::text AS operator,
            (( SELECT COALESCE(sum(ranked.clinic_count), 0::bigint) AS sum FROM ranked WHERE ranked.rn > 10)
             + ( SELECT count(*) AS count FROM base WHERE base.operator IS NULL))::integer AS clinic_count,
            (( SELECT COALESCE(sum(ranked.pct_of_market), 0::numeric) AS sum FROM ranked WHERE ranked.rn > 10)
             + ( SELECT count(*)::numeric / (( SELECT tot.n FROM tot)) AS count FROM base WHERE base.operator IS NULL)) AS pct_of_market
        )
 SELECT CURRENT_DATE AS period_end,
    'all'::text AS subspecialty,
    u.rank,
    u.operator,
    u.clinic_count,
    u.pct_of_market
   FROM ( SELECT top10.rank,
            top10.operator,
            top10.clinic_count,
            top10.pct_of_market
           FROM top10
        UNION ALL
         SELECT other.rank,
            other.operator,
            other.clinic_count,
            other.pct_of_market
           FROM other
          WHERE other.clinic_count > 0) u
  ORDER BY u.rank;


-- -----------------------------------------------------------------------------
-- #5 cm_dialysis_available_market_size_q
--   * Reads the corrected cm_dialysis_active_listings_q (active-lease firm-term).
--   * Core-10+ cap series now gated on cohort n>=5 (avg over <5 samples -> NULL),
--     eliminating the inverted "core cap above whole-market cap" artifact.
--   Columns unchanged (6): period_end, subspecialty, count_total,
--   count_core_10plus, avg_cap_total, avg_cap_core_10plus
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.cm_dialysis_available_market_size_q AS
 SELECT cm_dialysis_active_listings_q.period_end,
    'all'::text AS subspecialty,
    count(*) AS count_total,
    count(*) FILTER (WHERE cm_dialysis_active_listings_q.is_core_10plus) AS count_core_10plus,
    avg(cm_dialysis_active_listings_q.last_cap_rate) FILTER (WHERE cm_dialysis_active_listings_q.last_cap_rate >= 0.04 AND cm_dialysis_active_listings_q.last_cap_rate <= 0.12) AS avg_cap_total,
        CASE
            WHEN count(*) FILTER (WHERE cm_dialysis_active_listings_q.is_core_10plus AND cm_dialysis_active_listings_q.last_cap_rate >= 0.04 AND cm_dialysis_active_listings_q.last_cap_rate <= 0.12) >= 5
            THEN avg(cm_dialysis_active_listings_q.last_cap_rate) FILTER (WHERE cm_dialysis_active_listings_q.is_core_10plus AND cm_dialysis_active_listings_q.last_cap_rate >= 0.04 AND cm_dialysis_active_listings_q.last_cap_rate <= 0.12)
            ELSE NULL::numeric
        END AS avg_cap_core_10plus
   FROM cm_dialysis_active_listings_q
  GROUP BY cm_dialysis_active_listings_q.period_end
 HAVING count(*) >= 5
  ORDER BY cm_dialysis_active_listings_q.period_end;


-- -----------------------------------------------------------------------------
-- #6 cm_dialysis_dom_price_change_active_m
--   * Body is unchanged; the DOM zombie ramp is fixed UPSTREAM in
--     cm_dialysis_active_listings_m (NULL off_market_date now requires a
--     freshness signal within 120 days of the snapshot). Recreated verbatim so
--     the migration is self-documenting and the dependency is explicit.
--   Columns unchanged (6): period_end, subspecialty, avg_dom_total, avg_dom_core,
--   pct_price_change_total, pct_price_change_core
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.cm_dialysis_dom_price_change_active_m AS
 SELECT cm_dialysis_active_listings_m.period_end,
    'all'::text AS subspecialty,
    avg(cm_dialysis_active_listings_m.days_on_market) FILTER (WHERE cm_dialysis_active_listings_m.days_on_market >= 0 AND cm_dialysis_active_listings_m.days_on_market <= 730) AS avg_dom_total,
    avg(cm_dialysis_active_listings_m.days_on_market) FILTER (WHERE cm_dialysis_active_listings_m.is_core_10plus AND cm_dialysis_active_listings_m.days_on_market >= 0 AND cm_dialysis_active_listings_m.days_on_market <= 730) AS avg_dom_core,
    count(*) FILTER (WHERE cm_dialysis_active_listings_m.had_price_change)::numeric / NULLIF(count(*) FILTER (WHERE cm_dialysis_active_listings_m.had_price_change IS NOT NULL), 0)::numeric AS pct_price_change_total,
    count(*) FILTER (WHERE cm_dialysis_active_listings_m.had_price_change AND cm_dialysis_active_listings_m.is_core_10plus)::numeric / NULLIF(count(*) FILTER (WHERE cm_dialysis_active_listings_m.had_price_change IS NOT NULL AND cm_dialysis_active_listings_m.is_core_10plus), 0)::numeric AS pct_price_change_core
   FROM cm_dialysis_active_listings_m
  GROUP BY cm_dialysis_active_listings_m.period_end
 HAVING count(*) > 0
  ORDER BY cm_dialysis_active_listings_m.period_end;


-- -----------------------------------------------------------------------------
-- #7 cm_dialysis_inventory_backlog_m
--   * Effective-window model recovers the ~34% of listings with NULL listing_date:
--       eff_start = COALESCE(listing_date,
--                            (COALESCE(sold_date, off_market_date) - INTERVAL '196 days'))
--       eff_end   = COALESCE(sold_date, off_market_date)
--     A listing is active in month m when eff_start <= m AND (eff_end IS NULL OR eff_end > m).
--   * active_count and added_ttm recomputed on eff_start/eff_end.
--   Columns unchanged (7): period_end, subspecialty, active_count, added_ttm,
--   sold_ttm, ttm_sales, months_of_supply
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.cm_dialysis_inventory_backlog_m AS
 WITH months AS (
         SELECT (date_trunc('month'::text, g.d) + '1 mon -1 days'::interval)::date AS period_end
           FROM generate_series('2014-01-01'::date::timestamp with time zone, cm_last_completed_quarter_end()::timestamp with time zone, '1 mon'::interval) g(d)
        ), eff AS (
         SELECT al.listing_id,
            COALESCE(al.listing_date, (COALESCE(al.sold_date, al.off_market_date) - '196 days'::interval)::date) AS eff_start,
            COALESCE(al.sold_date, al.off_market_date) AS eff_end
           FROM available_listings al
        ), base AS (
         SELECT m.period_end,
            ( SELECT count(*) AS count
                   FROM eff e
                  WHERE e.eff_start IS NOT NULL AND e.eff_start <= m.period_end AND (e.eff_end IS NULL OR e.eff_end > m.period_end)) AS active_count,
            ( SELECT count(*) AS count
                   FROM eff e
                  WHERE e.eff_start IS NOT NULL AND e.eff_start > (m.period_end - '1 year'::interval)::date AND e.eff_start <= m.period_end) AS added_ttm,
            ( SELECT count(*) AS count
                   FROM sales_transactions s
                  WHERE s.sale_date > (m.period_end - '1 year'::interval)::date AND s.sale_date <= m.period_end AND s.sold_price IS NOT NULL AND s.sold_price > 0::numeric AND NOT COALESCE(s.exclude_from_market_metrics, false)) AS sold_ttm
           FROM months m
        )
 SELECT base.period_end,
    'all'::text AS subspecialty,
    base.active_count,
    base.added_ttm,
    base.sold_ttm,
    base.sold_ttm AS ttm_sales,
        CASE
            WHEN base.sold_ttm > 0 THEN base.active_count::numeric * 12::numeric / base.sold_ttm::numeric
            ELSE NULL::numeric
        END AS months_of_supply
   FROM base
  ORDER BY base.period_end;


-- -----------------------------------------------------------------------------
-- #8 cm_dialysis_market_turnover_m
--   * active_count recomputed on the same eff_start/eff_end window as #7, so the
--     on-market universe no longer collapses pre-2022.
--   Columns unchanged (8): period_end, subspecialty, ttm_sales_count,
--   market_universe, turnover_rate, active_count, annual_sales_rate, months_of_supply
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.cm_dialysis_market_turnover_m AS
 WITH months AS (
         SELECT (date_trunc('month'::text, g.d) + '1 mon -1 days'::interval)::date AS period_end
           FROM generate_series('2014-01-01'::date::timestamp with time zone, cm_last_completed_quarter_end()::timestamp with time zone, '1 mon'::interval) g(d)
        ), eff AS (
         SELECT al.listing_id,
            COALESCE(al.listing_date, (COALESCE(al.sold_date, al.off_market_date) - '196 days'::interval)::date) AS eff_start,
            COALESCE(al.sold_date, al.off_market_date) AS eff_end
           FROM available_listings al
        ), base AS (
         SELECT m.period_end,
            ( SELECT count(*) AS count
                   FROM sales_transactions s
                  WHERE s.sale_date > (m.period_end - '1 year'::interval)::date AND s.sale_date <= m.period_end AND s.sold_price IS NOT NULL AND s.sold_price > 0::numeric AND NOT COALESCE(s.exclude_from_market_metrics, false)) AS ttm_sales,
            ( SELECT count(*) AS count
                   FROM eff e
                  WHERE e.eff_start IS NOT NULL AND e.eff_start <= m.period_end AND (e.eff_end IS NULL OR e.eff_end > m.period_end)) AS active_count
           FROM months m
        )
 SELECT base.period_end,
    'all'::text AS subspecialty,
    base.ttm_sales AS ttm_sales_count,
    base.active_count + base.ttm_sales AS market_universe,
    base.ttm_sales::numeric / NULLIF(base.active_count + base.ttm_sales, 0)::numeric AS turnover_rate,
    base.active_count,
    base.ttm_sales AS annual_sales_rate,
        CASE
            WHEN base.ttm_sales > 0 THEN base.active_count::numeric * 12::numeric / base.ttm_sales::numeric
            ELSE NULL::numeric
        END AS months_of_supply
   FROM base
  ORDER BY base.period_end;


-- -----------------------------------------------------------------------------
-- #9 cm_dialysis_sold_cap_by_term_dot  (self-contained; no longer reads master_m)
--   * Sold-side firm-term computed with the corrected active-lease lateral.
--   * Per-cohort gate lowered 5 -> 3; smoothing window kept at 9 months (-4..+4).
--   * Cohort column names preserved exactly so the chart mapping is unchanged.
--   Columns unchanged (6): period_end, subspecialty, cap_12plus, cap_8to12,
--   cap_6to8, cap_5orless
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.cm_dialysis_sold_cap_by_term_dot AS
 WITH month_anchors AS (
         SELECT (date_trunc('month'::text, g.d) + '1 mon -1 days'::interval)::date AS period_end
           FROM generate_series('2001-01-01'::date::timestamp with time zone, cm_last_completed_quarter_end()::timestamp with time zone, '1 mon'::interval) g(d)
        ), classified AS (
         SELECT s.sale_date,
                CASE
                    WHEN s.cap_rate_quality = 'implausible_unverified'::text THEN NULL::numeric
                    ELSE COALESCE(s.calculated_cap_rate, s.stated_cap_rate, s.cap_rate)
                END AS cap_rate,
            ( SELECT EXTRACT(epoch FROM l.lease_expiration::timestamp without time zone - s.sale_date::timestamp without time zone) / (86400.0 * 365.25)
                   FROM leases l
                  WHERE l.property_id = s.property_id
                    AND l.is_active = true
                    AND lower(COALESCE(l.status, ''::text)) <> ALL (ARRAY['superseded'::text, 'superseded_duplicate'::text, 'expired'::text, 'terminated'::text, 'placeholder'::text, 'closed'::text, 'closed but obligated'::text])
                    AND l.lease_expiration IS NOT NULL
                    AND l.lease_expiration >= s.sale_date
                    AND (l.lease_start IS NULL OR l.lease_start <= s.sale_date)
                  ORDER BY l.lease_expiration DESC
                 LIMIT 1) AS firm_term_years
           FROM sales_transactions s
          WHERE s.sale_date IS NOT NULL AND s.sold_price IS NOT NULL AND s.sold_price > 0::numeric AND NOT COALESCE(s.exclude_from_market_metrics, false)
            AND (s.transaction_type IS NULL OR (s.transaction_type = ANY (ARRAY['Investment'::text, 'Resale'::text])))
            AND s.sale_date <= cm_last_completed_quarter_end()
        ), ttm AS (
         SELECT m.period_end,
            avg(c.cap_rate) FILTER (WHERE c.firm_term_years >= 12::numeric AND c.cap_rate >= 0.04 AND c.cap_rate <= 0.12) AS cap_12plus_raw,
            count(*) FILTER (WHERE c.firm_term_years >= 12::numeric AND c.cap_rate >= 0.04 AND c.cap_rate <= 0.12) AS cap_12plus_n,
            avg(c.cap_rate) FILTER (WHERE c.firm_term_years >= 8::numeric AND c.firm_term_years < 12::numeric AND c.cap_rate >= 0.04 AND c.cap_rate <= 0.12) AS cap_8to12_raw,
            count(*) FILTER (WHERE c.firm_term_years >= 8::numeric AND c.firm_term_years < 12::numeric AND c.cap_rate >= 0.04 AND c.cap_rate <= 0.12) AS cap_8to12_n,
            avg(c.cap_rate) FILTER (WHERE c.firm_term_years >= 6::numeric AND c.firm_term_years < 8::numeric AND c.cap_rate >= 0.04 AND c.cap_rate <= 0.12) AS cap_6to8_raw,
            count(*) FILTER (WHERE c.firm_term_years >= 6::numeric AND c.firm_term_years < 8::numeric AND c.cap_rate >= 0.04 AND c.cap_rate <= 0.12) AS cap_6to8_n,
            avg(c.cap_rate) FILTER (WHERE c.firm_term_years IS NOT NULL AND c.firm_term_years <= 5::numeric AND c.cap_rate >= 0.04 AND c.cap_rate <= 0.12) AS cap_5orless_raw,
            count(*) FILTER (WHERE c.firm_term_years IS NOT NULL AND c.firm_term_years <= 5::numeric AND c.cap_rate >= 0.04 AND c.cap_rate <= 0.12) AS cap_5orless_n
           FROM month_anchors m
             LEFT JOIN classified c ON c.sale_date > (m.period_end - '1 year'::interval)::date AND c.sale_date <= m.period_end
          GROUP BY m.period_end
        ), gated AS (
         SELECT ttm.period_end,
                CASE WHEN ttm.cap_12plus_n >= 3 THEN ttm.cap_12plus_raw ELSE NULL::numeric END AS cap_12plus_g,
                CASE WHEN ttm.cap_8to12_n >= 3 THEN ttm.cap_8to12_raw ELSE NULL::numeric END AS cap_8to12_g,
                CASE WHEN ttm.cap_6to8_n >= 3 THEN ttm.cap_6to8_raw ELSE NULL::numeric END AS cap_6to8_g,
                CASE WHEN ttm.cap_5orless_n >= 3 THEN ttm.cap_5orless_raw ELSE NULL::numeric END AS cap_5orless_g
           FROM ttm
        )
 SELECT gated.period_end,
    'all'::text AS subspecialty,
    avg(gated.cap_12plus_g) OVER w AS cap_12plus,
    avg(gated.cap_8to12_g) OVER w AS cap_8to12,
    avg(gated.cap_6to8_g) OVER w AS cap_6to8,
    avg(gated.cap_5orless_g) OVER w AS cap_5orless
   FROM gated
  WINDOW w AS (ORDER BY gated.period_end ROWS BETWEEN 4 PRECEDING AND 4 FOLLOWING)
  ORDER BY gated.period_end;


-- -----------------------------------------------------------------------------
-- #10 cm_dialysis_asking_cap_by_term_m
--   * Reads the corrected cm_dialysis_active_listings_m (active-lease firm-term),
--     so the long cohort is no longer contaminated by superseded leases.
--   * Per-cohort gate lowered 5 -> 3; TTM smoothing window widened from 3 months
--     (-1..+1) to 5 months (-2..+2) so cohorts populate more densely.
--   * cap_*_n columns kept (the n-gate diagnostics).
--   Columns unchanged (10): period_end, subspecialty, cap_12plus, cap_8to12,
--   cap_6to8, cap_5orless, cap_12plus_n, cap_8to12_n, cap_6to8_n, cap_5orless_n
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.cm_dialysis_asking_cap_by_term_m AS
 WITH base AS (
         SELECT cm_dialysis_active_listings_m.period_end,
            cm_dialysis_active_listings_m.last_cap_rate AS cap,
            cm_dialysis_active_listings_m.firm_term_years AS term
           FROM cm_dialysis_active_listings_m
          WHERE cm_dialysis_active_listings_m.last_cap_rate IS NOT NULL AND cm_dialysis_active_listings_m.last_cap_rate >= 0.04 AND cm_dialysis_active_listings_m.last_cap_rate <= 0.12 AND cm_dialysis_active_listings_m.firm_term_years IS NOT NULL
        ), month_anchors AS (
         SELECT DISTINCT base.period_end
           FROM base
        ), ttm AS (
         SELECT m.period_end,
            avg(b.cap) FILTER (WHERE b.term >= 12::numeric) AS cap_12plus_raw,
            count(*) FILTER (WHERE b.term >= 12::numeric) AS cap_12plus_n,
            avg(b.cap) FILTER (WHERE b.term >= 8::numeric AND b.term < 12::numeric) AS cap_8to12_raw,
            count(*) FILTER (WHERE b.term >= 8::numeric AND b.term < 12::numeric) AS cap_8to12_n,
            avg(b.cap) FILTER (WHERE b.term >= 6::numeric AND b.term < 8::numeric) AS cap_6to8_raw,
            count(*) FILTER (WHERE b.term >= 6::numeric AND b.term < 8::numeric) AS cap_6to8_n,
            avg(b.cap) FILTER (WHERE b.term <= 5::numeric) AS cap_5orless_raw,
            count(*) FILTER (WHERE b.term <= 5::numeric) AS cap_5orless_n
           FROM month_anchors m
             LEFT JOIN base b ON b.period_end > (m.period_end - '1 year'::interval)::date AND b.period_end <= m.period_end
          GROUP BY m.period_end
        ), gated AS (
         SELECT ttm.period_end,
                CASE WHEN ttm.cap_12plus_n >= 3 THEN ttm.cap_12plus_raw ELSE NULL::numeric END AS cap_12plus_g,
                CASE WHEN ttm.cap_8to12_n >= 3 THEN ttm.cap_8to12_raw ELSE NULL::numeric END AS cap_8to12_g,
                CASE WHEN ttm.cap_6to8_n >= 3 THEN ttm.cap_6to8_raw ELSE NULL::numeric END AS cap_6to8_g,
                CASE WHEN ttm.cap_5orless_n >= 3 THEN ttm.cap_5orless_raw ELSE NULL::numeric END AS cap_5orless_g,
            ttm.cap_12plus_n,
            ttm.cap_8to12_n,
            ttm.cap_6to8_n,
            ttm.cap_5orless_n
           FROM ttm
        )
 SELECT gated.period_end,
    'all'::text AS subspecialty,
    avg(gated.cap_12plus_g) OVER w AS cap_12plus,
    avg(gated.cap_8to12_g) OVER w AS cap_8to12,
    avg(gated.cap_6to8_g) OVER w AS cap_6to8,
    avg(gated.cap_5orless_g) OVER w AS cap_5orless,
    gated.cap_12plus_n,
    gated.cap_8to12_n,
    gated.cap_6to8_n,
    gated.cap_5orless_n
   FROM gated
  WINDOW w AS (ORDER BY gated.period_end ROWS BETWEEN 2 PRECEDING AND 2 FOLLOWING)
  ORDER BY gated.period_end;

-- =============================================================================
-- End of migration.
-- =============================================================================
