-- ============================================================================
-- R21 Unit 4 — retire the vestigial R5 listing-event cohort fan-out
-- ============================================================================
-- The R5 sale-event cohort fan-out (v_lcc_listing_event_queue +
-- lcc_listing_same_owner_cohort / _buyer_cohort / _geographic_neighbors +
-- lcc_mark_listing_event_processed) was built to fan a sale event out to the
-- seller's same-owner cohort / the buyer's other holdings / geographic
-- neighbors. Grounded live 2026-06-15: lcc_listing_events has 61 rows, 0 ever
-- processed (processed_at null on all), stale since 2026-05-22 — and a code
-- grep finds NO live JS caller of the queue view or the three cohort functions.
-- It is a dead path. Meanwhile the LIVE CoStar/availability listing→BD path
-- (listing_bd_runs) is active and owns listing-driven BD.
--
-- SCOPE CORRECTION (per the "grep first" instruction — domain truth outranks the
-- literal ask): the prompt suggested dropping lcc_listing_events itself, but a
-- live dependency check shows the TABLE is still consumed by buyer-SPE
-- classification views that feed the priority queue's P-BUYER gate:
--   v_lcc_buyer_spe_entities_live, v_lcc_buyer_name_canonical,
--   v_lcc_entity_tier0_parent.
-- Dropping the table would break the P-BUYER gate. So we retire ONLY the dead
-- cohort fan-out consumer (the queue view + the four functions, which have no
-- dependents and no callers) and KEEP the table + its sync crons
-- (lcc-listing-event-sync-fire/-finalize), which are not dead weight.
--
-- Reversible: re-applying the original R5 migrations
-- (20260522270000 / 280100 / 290000 / 330000) re-creates these objects.
-- Additive-safe DROP IF EXISTS. Auth schema untouched.
-- Apply on LCC Opps (xengecqvemvfknjvbvrq).
-- ============================================================================

-- The 0-processed cohort queue view (no dependents — verified live).
DROP VIEW IF EXISTS public.v_lcc_listing_event_queue;

-- The three cohort fan-out functions (no live JS callers — verified by grep).
DROP FUNCTION IF EXISTS public.lcc_listing_same_owner_cohort(text, text);
DROP FUNCTION IF EXISTS public.lcc_listing_buyer_cohort(text, text, numeric, integer, integer);
DROP FUNCTION IF EXISTS public.lcc_listing_geographic_neighbors(text, text, numeric, integer);

-- The processed-marker for the dead queue workflow.
DROP FUNCTION IF EXISTS public.lcc_mark_listing_event_processed(uuid, timestamptz);

-- NOTE: lcc_listing_events (+ _retract_backup_*, the sync_inflight tracker) and
-- the lcc-listing-event-sync-fire / -finalize crons are intentionally KEPT —
-- they feed the live buyer-SPE classification views above. Do not drop them.
