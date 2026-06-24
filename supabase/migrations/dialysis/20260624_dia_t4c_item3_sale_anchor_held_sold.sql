-- T4c Item 3 follow-up (Scott, 2026-06-24): restore real SOLD inventory to the
-- historical CM timing series. Of the 1,349 held-NULL dia listings
-- (on_market_date_source='unestablished'), 571 are genuinely SOLD (carry sold_date)
-- = real inventory that dropped out of the added/inventory-ramp series when the
-- timing views repointed to on_market_date. Sale-anchor their on_market_date using
-- the SAME method/offset as the existing dia sale-anchored sources
-- (sold_date - 175 days = the cohort imputed/median DOM; cf. round70_d10
-- 'synth_sale_minus_median_dom'), under a DISTINCT, reversible source tag.
--
-- Leaves held (on_market_date NULL): the 584 truly-dateless-open rows (no sold_date,
-- no off_market_date) AND the 194 off-market-not-sold rows — neither carries a
-- verifiable on-market date. Applied live 2026-06-24 (zqzrriwuavgrquhisnoa).
--
-- Effect (isolation check, published <=2026-03-31): dia inventory_backlog `added`
-- net delta vs the old listing_date series closed -6,411 -> -1,360 (~79% restored);
-- the residual is the intentionally-held 194 off-not-sold rows + the benign 196d->175d
-- offset vs the old COALESCE(listing_date, sold-196d) fallback. The point-in-time
-- active count is unchanged (118) — these are SOLD, excluded from active_listings.
--
-- NOTE (DOM side-effect, surfaced for review — NOT changed here): these rows carry a
-- non-synthetic data_source, so they flow into the DOM-of-sold series
-- (cm_dialysis_dom_pct_ask_m/_q) at a circular imputed 175-day DOM, exactly like the
-- pre-existing sale_anchor_est_175 rows. After this backfill the dia DOM-of-sold
-- population is ~60% imputed (876/1,453). If observed-only DOM is wanted, exclude the
-- sale-anchored on_market_date sources from those two views (a separate, blessed change).
--
-- REVERT:
--   UPDATE public.available_listings
--      SET on_market_date=NULL, on_market_date_source='unestablished', on_market_date_confidence='none'
--    WHERE on_market_date_source='synth_sale_minus_median_dom_held';

UPDATE public.available_listings
   SET on_market_date            = (sold_date - 175),
       on_market_date_source     = 'synth_sale_minus_median_dom_held',
       on_market_date_confidence = 'low'
 WHERE on_market_date_source = 'unestablished'
   AND on_market_date IS NULL
   AND sold_date IS NOT NULL;
