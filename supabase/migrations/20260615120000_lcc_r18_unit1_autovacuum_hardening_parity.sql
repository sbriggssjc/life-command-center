-- ============================================================================
-- R18 Unit 1 — autovacuum hardening parity (LCC Opps)
--
-- Durable DB-growth prevention follow-up (2026-06-15 audit). The two
-- bloat-incident tables (sf_sync_log, staged_intake_artifacts) are now
-- source-fixed (payloads externalized to Storage/SharePoint), and every big
-- table carries a retention prune. The remaining reclaim-for-reuse lever is
-- autovacuum hardening so prune-freed space is reused and churn-driven file
-- growth is capped instead of bloating the heap/TOAST.
--
-- These ALTER TABLE settings were applied LIVE to LCC Opps on 2026-06-15 but
-- were not yet captured as a repo migration. This migration re-applies them
-- (idempotent ALTER ... SET) so a rebuild / replay keeps the tuning. Values
-- match the live-applied reloptions exactly.
--
--   field_provenance        : vacuum 0.05 / analyze 0.05 / vacuum_threshold 10000
--   perf_metrics            : vacuum 0.05 / analyze 0.05 / vacuum_threshold  5000
--   signals                 : vacuum 0.05 / analyze 0.05 / vacuum_threshold  5000
--   staged_intake_artifacts : vacuum 0.05 / analyze 0.05 / vacuum_threshold   500
--
-- (context_packets + sf_sync_log already carry their hardening from prior
-- migrations — see 20260529120000_lcc_sf_sync_log_retention_and_disk_health.sql.)
--
-- Additive / no locks of concern (ALTER TABLE SET (autovacuum...) takes only a
-- brief SHARE UPDATE EXCLUSIVE lock on the catalog row). Apply anytime; no
-- Railway dependency. The to_regclass guards make a partial rebuild (a table
-- not yet created) a no-op instead of an error.
--
-- Apply on LCC Opps (xengecqvemvfknjvbvrq).
-- ============================================================================

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('public.field_provenance',
        'autovacuum_vacuum_scale_factor=0.05, autovacuum_analyze_scale_factor=0.05, autovacuum_vacuum_threshold=10000'),
      ('public.perf_metrics',
        'autovacuum_vacuum_scale_factor=0.05, autovacuum_analyze_scale_factor=0.05, autovacuum_vacuum_threshold=5000'),
      ('public.signals',
        'autovacuum_vacuum_scale_factor=0.05, autovacuum_analyze_scale_factor=0.05, autovacuum_vacuum_threshold=5000'),
      ('public.staged_intake_artifacts',
        'autovacuum_vacuum_scale_factor=0.05, autovacuum_analyze_scale_factor=0.05, autovacuum_vacuum_threshold=500')
    ) as t(relname, opts)
  loop
    if to_regclass(r.relname) is not null then
      execute format('alter table %s set (%s)', r.relname, r.opts);
      raise notice '[r18-unit1] autovacuum hardened: % (%)', r.relname, r.opts;
    else
      raise notice '[r18-unit1] skip (table absent): %', r.relname;
    end if;
  end loop;
end $$;
