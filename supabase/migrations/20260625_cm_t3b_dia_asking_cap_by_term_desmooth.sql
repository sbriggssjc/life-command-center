-- =============================================================================
-- T3b-asking — de-smooth the dia ASKING cap-by-term chart
-- Project: Dialysis_DB (zqzrriwuavgrquhisnoa). Applied live 2026-06-25.
--
-- Mirrors the T3 sold-side fix: the Asking Cap Rate Ranges by Lease Term chart
-- "moved too smoothly" because cm_dialysis_asking_cap_by_term_m applied a
-- 7-month CENTERED moving average (avg(...) OVER w, ROWS BETWEEN 3 PRECEDING
-- AND 3 FOLLOWING) ON TOP of an already 2-year-TTM average + n>=5 per-bucket
-- density gate. The sold equivalent cm_dialysis_sold_cap_by_term_dot carries no
-- window function (T3 removed it). This removes the redundant rolling MA so the
-- asking line shows real month-over-month movement.
--
-- KEEP: the 2-year TTM window, the n>=5 per-bucket density floor (NULLs thin
-- buckets -> gap-honest, T1b), and the dia 4-bucket scheme (12+/8-12/6-8/<=5).
-- Only the OVER w MA goes — the bucket caps now equal the gated TTM values.
-- The asking line is genuinely noisier than closed sales (asking caps are seller
-- pricing); that is correct — do NOT re-introduce a moving average.
--
-- No _q/dot variant exists for asking (only the _m view), so this is the single
-- lever for the asking_cap_by_term_dot_plot chart.
--
-- Reversible: re-create the prior body by restoring the final SELECT to
--   avg(gated.cap_<bucket>_g) OVER w AS cap_<bucket>
--   ... WINDOW w AS (ORDER BY gated.period_end ROWS BETWEEN 3 PRECEDING AND 3 FOLLOWING)
-- View def only; no data/row writes. ≤12 api/*.js (no JS change).
-- =============================================================================
CREATE OR REPLACE VIEW public.cm_dialysis_asking_cap_by_term_m AS
 WITH base AS (
         SELECT cm_dialysis_active_listings_m.period_end,
            cm_dialysis_active_listings_m.last_cap_rate AS cap,
            cm_dialysis_active_listings_m.firm_term_years AS term
           FROM cm_dialysis_active_listings_m
          WHERE ((cm_dialysis_active_listings_m.last_cap_rate IS NOT NULL) AND (cm_dialysis_active_listings_m.last_cap_rate >= 0.04) AND (cm_dialysis_active_listings_m.last_cap_rate <= 0.12) AND (cm_dialysis_active_listings_m.firm_term_years IS NOT NULL))
        ), month_anchors AS (
         SELECT DISTINCT base.period_end
           FROM base
        ), ttm AS (
         SELECT m.period_end,
            avg(b.cap) FILTER (WHERE (b.term >= (12)::numeric)) AS cap_12plus_raw,
            count(*) FILTER (WHERE (b.term >= (12)::numeric)) AS cap_12plus_n,
            avg(b.cap) FILTER (WHERE ((b.term >= (8)::numeric) AND (b.term < (12)::numeric))) AS cap_8to12_raw,
            count(*) FILTER (WHERE ((b.term >= (8)::numeric) AND (b.term < (12)::numeric))) AS cap_8to12_n,
            avg(b.cap) FILTER (WHERE ((b.term > (5)::numeric) AND (b.term < (8)::numeric))) AS cap_6to8_raw,
            count(*) FILTER (WHERE ((b.term > (5)::numeric) AND (b.term < (8)::numeric))) AS cap_6to8_n,
            avg(b.cap) FILTER (WHERE (b.term <= (5)::numeric)) AS cap_5orless_raw,
            count(*) FILTER (WHERE (b.term <= (5)::numeric)) AS cap_5orless_n
           FROM (month_anchors m
             LEFT JOIN base b ON (((b.period_end > ((m.period_end - '2 years'::interval))::date) AND (b.period_end <= m.period_end))))
          GROUP BY m.period_end
        ), gated AS (
         SELECT ttm.period_end,
                CASE
                    WHEN (ttm.cap_12plus_n >= 5) THEN ttm.cap_12plus_raw
                    ELSE NULL::numeric
                END AS cap_12plus_g,
                CASE
                    WHEN (ttm.cap_8to12_n >= 5) THEN ttm.cap_8to12_raw
                    ELSE NULL::numeric
                END AS cap_8to12_g,
                CASE
                    WHEN (ttm.cap_6to8_n >= 5) THEN ttm.cap_6to8_raw
                    ELSE NULL::numeric
                END AS cap_6to8_g,
                CASE
                    WHEN (ttm.cap_5orless_n >= 5) THEN ttm.cap_5orless_raw
                    ELSE NULL::numeric
                END AS cap_5orless_g,
            ttm.cap_12plus_n,
            ttm.cap_8to12_n,
            ttm.cap_6to8_n,
            ttm.cap_5orless_n
           FROM ttm
        )
 SELECT gated.period_end,
    'all'::text AS subspecialty,
    gated.cap_12plus_g AS cap_12plus,
    gated.cap_8to12_g AS cap_8to12,
    gated.cap_6to8_g AS cap_6to8,
    gated.cap_5orless_g AS cap_5orless,
    gated.cap_12plus_n,
    gated.cap_8to12_n,
    gated.cap_6to8_n,
    gated.cap_5orless_n
   FROM gated
  ORDER BY gated.period_end;
