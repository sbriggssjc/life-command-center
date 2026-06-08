-- =============================================================================
-- Round 73 Layer B — #20 gov nm_vs_market presentation window (Scott-gated).
-- Project: government (scknotsqkcheojiaewwh). APPLIED LIVE 2026-06-08.
--
-- After the is_northmarq re-derivation the clean NM cohort is small (1-2
-- deals/yr recently), so the 1yr TTM + n>=3 gate blanked the NM line from 2024.
-- Fix: 2-YEAR TTM on BOTH lines (apples-to-apples; honestly pools ~5-6 real NM
-- deals so the value-proposition line stays continuous, matching the deck's
-- smooth NM line), gate n>=3, DROP output smoothing +/-4mo -> +/-2mo to avoid
-- double-smoothing now the 2yr pool stabilizes the average. Presentation-window
-- only -- no fabricated deals.
--
-- CAVEAT (reports/CM_ROUND73_LAYER_B_RECEIPTS.md): the 2yr window keeps the NM
-- line continuous but its 2yr market avg lags the rising-cap years, so on the
-- 2yr basis the recent NM line reads slightly ABOVE market; on a 1yr basis the
-- clean NM sits ~8bps BELOW market. The deck's clear NM-below relationship needs
-- the cap-rate-basis follow-up (master-curated caps), not just the window.
-- =============================================================================
DO $$
DECLARE v text;
BEGIN
  v := pg_get_viewdef('public.cm_gov_nm_vs_market_m'::regclass, true);
  v := replace(v, '(sp.period_end - ''1 year''::interval)::date', '(sp.period_end - ''2 years''::interval)::date');
  v := replace(v, 'ROWS BETWEEN 4 PRECEDING AND 4 FOLLOWING', 'ROWS BETWEEN 2 PRECEDING AND 2 FOLLOWING');
  EXECUTE 'CREATE OR REPLACE VIEW public.cm_gov_nm_vs_market_m AS ' || v;
END $$;
