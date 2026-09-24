-- CONSOLIDATE-REVERSIBLE (2026-09-24) — dia half.
--
-- The property Consolidate button and the Decision Center property_merge verdict
-- now merge through dia_merge_property_reversible (never the bare
-- dia_merge_property, which hard-deletes with no snapshot). That wrapper writes
-- dia_property_merge_backup, NOT property_merge_log — and nothing has written
-- property_merge_log since 2026-05-17 (656 rows, all reconciled). So the LCC
-- merge-log reconcile (/api/admin?_route=merge-log-reconcile, cron every 15 min)
-- could not see any merge made since then: 593 backup rows (2026-08-14 →
-- 2026-09-22) never had their LCC asset-entity backrefs repointed.
--
-- The reconcile now reads dia_property_merge_backup too (skipping unmerged rows)
-- and stamps it the same way it stamps property_merge_log. These are the stamp
-- columns. Additive only; apply BEFORE the Railway redeploy (the new JS lists by
-- reconciled_lcc_at and would 400 without it — it degrades to an error entry
-- for this source, the property_merge_log arm is unaffected).
--
-- Revert: alter table public.dia_property_merge_backup
--           drop column reconciled_lcc_at, drop column reconciled_lcc_count;

alter table public.dia_property_merge_backup
  add column if not exists reconciled_lcc_at    timestamptz,
  add column if not exists reconciled_lcc_count integer;

create index if not exists idx_dia_property_merge_backup_unreconciled
  on public.dia_property_merge_backup (merged_at)
  where reconciled_lcc_at is null and unmerged_at is null;

comment on column public.dia_property_merge_backup.reconciled_lcc_at is
  'CONSOLIDATE-REVERSIBLE: when the LCC merge-log reconcile repointed LCC asset entities from dropped_property_id to kept_property_id.';
comment on column public.dia_property_merge_backup.reconciled_lcc_count is
  'CONSOLIDATE-REVERSIBLE: LCC entities repointed for this merge (0 = none pointed at the dropped id).';

notify pgrst, 'reload schema';
