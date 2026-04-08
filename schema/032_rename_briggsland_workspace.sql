-- ============================================================================
-- 032: Rename "Briggsland Capital" workspace to "Briggs CRE"
--
-- The Pipeline page header displays the workspace name from the OPS Supabase
-- workspaces table. "Briggsland Capital" is a stale/incorrect name.
-- ============================================================================

update workspaces
  set name = 'Briggs CRE',
      updated_at = now()
  where name ilike '%briggsland%';
