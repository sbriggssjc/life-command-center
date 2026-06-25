-- T4c Item 3 follow-up (Scott, 2026-06-24): close the stale-open recovered gov spans.
-- Applied live to gov (scknotsqkcheojiaewwh).
--
-- sf_on_market_date recovered listings with off_market_date NULL AND last_verified_at
-- NULL/>12mo (never re-verified) ran open-ended in the gov active-over-time series
-- (eff_end = COALESCE(off_market_date, on_market_date + 18mo)), inflating recent
-- inventory with unverified listings. The assumed "last-verified signal" does NOT exist
-- for them: last_verified_at is NULL and updated_at/created_at are the recent (2026-06)
-- recovery import, not a verification. So the only trustworthy on-market evidence date
-- is on_market_date itself — close each span there.
--
-- Effect: eff_end becomes on_market_date (= eff_start), so the row no longer counts in
-- active_count at any month-end (removes the unverified active tail + drops them from
-- current-available), while new_to_market / added_ttm / added_month — which key on
-- on_market_date (eff_start) + the addable flag, NOT off_market_date — are PRESERVED, so
-- the real market-entry signal is kept. Verified live: 41 closed (set count had drifted
-- 81 -> 41 as a verification cron re-verified the rest), 0 stale-open recovered spans
-- remain; 11 of the 41 had been inflating the recent edge (+18mo span >= 2025-01); the
-- other 30 had long-past spans (cleaned for honesty, no recent-edge effect). added_ttm
-- unchanged (entries preserved). Marked off_market_reason='unverified_assumed_off'
-- (existing vocab) + listing_status='off_market' for audit/reversibility. is_active is a
-- generated column and derives from the close.
--
-- REVERT: UPDATE public.available_listings
--   SET off_market_date=NULL, listing_status='active', off_market_reason=NULL
--   WHERE off_market_reason='unverified_assumed_off'
--     AND on_market_date_source='sf_on_market_date' AND off_market_date = on_market_date;

UPDATE public.available_listings
   SET off_market_date   = on_market_date,
       off_market_reason = 'unverified_assumed_off',
       listing_status    = 'off_market'
 WHERE on_market_date_source = 'sf_on_market_date'
   AND off_market_date IS NULL
   AND (last_verified_at IS NULL OR last_verified_at < (CURRENT_DATE - interval '12 months'));
