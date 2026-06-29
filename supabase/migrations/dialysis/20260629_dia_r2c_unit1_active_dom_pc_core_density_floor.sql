-- R2-C Unit 1 (dia) — density floor on the 10+/core price-change cohort of
-- cm_dialysis_dom_price_change_active_m so it GAPS (NULL) instead of diving to
-- a hard 0.0000 when the core pool thins.
--
-- Grounded live 2026-06-29 (dia zqzrriwuavgrquhisnoa):
--   pct_price_change_core = 0.0000 for 2025-12 .. 2026-03 (had real values
--   through 2025-11). The cohort denominator is NOT empty (13-15 core listings)
--   — the metric collapses because its NUMERATOR is structurally 0 or 1 across
--   the whole history (it is a single listing toggling, not a rate). Historic
--   core denom averaged ~42 (max 113, num up to 22 in 2015-2024); it collapsed
--   to 8-16 with num 0-1 in 2025+, so the rate is single-listing noise and reads
--   exactly 0 once that one listing leaves the pool.
--
-- Fix: emit pct_price_change_core only when the core price-change denominator
-- (had_price_change-observable core listings) is >= 16 — the level below which
-- the numerator is structurally 0/1 (verified: every period with core denom < 16
-- in 2024-2026 carries num <= 1). This preserves the genuine-rate era
-- 2015-2024 (core denom >= 19 except the 2024-12 edge) and gaps the
-- single-listing 2025+ tail incl. the grounded 0.0000 cliff. The 'all' cohort
-- (denom ~190, num 8-18) is untouched. Charts render NULL as a gap
-- (dispBlanksAs='gap' / spanGaps:false), so the line ends honestly where the
-- core cohort thins.
--
-- Reversible: re-create the prior body (no density gate on pct_core_raw).

CREATE OR REPLACE VIEW public.cm_dialysis_dom_price_change_active_m AS
 WITH raw AS (
         SELECT cm_dialysis_active_listings_m.period_end,
            avg(cm_dialysis_active_listings_m.days_on_market) FILTER (WHERE cm_dialysis_active_listings_m.days_on_market >= 0 AND cm_dialysis_active_listings_m.days_on_market <= 730) AS dom_total_raw,
            avg(cm_dialysis_active_listings_m.days_on_market) FILTER (WHERE cm_dialysis_active_listings_m.is_core_10plus AND cm_dialysis_active_listings_m.days_on_market >= 0 AND cm_dialysis_active_listings_m.days_on_market <= 730) AS dom_core_raw,
            count(*) FILTER (WHERE cm_dialysis_active_listings_m.had_price_change)::numeric / NULLIF(count(*) FILTER (WHERE cm_dialysis_active_listings_m.had_price_change IS NOT NULL), 0)::numeric AS pct_total_raw,
            count(*) FILTER (WHERE cm_dialysis_active_listings_m.had_price_change AND cm_dialysis_active_listings_m.is_core_10plus)::numeric / NULLIF(count(*) FILTER (WHERE cm_dialysis_active_listings_m.had_price_change IS NOT NULL AND cm_dialysis_active_listings_m.is_core_10plus), 0)::numeric AS pct_core_raw,
            -- R2-C Unit 1: core price-change density (observable core listings).
            count(*) FILTER (WHERE cm_dialysis_active_listings_m.had_price_change IS NOT NULL AND cm_dialysis_active_listings_m.is_core_10plus) AS denom_core_raw
           FROM cm_dialysis_active_listings_m
          GROUP BY cm_dialysis_active_listings_m.period_end
         HAVING count(*) >= 8
        )
 SELECT raw.period_end,
    'all'::text AS subspecialty,
    avg(raw.dom_total_raw) OVER w AS avg_dom_total,
    avg(raw.dom_core_raw) OVER w AS avg_dom_core,
    raw.pct_total_raw AS pct_price_change_total,
    -- R2-C Unit 1: gap below the density floor (16) instead of a noise-driven 0.
    CASE WHEN raw.denom_core_raw >= 16 THEN raw.pct_core_raw ELSE NULL::numeric END AS pct_price_change_core
   FROM raw
  WINDOW w AS (ORDER BY raw.period_end ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING)
  ORDER BY raw.period_end;
