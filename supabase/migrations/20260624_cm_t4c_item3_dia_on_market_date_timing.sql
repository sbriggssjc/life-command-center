-- T4c Item 3 — dia: repoint the supply-side TIMING / DOM / RAMP series to the SINGLE
-- canonical market-entry date `available_listings.on_market_date` (was listing_date,
-- which carried fake ingest-clock dates).  Applied live to dia (zqzrriwuavgrquhisnoa)
-- 2026-06-24.
--
-- Doctrine (Scott, 2026-06-24): on_market_date drives the FLOW/timing metrics
-- (new-to-market / added-per-month / inventory ramp / DOM).  The point-in-time CURRENT
-- active/available STOCK count stays on the listing_date FRESHNESS gate (the canonical
-- ~119 from the 2026-06-22 chart audit) — so cm_dialysis_active_listings_m/_q keep their
-- listing_date membership + recency gate, and ONLY the timing column
-- days_on_market switches to (period_end - on_market_date).  cm_dialysis_inventory_backlog_m
-- + cm_dialysis_market_turnover_m read active_count from cm_dialysis_active_listings_m, so
-- the point-in-time active count is preserved by construction.
--
-- Held rows (on_market_date IS NULL) drop off the FLOW time axis (de-surge); dated rows
-- plot at their real month.  NO listing_date fallback.  Reversible: re-create the prior
-- bodies (listing_date anchors; addable/sentinel on listing_date(_source)).
--
-- FOLLOW-UP (not in this change): dia has no on_market_date->off_market_date "active over
-- time SPAN" series like gov's cm_gov_*_m active_count — dia's active_count is the
-- canonical point-in-time count (06-22 audit).  Adding a dedicated dia span line (gov's
-- eff CTE is the template) without re-diverging the canonical available count is a separate
-- call for Scott.

-- ---- Point-in-time active STOCK (freshness-gated membership) + DOM on on_market_date ----

CREATE OR REPLACE VIEW public.cm_dialysis_active_listings_m AS
 WITH month_anchors AS (
         SELECT ((date_trunc('month'::text, g.d) + '1 mon -1 days'::interval))::date AS period_end
           FROM generate_series(('2010-01-01'::date)::timestamp with time zone, (cm_last_completed_quarter_end())::timestamp with time zone, '1 mon'::interval) g(d)
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
            (q.period_end - al.on_market_date) AS days_on_market,
            ((al.initial_price IS NOT NULL) AND (al.last_price IS NOT NULL) AND (al.initial_price <> al.last_price)) AS had_price_change,
            COALESCE(
                CASE
                    WHEN ((s.firm_term_years_at_sale IS NOT NULL) AND (s.sale_date >= q.period_end)) THEN (s.firm_term_years_at_sale + (((s.sale_date - q.period_end))::numeric / 365.0))
                    ELSE NULL::numeric
                END, ( SELECT (EXTRACT(epoch FROM ((l.lease_expiration)::timestamp without time zone - (q.period_end)::timestamp without time zone)) / (86400.0 * 365.25))
                   FROM leases l
                  WHERE ((l.property_id = al.property_id) AND (l.is_active = true) AND (lower(COALESCE(l.status, ''::text)) <> ALL (ARRAY['superseded'::text, 'superseded_duplicate'::text, 'expired'::text, 'terminated'::text, 'placeholder'::text, 'closed'::text, 'closed but obligated'::text])) AND (l.lease_expiration IS NOT NULL) AND (l.lease_expiration >= q.period_end) AND ((l.lease_start IS NULL) OR (l.lease_start <= q.period_end)))
                  ORDER BY l.lease_expiration DESC
                 LIMIT 1)) AS firm_term_years
           FROM (((month_anchors q
             JOIN available_listings al ON (((al.listing_date IS NOT NULL) AND (al.listing_date <= q.period_end) AND (al.data_source IS DISTINCT FROM 'synthetic_from_sale'::text) AND (COALESCE(al.listing_date_source, ''::text) !~~ 'sale_anchor%'::text) AND ((al.sold_date IS NULL) OR (al.sold_date > q.period_end)) AND (((al.off_market_date IS NOT NULL) AND (al.off_market_date > q.period_end)) OR ((al.off_market_date IS NULL) AND (COALESCE(al.last_seen, al.url_last_checked, (al.last_verified_at)::date, al.listing_date) >= ((q.period_end - '120 days'::interval))::date))) AND ((al.is_active = true) OR (lower((COALESCE(al.status, ''::character varying))::text) = ANY (ARRAY['active'::text, 'available'::text, 'for sale'::text, 'under contract'::text, 'draft-commenced'::text, 'superseded'::text]))))))
             LEFT JOIN properties p ON ((p.property_id = al.property_id)))
             LEFT JOIN sales_transactions s ON ((s.sale_id = al.sale_transaction_id)))
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
    (active_pairs.firm_term_years >= (10)::numeric) AS is_core_10plus,
    true AS is_observed
   FROM active_pairs;

CREATE OR REPLACE VIEW public.cm_dialysis_active_listings_q AS
 WITH quarter_anchors AS (
         SELECT ((date_trunc('quarter'::text, g.d) + '3 mons -1 days'::interval))::date AS period_end
           FROM generate_series(('2013-01-01'::date)::timestamp with time zone, (cm_last_completed_quarter_end())::timestamp with time zone, '3 mons'::interval) g(d)
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
            (q.period_end - al.on_market_date) AS days_on_market,
            ((al.initial_price IS NOT NULL) AND (al.last_price IS NOT NULL) AND (al.initial_price <> al.last_price)) AS had_price_change,
            COALESCE(( SELECT (st.firm_term_years_at_sale + (((st.sale_date - q.period_end))::numeric / 365.0))
                   FROM sales_transactions st
                  WHERE ((st.sale_id = al.sale_transaction_id) AND (st.firm_term_years_at_sale IS NOT NULL) AND (st.sale_date >= q.period_end))), ( SELECT (EXTRACT(epoch FROM ((l.lease_expiration)::timestamp without time zone - (q.period_end)::timestamp without time zone)) / (86400.0 * 365.25))
                   FROM leases l
                  WHERE ((l.property_id = al.property_id) AND (lower(COALESCE(l.status, ''::text)) <> ALL (ARRAY['superseded'::text, 'superseded_duplicate'::text, 'terminated'::text])) AND (l.lease_expiration IS NOT NULL) AND (l.lease_expiration >= q.period_end) AND ((l.lease_start IS NULL) OR (l.lease_start <= q.period_end)))
                  ORDER BY COALESCE(l.is_active, false) DESC, l.lease_expiration DESC
                 LIMIT 1)) AS firm_term_years
           FROM ((quarter_anchors q
             JOIN available_listings al ON (((al.listing_date IS NOT NULL) AND (al.listing_date <= q.period_end) AND (al.data_source IS DISTINCT FROM 'synthetic_from_sale'::text) AND (COALESCE(al.listing_date_source, ''::text) !~~ 'sale_anchor%'::text) AND ((al.sold_date IS NULL) OR (al.sold_date > q.period_end)) AND (((al.off_market_date IS NOT NULL) AND (al.off_market_date > q.period_end)) OR ((al.off_market_date IS NULL) AND (COALESCE(al.last_seen, al.url_last_checked, (al.last_verified_at)::date, al.listing_date) >= ((q.period_end - '120 days'::interval))::date))) AND ((al.is_active = true) OR (lower((COALESCE(al.status, ''::character varying))::text) = ANY (ARRAY['active'::text, 'available'::text, 'for sale'::text, 'under contract'::text, 'draft-commenced'::text, 'superseded'::text]))))))
             LEFT JOIN properties p ON ((p.property_id = al.property_id)))
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
    (active_pairs.firm_term_years >= (10)::numeric) AS is_core_10plus,
        CASE
            WHEN (active_pairs.operator ~~* '%davita%'::text) THEN 'DaVita'::text
            WHEN ((active_pairs.operator ~~* '%fresenius%'::text) OR (active_pairs.operator ~~* '%fmc%'::text) OR (active_pairs.operator ~~* '%fkc%'::text)) THEN 'FMC'::text
            WHEN ((active_pairs.operator ~~* '%u.s. renal%'::text) OR (active_pairs.operator ~~* '%us renal%'::text) OR (active_pairs.operator ~~* '%usrc%'::text)) THEN 'US Renal'::text
            WHEN ((active_pairs.operator IS NOT NULL) AND (TRIM(BOTH FROM active_pairs.operator) <> ''::text)) THEN 'Other'::text
            WHEN (active_pairs.seller_name ~~* '%davita%'::text) THEN 'DaVita'::text
            WHEN ((active_pairs.seller_name ~~* '%fresenius%'::text) OR (active_pairs.seller_name ~~* '%fmc%'::text) OR (active_pairs.seller_name ~~* '%fkc%'::text)) THEN 'FMC'::text
            WHEN ((active_pairs.seller_name ~~* '%u.s. renal%'::text) OR (active_pairs.seller_name ~~* '%us renal%'::text) OR (active_pairs.seller_name ~~* '%usrc%'::text)) THEN 'US Renal'::text
            WHEN ((active_pairs.tenant)::text ~~* '%davita%'::text) THEN 'DaVita'::text
            WHEN (((active_pairs.tenant)::text ~~* '%fresenius%'::text) OR ((active_pairs.tenant)::text ~~* '%fmc%'::text) OR ((active_pairs.tenant)::text ~~* '%fkc%'::text)) THEN 'FMC'::text
            WHEN (((active_pairs.tenant)::text ~~* '%u.s. renal%'::text) OR ((active_pairs.tenant)::text ~~* '%us renal%'::text) OR ((active_pairs.tenant)::text ~~* '%usrc%'::text)) THEN 'US Renal'::text
            WHEN (active_pairs.building_name ~~* '%davita%'::text) THEN 'DaVita'::text
            WHEN ((active_pairs.building_name ~~* '%fresenius%'::text) OR (active_pairs.building_name ~~* '%fmc%'::text) OR (active_pairs.building_name ~~* '%fkc%'::text)) THEN 'FMC'::text
            WHEN ((active_pairs.building_name ~~* '%u.s. renal%'::text) OR (active_pairs.building_name ~~* '%us renal%'::text) OR (active_pairs.building_name ~~* '%usrc%'::text)) THEN 'US Renal'::text
            WHEN (active_pairs.true_owner_name ~~* '%davita%'::text) THEN 'DaVita'::text
            WHEN ((active_pairs.true_owner_name ~~* '%fresenius%'::text) OR (active_pairs.true_owner_name ~~* '%fmc%'::text) OR (active_pairs.true_owner_name ~~* '%fkc%'::text)) THEN 'FMC'::text
            WHEN ((active_pairs.true_owner_name ~~* '%u.s. renal%'::text) OR (active_pairs.true_owner_name ~~* '%us renal%'::text) OR (active_pairs.true_owner_name ~~* '%usrc%'::text)) THEN 'US Renal'::text
            WHEN (((active_pairs.seller_name IS NULL) OR (TRIM(BOTH FROM active_pairs.seller_name) = ''::text)) AND ((active_pairs.tenant IS NULL) OR (TRIM(BOTH FROM active_pairs.tenant) = ''::text)) AND ((active_pairs.building_name IS NULL) OR (TRIM(BOTH FROM active_pairs.building_name) = ''::text)) AND ((active_pairs.true_owner_name IS NULL) OR (TRIM(BOTH FROM active_pairs.true_owner_name) = ''::text))) THEN 'Unknown'::text
            ELSE 'Other'::text
        END AS tenant_bucket,
    active_pairs.operator,
    true AS is_observed
   FROM active_pairs;

-- ---- FLOW / RAMP: added-per-month inventory backlog anchored on on_market_date ----

CREATE OR REPLACE VIEW public.cm_dialysis_inventory_backlog_m AS
 WITH months AS (
         SELECT ((date_trunc('month'::text, g.d) + '1 mon -1 days'::interval))::date AS period_end
           FROM generate_series(('2014-01-01'::date)::timestamp with time zone, (cm_last_completed_quarter_end())::timestamp with time zone, '1 mon'::interval) g(d)
        ), sentinel_dates AS (
         SELECT al.on_market_date AS d
           FROM available_listings al
          WHERE ((al.on_market_date IS NOT NULL) AND (al.data_source IS DISTINCT FROM 'synthetic_from_sale'::text))
          GROUP BY al.on_market_date
         HAVING (count(*) >= 15)
        ), eff AS (
         SELECT al.listing_id,
            al.on_market_date AS eff_start,
            COALESCE(al.sold_date, al.off_market_date) AS eff_end,
            (COALESCE(al.on_market_date_source, ''::text) <> ALL (ARRAY['date_unknown_r70b34'::text, 'capture_date_fallback'::text, 'date_unknown'::text, 'unestablished'::text])) AS addable
           FROM available_listings al
          WHERE ((al.on_market_date IS NOT NULL) AND (NOT ((al.sold_date IS NOT NULL) AND (al.sold_date <= al.on_market_date))) AND ((al.data_source = 'synthetic_from_sale'::text) OR (NOT (al.on_market_date IN ( SELECT sentinel_dates.d
                   FROM sentinel_dates)))))
        ), base AS (
         SELECT m.period_end,
            ( SELECT count(DISTINCT a.property_id) AS count
                   FROM cm_dialysis_active_listings_m a
                  WHERE ((a.period_end = m.period_end) AND (a.subspecialty = 'all'::text))) AS active_count,
            ( SELECT count(*) AS count
                   FROM eff e
                  WHERE ((e.eff_start IS NOT NULL) AND (e.eff_start > ((m.period_end - '1 year'::interval))::date) AND (e.eff_start <= m.period_end) AND e.addable)) AS added_ttm,
            ( SELECT count(*) AS count
                   FROM sales_transactions s
                  WHERE ((s.sale_date > ((m.period_end - '1 year'::interval))::date) AND (s.sale_date <= m.period_end) AND (s.sold_price > (0)::numeric) AND (NOT COALESCE(s.exclude_from_market_metrics, false)))) AS sold_ttm,
            ( SELECT count(*) AS count
                   FROM eff e
                  WHERE ((e.eff_start >= (date_trunc('month'::text, (m.period_end)::timestamp with time zone))::date) AND (e.eff_start <= m.period_end) AND e.addable)) AS added_month,
            ( SELECT count(*) AS count
                   FROM sales_transactions s
                  WHERE ((s.sale_date >= (date_trunc('month'::text, (m.period_end)::timestamp with time zone))::date) AND (s.sale_date <= m.period_end) AND (s.sold_price > (0)::numeric) AND (NOT COALESCE(s.exclude_from_market_metrics, false)))) AS sold_month
           FROM months m
        )
 SELECT base.period_end,
    'all'::text AS subspecialty,
    base.active_count,
    base.added_ttm,
    base.sold_ttm,
    base.sold_ttm AS ttm_sales,
        CASE
            WHEN (base.sold_ttm > 0) THEN (((base.active_count)::numeric * (12)::numeric) / (base.sold_ttm)::numeric)
            ELSE NULL::numeric
        END AS months_of_supply,
    base.added_month,
    base.sold_month,
    (base.added_month - base.sold_month) AS net_to_market_month
   FROM base
  ORDER BY base.period_end;

-- ---- FLOW: new-to-market grouped on on_market_date quarter ----

CREATE OR REPLACE VIEW public.cm_dialysis_new_to_market_q AS
 SELECT ((date_trunc('quarter'::text, (available_listings.on_market_date)::timestamp with time zone) + '3 mons -1 days'::interval))::date AS period_end,
    'all'::text AS subspecialty,
    count(*) FILTER (WHERE ((available_listings.data_source IS DISTINCT FROM 'synthetic_from_sale'::text) AND (COALESCE(available_listings.on_market_date_source, ''::text) <> ALL (ARRAY['date_unknown_r70b34'::text, 'capture_date_fallback'::text, 'date_unknown'::text, 'unestablished'::text])))) AS new_listings,
    count(*) FILTER (WHERE (available_listings.data_source IS DISTINCT FROM 'synthetic_from_sale'::text)) AS new_listings_raw_incl_unknown
   FROM available_listings
  WHERE ((available_listings.on_market_date IS NOT NULL) AND (available_listings.on_market_date >= '2017-01-01'::date) AND (available_listings.on_market_date <= cm_last_completed_quarter_end()))
  GROUP BY (((date_trunc('quarter'::text, (available_listings.on_market_date)::timestamp with time zone) + '3 mons -1 days'::interval))::date)
  ORDER BY (((date_trunc('quarter'::text, (available_listings.on_market_date)::timestamp with time zone) + '3 mons -1 days'::interval))::date);

-- ---- DOM (sold): time-to-sell anchored on on_market_date ----

CREATE OR REPLACE VIEW public.cm_dialysis_dom_pct_ask_m AS
 WITH month_anchors AS (
         SELECT ((date_trunc('month'::text, g.d) + '1 mon -1 days'::interval))::date AS period_end
           FROM generate_series(('2001-01-01'::date)::timestamp with time zone, (CURRENT_DATE)::timestamp with time zone, '1 mon'::interval) g(d)
        ), sold AS (
         SELECT m.period_end,
            (al.sold_date - al.on_market_date) AS dom,
                CASE
                    WHEN ((al.initial_price > (0)::numeric) AND (al.sold_price > (0)::numeric)) THEN (al.sold_price / al.initial_price)
                    ELSE NULL::numeric
                END AS ratio
           FROM (month_anchors m
             LEFT JOIN available_listings al ON ((((COALESCE(al.status, (''::text)::character varying))::text !~~* '%supersed%'::text) AND (al.data_source IS DISTINCT FROM 'synthetic_from_sale'::text) AND (al.sold_date > ((m.period_end - '1 year'::interval))::date) AND (al.sold_date <= m.period_end) AND (al.on_market_date IS NOT NULL) AND (al.sold_price IS NOT NULL) AND (al.sold_price > (0)::numeric))))
        ), agg AS (
         SELECT sold.period_end,
            count(*) FILTER (WHERE ((sold.dom >= 0) AND (sold.dom <= 730))) AS n_sales,
            avg(sold.dom) FILTER (WHERE ((sold.dom >= 0) AND (sold.dom <= 730))) AS avg_dom_raw,
            avg(sold.ratio) FILTER (WHERE ((sold.ratio IS NOT NULL) AND (sold.ratio >= 0.5) AND (sold.ratio < 1.0))) AS pct_raw,
            percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((sold.dom)::double precision)) FILTER (WHERE ((sold.dom >= 0) AND (sold.dom <= 730))) AS mdom_raw,
            percentile_cont((0.5)::double precision) WITHIN GROUP (ORDER BY ((sold.ratio)::double precision)) FILTER (WHERE ((sold.ratio IS NOT NULL) AND (sold.ratio >= 0.5) AND (sold.ratio < 1.0))) AS mpct_raw
           FROM sold
          GROUP BY sold.period_end
        ), gated AS (
         SELECT agg.period_end,
            agg.n_sales,
                CASE WHEN (agg.n_sales >= 10) THEN agg.avg_dom_raw ELSE NULL::numeric END AS dom_g,
                CASE WHEN (agg.n_sales >= 10) THEN agg.pct_raw ELSE NULL::numeric END AS pct_g,
                CASE WHEN (agg.n_sales >= 10) THEN agg.mdom_raw ELSE NULL::double precision END AS mdom_g,
                CASE WHEN (agg.n_sales >= 10) THEN agg.mpct_raw ELSE NULL::double precision END AS mpct_g
           FROM agg
        )
 SELECT gated.period_end,
    'all'::text AS subspecialty,
    gated.n_sales,
    (avg(gated.dom_g) OVER w)::numeric(10,1) AS avg_dom,
    (avg(gated.pct_g) OVER w)::numeric(8,5) AS pct_of_ask,
    (avg(gated.mdom_g) OVER w)::numeric(10,1) AS median_dom,
    (avg(gated.mpct_g) OVER w)::numeric(8,5) AS median_pct_of_ask
   FROM gated
  WINDOW w AS (ORDER BY gated.period_end ROWS BETWEEN 2 PRECEDING AND 2 FOLLOWING)
  ORDER BY gated.period_end;

CREATE OR REPLACE VIEW public.cm_dialysis_dom_pct_ask_q AS
 WITH quarter_anchors AS (
         SELECT DISTINCT ((date_trunc('quarter'::text, (available_listings.sold_date)::timestamp with time zone) + '3 mons -1 days'::interval))::date AS period_end
           FROM available_listings
          WHERE ((available_listings.sold_date IS NOT NULL) AND (available_listings.data_source IS DISTINCT FROM 'synthetic_from_sale'::text) AND (available_listings.on_market_date IS NOT NULL) AND (available_listings.last_price IS NOT NULL) AND (available_listings.last_price > (0)::numeric) AND (available_listings.sold_price IS NOT NULL) AND (available_listings.sold_price > (0)::numeric))
        ), ttm_sold_filtered AS (
         SELECT q.period_end,
            (al.sold_date - al.on_market_date) AS days_on_market,
            (al.sold_price / NULLIF(al.last_price, (0)::numeric)) AS pct_of_ask
           FROM (quarter_anchors q
             JOIN available_listings al ON ((((COALESCE(al.status, (''::text)::character varying))::text !~~* '%supersed%'::text) AND (al.data_source IS DISTINCT FROM 'synthetic_from_sale'::text) AND (al.sold_date > ((q.period_end - '1 year'::interval))::date) AND (al.sold_date <= q.period_end) AND (al.on_market_date IS NOT NULL) AND (al.last_price IS NOT NULL) AND (al.last_price > (0)::numeric) AND (al.sold_price IS NOT NULL) AND (al.sold_price > (0)::numeric) AND ((al.sold_date - al.on_market_date) >= 0) AND ((al.sold_date - al.on_market_date) <= 1095) AND (((al.sold_price)::numeric / (al.last_price)::numeric) >= 0.50) AND (((al.sold_price)::numeric / (al.last_price)::numeric) <= 1.50))))
        )
 SELECT ttm_sold_filtered.period_end,
    'all'::text AS subspecialty,
    count(*) AS n_sales,
    (avg(ttm_sold_filtered.days_on_market))::numeric(10,1) AS avg_dom,
    (avg(ttm_sold_filtered.pct_of_ask))::numeric(8,5) AS pct_of_ask
   FROM ttm_sold_filtered
  GROUP BY ttm_sold_filtered.period_end
  ORDER BY ttm_sold_filtered.period_end;

COMMENT ON COLUMN public.available_listings.on_market_date IS 'AUTHORITATIVE market-entry date — read this for all timing/DOM/added/ramp series (cm_* views, exports, cap-markets calcs). NULL = unknown, exclude from time series. Sourced from evidence only (on-market/DOM/email/platform/SF/sale-anchor), never the ingest clock. (T4c Item 3, 2026-06-24)';
COMMENT ON COLUMN public.available_listings.listing_date IS 'RAW capture date (may be ingest-clock/fake) — audit/reversibility only; do NOT use for market timing. on_market_date is the canonical market-entry field. (T4c Item 3, 2026-06-24)';
