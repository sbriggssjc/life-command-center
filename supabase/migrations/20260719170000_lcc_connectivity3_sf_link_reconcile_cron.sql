-- ============================================================================
-- CONNECTIVITY #3 — schedule the Salesforce link-store reconcile (LCC Opps)
-- 2026-06-18
--
-- Mirrors the ~768 domain owner→Salesforce ACCOUNT links (dia
-- true_owners.salesforce_id / gov sf_account_id) onto the bridged LCC owner
-- entity via ensureEntityLink, so bridged owners become routable BD targets.
-- Conflicts (the entity already has a different SF link) and collisions (one SF
-- account on two entities) are surfaced to the Decision Center
-- (sf_link_conflict / sf_link_collision) — never auto-overwritten, never
-- blind-merged. See api/_handlers/sf-link-reconcile.js.
--
-- Cadence: DAILY 06:40 UTC — GENTLE (the artifact-offload lesson). Each tick is
-- capped (limit=100 attaches) AND wall-clock-budgeted (~22s). The attach is
-- fill-blanks-only (skips an entity that already has an SF Account link),
-- collision-guarded (never double-links a shared id), and reversible via
-- external_identities.metadata.batch_tag — so the cron is safe to run
-- unattended for steady state.
--
-- ROLLOUT — DO NOT APPLY THIS MIGRATION UNTIL AFTER THE FIRST GATED DRAIN.
-- This cron AUTO-DRAINS (attaches up to 100/tick), so it must not fire before
-- the human-gated capped pass: post-deploy run GET dry-run → POST ?limit=25 →
-- gate-check (attaches went through ensureEntityLink, only Account ids, 0
-- Contact-id leakage, collisions → merge lane not double-linked) → drain. Only
-- THEN apply this migration to enable steady-state maintenance (it picks up new
-- domain SF ids going forward). The endpoint 404s on Railway until
-- api/operations.js ships — same go-live posture as lcc-contact-acquisition /
-- lcc-folder-feed.
--
-- Idempotent (unschedule-then-schedule). Apply on LCC Opps (xengecqvemvfknjvbvrq).
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('lcc-sf-link-reconcile');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- lcc_cron_post POSTs <base>/api/sf-link-reconcile-tick with
    -- Authorization: Bearer <vault.lcc_api_key>. POST = drain. limit bounds the
    -- per-tick attaches; the budget caps wall-clock regardless. Both domains.
    PERFORM cron.schedule(
      'lcc-sf-link-reconcile',
      '40 6 * * *',
      $cmd$SELECT public.lcc_cron_post('/api/sf-link-reconcile-tick?domain=both&limit=100', '{}'::jsonb, 'vercel')$cmd$
    );
  END IF;
END $$;
