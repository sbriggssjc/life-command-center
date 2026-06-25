-- =====================================================================
-- T9 — cap-rate data anomalies (gov DB: scknotsqkcheojiaewwh)
-- Applied live 2026-06-25; this file is the replay/version-control copy.
-- Idempotent. Resolves the DATA before the axis (Scott's rule).
--
-- Unit 1 — gov core-cap dot-plot outliers
--   The visible 6 (9-12%) + 13 filtered (>12%, up to 26.8%) outliers were ALL
--   DERIVED cap_rate_history errors, not real high-cap comps: every outlier's
--   sold_cap_rate (4.3-8%) matches NOI/price where NOI exists. Two causes:
--     (a) portfolio price-splits — a partial allocated price paired with the
--         FULL property NOI (e.g. prop 14197 CBP: $65.5M sale also recorded as
--         $21.6M/$25.6M/$18.3M slices, each / the full $4.03M NOI -> 18-22%);
--     (b) gross-rent-as-NOI / stale properties.noi (FS leases not haircut).
--   cm_gov_core_cap_rate_dots preferred crh.cap_rate, so the dot showed the
--   inflated value. Fix = tag the inflated crh rows (reversible) + have the dot
--   skip them and fall back to the validated sold_cap_rate.
--
-- Unit 2 — gov cap-by-term erratic/duplicate cohorts
--   cm_gov_cap_by_term_m (feeds "Cap Rate by Remaining Lease Term") was the
--   erratic view: 1-yr window, NO density floor (1-2-sale buckets pinned on
--   round numbers like 0.0750 for 3 straight months), avg, and a cap_5to10
--   column that DIVERGED from cap_6to10 whenever [5,6)yr sales existed. Rebuilt
--   as the monthly twin of the already-healthy cm_gov_cap_by_term_q.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Unit 1a — reversible anomaly flag on cap_rate_history
-- ---------------------------------------------------------------------
ALTER TABLE public.cap_rate_history
  ADD COLUMN IF NOT EXISTS is_anomaly boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS anomaly_reason text,
  ADD COLUMN IF NOT EXISTS anomaly_tagged_at timestamptz;

COMMENT ON COLUMN public.cap_rate_history.is_anomaly IS
  'T9 (2026-06-25): TRUE = derived cap materially exceeds the matched sale''s validated sold_cap_rate (portfolio price-split or gross-as-NOI derivation error). Excluded from cm_gov_core_cap_rate_dots. Reversible: UPDATE ... SET is_anomaly=false.';

-- ---------------------------------------------------------------------
-- Unit 1b — tag the inflated derived 'sale' caps (robust anchor)
--   Anchor = MIN sold_cap_rate among the NON-EXCLUDED sales at that
--   (property_id, sale_date) i.e. the real full-price comp (partial
--   allocations carry exclude_from_market_metrics=true and an inflated
--   sold_cap of their own, so they are NOT used as the anchor).
--   Flag when derived > anchor*1.20 AND derived-anchor > 0.012.
--   Live result: 176 rows tagged (28 price_split + 148 income_gt_validated)
--   across ~132 properties.
-- ---------------------------------------------------------------------
WITH cand AS (
  SELECT crh.id, crh.price_at_event, a.anchor_cap, a.anchor_price
  FROM public.cap_rate_history crh
  JOIN LATERAL (
     SELECT min(s2.sold_cap_rate) AS anchor_cap,
            (array_agg(s2.sold_price ORDER BY s2.sold_cap_rate))[1] AS anchor_price
     FROM public.sales_transactions s2
     WHERE s2.property_id = crh.property_id AND s2.sale_date = crh.event_date
       AND s2.sold_cap_rate IS NOT NULL
       AND NOT COALESCE(s2.exclude_from_market_metrics, false)) a ON true
  WHERE crh.event_type = 'sale' AND crh.cap_rate IS NOT NULL
    AND a.anchor_cap BETWEEN 0.03 AND 0.13
    AND crh.cap_rate > a.anchor_cap * 1.20
    AND crh.cap_rate - a.anchor_cap > 0.012
)
UPDATE public.cap_rate_history h
   SET is_anomaly = true,
       anomaly_reason = CASE WHEN h.price_at_event IS DISTINCT FROM cand.anchor_price
                             THEN 'price_split' ELSE 'income_gt_validated' END,
       anomaly_tagged_at = COALESCE(h.anomaly_tagged_at, now())
  FROM cand
 WHERE h.id = cand.id AND NOT h.is_anomaly;

-- ---------------------------------------------------------------------
-- Unit 1c — dot scatter excludes anomalous crh, falls back to sold_cap_rate
--   The COALESCE fallback now lives OUTSIDE the crh subquery, so a skipped
--   (anomalous) or absent crh row falls back to the validated market cap
--   instead of dropping the dot. Non-anomalous sales are byte-identical.
--   Result: visible dots 503->682 (real comps previously hidden out-of-band
--   by inflated caps re-appear at their true cap); max 11.97%->8.76%; 0 over 9%.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.cm_gov_core_cap_rate_dots AS
 SELECT sale_date,
    CASE
        WHEN (s.cap_rate_quality = 'implausible_unverified'::text) THEN NULL::numeric
        ELSE COALESCE(
               ( SELECT crh.cap_rate
                   FROM cap_rate_history crh
                  WHERE ((crh.property_id = s.property_id) AND (crh.event_date = s.sale_date)
                     AND (crh.event_type = 'sale'::cap_rate_event_type) AND (crh.cap_rate IS NOT NULL)
                     AND (NOT crh.is_anomaly)
                     AND ((crh.income_source IS NULL) OR (crh.income_source !~~ 'folder_feed_%'::text)))
                  ORDER BY crh.created_at DESC
                 LIMIT 1),
               s.sold_cap_rate, s.last_cap_rate, s.initial_cap_rate)
    END AS cap_rate,
    (COALESCE(firm_term_years_at_sale, ( SELECT ((l.firm_term_years - GREATEST((0)::numeric, (EXTRACT(epoch FROM ((s.sale_date)::timestamp without time zone - (COALESCE(l.commencement_date, l.effective_date, s.sale_date))::timestamp without time zone)) / (86400.0 * 365.25)))))::numeric(5,2) AS "numeric"
           FROM leases l
          WHERE ((l.property_id = s.property_id) AND (l.firm_term_years IS NOT NULL) AND (l.expiration_date >= s.sale_date) AND ((l.commencement_date IS NULL) OR (l.commencement_date <= s.sale_date)) AND (COALESCE(l.effective_date, l.commencement_date, s.sale_date) <= s.sale_date) AND ((l.superseded_at IS NULL) OR ((l.superseded_at)::date > s.sale_date)))
          ORDER BY COALESCE(l.effective_date, l.commencement_date) DESC NULLS LAST, l.expiration_date DESC
         LIMIT 1)))::numeric(5,2) AS firm_term_years,
    is_northmarq,
    sold_price
   FROM sales_transactions s
  WHERE ((sale_date IS NOT NULL) AND (sold_price IS NOT NULL) AND (sold_price > (0)::numeric) AND (NOT COALESCE(exclude_from_market_metrics, false)));

-- ---------------------------------------------------------------------
-- Unit 2 — rebuild cm_gov_cap_by_term_m as the monthly twin of _q
--   2-yr TTM window + median + n>=5 density floor per cohort (thin buckets
--   GAP, no round-number pins) + ±3-mo MA. Canonical cohorts 10+/6-10/<5/Outside
--   (matches the chart legend + export header). cap_5to10 kept as a NON-
--   divergent ALIAS of the canonical 6-10 cohort (the export already coalesces
--   ['cap_6to10','cap_5to10']) so no consumer breaks and the duplicate can no
--   longer diverge. Column shape unchanged -> CREATE OR REPLACE preserves grants
--   + the v_property_value_signal dependent. cap_outside_firm = sales with no
--   resolvable firm term (matches _q). Live: cohorts now move smoothly
--   (0.0707-0.0728), 0 round-number pins, cap_outside_firm repopulated.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.cm_gov_cap_by_term_m AS
 WITH months AS (
   SELECT ((date_trunc('month', g.d) + '1 mon -1 days'::interval))::date AS period_end
     FROM generate_series('2005-01-01'::date::timestamptz, cm_last_completed_quarter_end()::timestamptz, '1 mon'::interval) g(d)
 ), classified AS MATERIALIZED (
   SELECT s.sale_date,
          CASE WHEN s.cap_rate_quality = 'implausible_unverified'::text THEN NULL::numeric ELSE s.sold_cap_rate END AS cap,
          COALESCE(LEAST(s.firm_term_years_at_sale,
            ( SELECT ((gl.termination_date - s.sale_date))::numeric / 365.0
                FROM gsa_leases gl
               WHERE gl.property_id = s.property_id AND gl.lease_expiration >= s.sale_date AND gl.termination_date IS NOT NULL
               ORDER BY gl.lease_expiration DESC LIMIT 1),
            ( SELECT l.firm_term_years - ((s.sale_date - l.commencement_date)::numeric / 365.0)
                FROM leases l
               WHERE l.property_id = s.property_id AND l.expiration_date >= s.sale_date AND l.commencement_date IS NOT NULL AND l.firm_term_years IS NOT NULL
               ORDER BY l.expiration_date DESC LIMIT 1)),
            s.firm_term_years,
            CASE WHEN s.lease_expiration IS NOT NULL AND s.lease_expiration >= s.sale_date
                 THEN (s.lease_expiration - s.sale_date)::numeric / 365.0 ELSE NULL::numeric END) AS firm_rem
     FROM sales_transactions s
    WHERE s.sale_date IS NOT NULL AND s.sold_price > 0::numeric
      AND s.sold_cap_rate >= 0.04 AND s.sold_cap_rate <= 0.12
      AND NOT COALESCE(s.exclude_from_market_metrics, false)
 ), ttm AS (
   SELECT m.period_end,
     percentile_disc(0.5) WITHIN GROUP (ORDER BY c.cap) FILTER (WHERE c.firm_rem > 10::numeric) AS c10,
     count(*) FILTER (WHERE c.firm_rem > 10::numeric) AS n10,
     percentile_disc(0.5) WITHIN GROUP (ORDER BY c.cap) FILTER (WHERE c.firm_rem > 5::numeric AND c.firm_rem <= 10::numeric) AS c610,
     count(*) FILTER (WHERE c.firm_rem > 5::numeric AND c.firm_rem <= 10::numeric) AS n610,
     percentile_disc(0.5) WITHIN GROUP (ORDER BY c.cap) FILTER (WHERE c.firm_rem IS NOT NULL AND c.firm_rem <= 5::numeric) AS c5,
     count(*) FILTER (WHERE c.firm_rem IS NOT NULL AND c.firm_rem <= 5::numeric) AS n5,
     percentile_disc(0.5) WITHIN GROUP (ORDER BY c.cap) FILTER (WHERE c.cap IS NOT NULL AND c.firm_rem IS NULL) AS cout,
     count(*) FILTER (WHERE c.cap IS NOT NULL AND c.firm_rem IS NULL) AS nout
     FROM months m
     LEFT JOIN classified c ON c.sale_date > (m.period_end - '2 years'::interval)::date AND c.sale_date <= m.period_end
    GROUP BY m.period_end
 ), gated AS (
   SELECT period_end,
     CASE WHEN n10  >= 5 THEN c10  ELSE NULL::numeric END AS cap_10plus_g,
     CASE WHEN n610 >= 5 THEN c610 ELSE NULL::numeric END AS cap_6to10_g,
     CASE WHEN n5   >= 5 THEN c5   ELSE NULL::numeric END AS cap_less5_g,
     CASE WHEN nout >= 5 THEN cout ELSE NULL::numeric END AS cap_outside_g
     FROM ttm
 )
 SELECT period_end,
   'all'::text AS subspecialty,
   avg(cap_10plus_g)  OVER w AS cap_10plus,
   avg(cap_6to10_g)   OVER w AS cap_6to10,
   avg(cap_6to10_g)   OVER w AS cap_5to10,   -- alias of the canonical 6-10 cohort (no divergence)
   avg(cap_less5_g)   OVER w AS cap_less5,
   avg(cap_outside_g) OVER w AS cap_outside_firm
 FROM gated
 WINDOW w AS (ORDER BY period_end ROWS BETWEEN 3 PRECEDING AND 3 FOLLOWING)
 ORDER BY period_end;

-- =====================================================================
-- ROLLBACK (reversible):
--   UPDATE public.cap_rate_history SET is_anomaly=false, anomaly_reason=NULL,
--          anomaly_tagged_at=NULL WHERE is_anomaly;            -- un-tag
--   -- then re-create cm_gov_core_cap_rate_dots / cm_gov_cap_by_term_m from
--   -- their pre-T9 definitions (captured in git history).
-- Unit 3 (dia asking-cap quartiles) is investigate-only — NO DB change here
-- (see docs/capital-markets/T9_CAP_DATA_INTEGRITY_2026-06-25.md).
-- =====================================================================
