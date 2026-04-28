-- ============================================================================
-- Round 76bb — Dialysis data completeness cleanup
--
-- 1. 302 recent sales had buyer_name set but recorded_owner_name=NULL.
--    Backfill recorded_owner_name = buyer_name (legal owner ≈ buyer
--    after sale until deed records say otherwise).
--
-- 2. 632 leases marked is_active=TRUE with both lease_start AND
--    lease_expiration NULL — placeholder data. Mark status='placeholder'
--    + is_active=FALSE so dashboard doesn't show them as current and
--    they don't pollute multi-active-lease counts.
-- ============================================================================

UPDATE public.sales_transactions
   SET recorded_owner_name = buyer_name
 WHERE recorded_owner_name IS NULL
   AND buyer_name IS NOT NULL AND TRIM(buyer_name) <> '';

UPDATE public.leases
   SET status = 'placeholder', is_active = FALSE
 WHERE is_active = TRUE
   AND lease_start IS NULL AND lease_expiration IS NULL;
