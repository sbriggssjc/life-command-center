-- =============================================================================
-- Round 66x — LINEAGE RECORD (no-op): rent_at_sale lease-coverage backfill was
-- applied then reverted. This file exists so the migration history's apply+revert
-- pair has a repo-backed explanation. It changes NOTHING.
-- Project: Dialysis_DB (zqzrriwuavgrquhisnoa) | Date: 2026-06-04
--
-- WHAT HAPPENED (two prior migrations in this project's history):
--   1. cm_round66x_dia_rent_at_sale_lease_coverage_backfill
--      -> set rent_at_sale = in-effect lease annual_rent for 507 no-rent market
--         sales (gated; +19pp coverage), to give the short-cohort deals a
--         noi_derived cap of record.
--   2. cm_round66x_revert_rent_lease_backfill_degrades_deck
--      -> reverted #1. The re-measure showed it moved the deck SUCCESS METRIC the
--         WRONG way (Dec-2025 <=5 7.45% -> 7.22%, 6-8 6.88% -> 6.76%): the
--         cap-of-record ladder ranks noi_derived(rent/price) ABOVE the R66x tier-4
--         stored calculated_cap_rate, and lease in-place rent (~6.6-7.5%, even
--         projected to sale) is LOWER than the calc caps (~8.3%) that were already
--         closest to the deck. Net data effect of #1 + #2 = ZERO.
--
-- DO NOT RE-RUN the lease-table rent backfill expecting it to close the deck's
-- short-cohort gap. The deck's high <=5 caps require genuine going-in / in-place
-- NOI (OM "actual", CMBS net cash flow, sale underwriting), NOT lease Y1 base
-- rent. The proper next increment is the OM/CMBS in-place-NOI capture scoped in
-- docs/capital-markets/CLAUDE_CODE_PROMPT_dia_data_integrity_MASTER.md (Phase 1).
--
-- Reference (validated R66x baseline this episode restored): the unified by-term
-- cohorts at Dec-2025 = 12+ 6.80 / 8-12 6.60 / 6-8 6.88 / <=5 7.45.
-- =============================================================================
DO $$
BEGIN
  RAISE NOTICE 'R66x lineage record: rent_at_sale lease-coverage backfill applied then reverted (net-zero). See file header / Phase-1 scope. No action taken.';
END $$;
