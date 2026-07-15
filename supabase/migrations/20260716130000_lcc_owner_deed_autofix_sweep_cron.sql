-- ============================================================================
-- Owner-deed auto-reconcile sweep — schedule the R51 deed-wins auto-fix (LCC Opps)
-- 2026-07-15
--
-- The classic "we already have the sale/deed, why is this still a manual banner?"
-- case: a property whose recorded deed grantee (authoritative legal title) is
-- NEWER and different from the stale recorded_owner (v_owner_source_conflict
-- auto_fixable = broker_as_owner | stale_seller | dated deed_newer_stale, grantee
-- passes the owner guards, NOT spe_vs_parent). The per-row Decision-Center /
-- property-detail verdict already applies these one at a time; this cron drains
-- the auto_fixable set on a schedule so they self-heal without a click.
--
-- Each swept property is FULLY reconciled (not just its recorded_owner):
--   1. propagateDeedGranteeToOwner → set recorded_owner = deed grantee (through
--      the field-priority gate: recorded_deed(3) beats the aggregators, never
--      clobbers a manual edit(1); guards reject brokerages / junk).
--   2. reconcileSaleAndOwnershipForNewOwner → attribute the property's matching
--      sale (the one whose BUYER IS this owner) + append the ownership_history
--      transfer. Append-only / fill-blanks / reversible (data_source /
--      ownership_source = 'owner_deed_reconcile').
-- See api/admin.js handleOwnerDeedAutofix + api/_handlers/sidebar-pipeline.js.
--
-- ⚠️ GATED BY THE ENV FLAG, NOT BY THIS MIGRATION. The apply path returns 403
-- until DECISION_OWNER_DEED_WINS=on in the Railway env, so this cron is INERT
-- (a harmless 403 each tick) until Scott flips the flag — applying the migration
-- is therefore safe at any time; the flag is the real switch. Rollout: run the
-- GET dry-run (?_route=owner-deed-autofix — lists the auto_fixable rows, no
-- writes), review the rows, THEN set the flag. Live dry-run 2026-07-15 = 20
-- properties (gov 5 + dia 15), value-ranked. NEW captures self-reconcile at
-- capture time now (sidebar Step 5b4), so this cron is the backstop for the
-- standing set + late-arriving deeds.
--
-- Cadence: DAILY 06:50 UTC — GENTLE (the artifact-offload connection-budget
-- lesson), after the SF-link reconcile (06:40) and the mirror reconcile (05:15).
-- limit=100 (the current set is ~20, so one tick clears it; the cap bounds a
-- future surge). The endpoint 404s on Railway until api/admin.js ships — same
-- go-live posture as the other lcc_cron_post endpoints.
--
-- Idempotent (unschedule-then-schedule). Apply on LCC Opps (xengecqvemvfknjvbvrq).
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('lcc-owner-deed-autofix');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- POST = apply (gated on DECISION_OWNER_DEED_WINS=on; 403 no-op otherwise).
    -- domain=both, value-ranked; limit bounds the per-tick reconcile count.
    PERFORM cron.schedule(
      'lcc-owner-deed-autofix',
      '50 6 * * *',
      $cmd$SELECT public.lcc_cron_post('/api/admin?_route=owner-deed-autofix&domain=both&limit=100', '{}'::jsonb, 'vercel')$cmd$
    );
  END IF;
END $$;
