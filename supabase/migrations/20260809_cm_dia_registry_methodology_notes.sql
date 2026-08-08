-- ============================================================================
-- CM chart feedback item #7 + #9 (C1) — registry methodology notes (no formula change)
-- Target: Dialysis_DB (zqzrriwuavgrquhisnoa)
-- ============================================================================
-- Document, in cm_view_registry.notes, that the available-market-size avg caps
-- and the active cap quartiles are point-in-time active-cohort statistics whose
-- apparent smoothness reflects slow inventory turnover (~470-day avg DOM),
-- verified against the snapshot cohort. Verified-correct-as-built — NO formula
-- change. Idempotent UPDATE.
-- ============================================================================

UPDATE cm_view_registry SET notes =
  'CM feedback item #9 (verified correct): avg_cap_total/avg_cap_core are point-in-time averages of last_cap_rate across the active listing cohort each period (0.04-0.12 band, same active base as the rest). Values change nearly every period (37 of 38); apparent smoothness reflects SLOW inventory turnover (~470-day avg DOM) so adjacent months share most listings. No formula change — y-axis policy (A3) makes the moves more visible.'
WHERE view_name = 'cm_dialysis_available_market_size_q';

UPDATE cm_view_registry SET notes =
  'CM feedback item #7 (verified correct): each point is the true upper/lower quartile (percentile_cont) of the disclosed-cap active cohort at that period, matching the snapshot. Flat runs of 4-10 months are the market, not the formula: with ~470-day avg DOM the active pool turns over slowly so adjacent months share most listings and quartiles move in small steps. Point-in-time single-period cohort (R73 2yr-pool reverted). No formula change.'
WHERE view_name IN ('cm_dialysis_asking_cap_quartiles_active_m', 'cm_dialysis_asking_cap_quartiles_active_q');
