-- R2-D follow-up (dia) — PRICE-HISTORY FLOOR on the core price-change cohort of
-- cm_dialysis_dom_price_change_active_m, layered on top of the R2-C density floor.
--
-- WHY (grounded live 2026-06-30, dia zqzrriwuavgrquhisnoa):
--   pct_price_change_core read exactly 0.0000 for 2025-12 .. 2026-03 because the
--   core denominator (had_price_change-observable core listings) is 16-19 while the
--   NUMERATOR is 0 — and the whole 16-19 pool consists of listings with NO real
--   price history (single OM asking price; had_price_change=false, initial=last).
--   These no-history listings (incl. the recovered date_uncertain inventory) are
--   counted as "no-change" denominator votes, dragging the rate to a misleading 0.
--   The R2-C density floor (denom_core_raw >= 16) does NOT catch them because the
--   recovery PUSHED the denom to >= 16.
--
--   Grounding refuted a literal "denominator = listings with >=2 price observations":
--   dia's listing_price_history is EMPTY (0 rows globally), and price_change_history
--   / price_change_date are NULL across the entire recent core set, so the only
--   evidence of >=2 distinct observed prices is had_price_change OR initial<>last.
--   Replacing the denominator with that count collapses the GENUINE era to a
--   degenerate 1.0 (every history-bearing dia listing is one that changed price).
--   So instead of replacing the denominator (degenerate), this GATES the rate:
--   emit pct_price_change_core only when the core pool carries >=1 listing with real
--   price-history evidence. Net effect (verified live): exactly 2025-12, 2026-01,
--   2026-02, 2026-03 flip 0.0000 -> NULL; every genuine-rate period is byte-identical
--   (denom_core_history_raw >= 3 there). The 'all' cohort is untouched. Charts render
--   NULL as a gap (dispBlanksAs='gap' / spanGaps:false), so the line ends honestly
--   where the core pool has no price history.
--
-- Reversible: re-create the prior R2-C body (drop denom_core_history_raw + the
-- second gate term — see 20260629_dia_r2c_unit1_active_dom_pc_core_density_floor.sql).
-- Additive view-only change; no domain-row writes.

CREATE OR REPLACE VIEW public.cm_dialysis_dom_price_change_active_m AS
 WITH raw AS (
         SELECT cm_dialysis_active_listings_m.period_end,
            avg(cm_dialysis_active_listings_m.days_on_market) FILTER (WHERE cm_dialysis_active_listings_m.days_on_market >= 0 AND cm_dialysis_active_listings_m.days_on_market <= 730) AS dom_total_raw,
            avg(cm_dialysis_active_listings_m.days_on_market) FILTER (WHERE cm_dialysis_active_listings_m.is_core_10plus AND cm_dialysis_active_listings_m.days_on_market >= 0 AND cm_dialysis_active_listings_m.days_on_market <= 730) AS dom_core_raw,
            count(*) FILTER (WHERE cm_dialysis_active_listings_m.had_price_change)::numeric / NULLIF(count(*) FILTER (WHERE cm_dialysis_active_listings_m.had_price_change IS NOT NULL), 0)::numeric AS pct_total_raw,
            count(*) FILTER (WHERE cm_dialysis_active_listings_m.had_price_change AND cm_dialysis_active_listings_m.is_core_10plus)::numeric / NULLIF(count(*) FILTER (WHERE cm_dialysis_active_listings_m.had_price_change IS NOT NULL AND cm_dialysis_active_listings_m.is_core_10plus), 0)::numeric AS pct_core_raw,
            -- R2-C Unit 1: core price-change density (observable core listings).
            count(*) FILTER (WHERE cm_dialysis_active_listings_m.had_price_change IS NOT NULL AND cm_dialysis_active_listings_m.is_core_10plus) AS denom_core_raw,
            -- R2-D price-history floor: core listings with evidence of >=2 distinct
            -- observed prices (a real price history). dia stores no per-observation
            -- price history (listing_price_history empty), so the available evidence
            -- is a recorded change: had_price_change OR initial<>last.
            count(*) FILTER (
              WHERE cm_dialysis_active_listings_m.is_core_10plus
                AND (cm_dialysis_active_listings_m.had_price_change
                     OR (cm_dialysis_active_listings_m.initial_price IS NOT NULL
                         AND cm_dialysis_active_listings_m.last_price IS NOT NULL
                         AND cm_dialysis_active_listings_m.initial_price <> cm_dialysis_active_listings_m.last_price))
            ) AS denom_core_history_raw
           FROM cm_dialysis_active_listings_m
          GROUP BY cm_dialysis_active_listings_m.period_end
         HAVING count(*) >= 8
        )
 SELECT raw.period_end,
    'all'::text AS subspecialty,
    avg(raw.dom_total_raw) OVER w AS avg_dom_total,
    avg(raw.dom_core_raw) OVER w AS avg_dom_core,
    raw.pct_total_raw AS pct_price_change_total,
    -- R2-C density floor (>=16) AND R2-D price-history floor (>=1 history listing):
    -- gap (NULL) when the core pool has no real price history, instead of a
    -- noise-/no-history-driven 0.
    CASE WHEN raw.denom_core_raw >= 16 AND raw.denom_core_history_raw >= 1
         THEN raw.pct_core_raw ELSE NULL::numeric END AS pct_price_change_core
   FROM raw
  WINDOW w AS (ORDER BY raw.period_end ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING)
  ORDER BY raw.period_end;
