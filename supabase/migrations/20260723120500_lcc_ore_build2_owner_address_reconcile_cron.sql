-- ============================================================================
-- ORE Build 2 — the owner-address review sweep cron.
-- LCC Opps. Additive · reversible (unschedule → zero trace).
-- ----------------------------------------------------------------------------
-- Unlike the multi-signal engine's DRAIN cron (which CONSOLIDATES entities via
-- lcc_merge_entity and is deliberately left UNscheduled behind a capped gated
-- dry-run), this sweep RECORDS ONLY — it runs lcc_reconcile_owner over owners
-- whose shared-address fingerprint changed and writes the verdicts to the
-- evidence trace, never merging. That makes it SAFE to schedule now (same posture
-- as the pure-DB evidence-cache-refresh / reconcile-seed crons). A bare shared-
-- address match is surfaced to the review lane; an above-threshold same_party is
-- recorded auto_merge_eligible for the gated drain / operator — never merged here.
--
-- Cadence: gentle daily, offset AFTER the hourly evidence-cache refresh (:34) so
-- the resolver reads a fresh candidate universe, and after the reconcile seed
-- (06:20). Apply AFTER 20260723120000 (which creates the function).
-- ============================================================================

SELECT cron.unschedule('lcc-owner-address-reconcile-sweep')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-owner-address-reconcile-sweep');

SELECT cron.schedule('lcc-owner-address-reconcile-sweep', '40 6 * * *',
  $$SELECT public.lcc_owner_address_reconcile_sweep(200);$$);
