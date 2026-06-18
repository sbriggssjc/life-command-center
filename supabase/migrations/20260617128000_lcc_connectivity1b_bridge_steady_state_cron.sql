-- ===========================================================================
-- CONNECTIVITY #1b — steady-state cron: keep new in-use owners bridged
-- Target DB: LCC Opps (xengecqvemvfknjvbvrq)
-- Date: 2026-06-17
--
-- After the gated conservative + broad drains, the owner-bridge is materially
-- complete (dia true_owner 679 -> 3,570; gov 3,404 -> 6,935). This cron keeps it
-- current: every 4h it re-fires the eligibility views (broad, p_current_only=
-- false) and finalizes — already-bridged owners ON CONFLICT DO NOTHING, so the
-- steady-state cost is the fetch + a trickle of new mints. Mirrors the proven
-- lcc_sync/finalize_classified_owners cron pair (offset to :50/:55, away from the
-- other BD syncs at :05-:45). The classified cron still runs in parallel and
-- ENRICHES any of these from owner_role='unknown' to a real archetype on top.
--
-- GENTLE cadence (4h, 6 pages x 2 domains = 12 pg_net GETs/tick — the artifact-
-- offload / 60-connection lesson). The narrow artifact guard
-- (lcc_owner_name_is_junk) + the eligibility views filter contamination at the
-- source, so the cron can never re-mint a flagged artifact. Idempotent
-- (unschedule-then-schedule).
-- ===========================================================================

DO $$ BEGIN PERFORM cron.unschedule('lcc-bridge-eligible-fire');     EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('lcc-bridge-eligible-finalize'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule('lcc-bridge-eligible-fire', '50 */4 * * *',
  $$SELECT public.lcc_sync_bridge_eligible_owners('both', false, 6, 1000);$$);

SELECT cron.schedule('lcc-bridge-eligible-finalize', '55 */4 * * *',
  $$SELECT public.lcc_finalize_bridge_eligible_owners();$$);
