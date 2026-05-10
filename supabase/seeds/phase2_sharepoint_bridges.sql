-- ============================================================================
-- Phase 2 — Seed connector_bridges rows for the SharePoint bridges
-- ----------------------------------------------------------------------------
-- Run per workspace, same pattern as the Phase 1 seed:
--
--   psql "$OPS_SUPABASE_DB_URL" \
--     -v workspace_id="'<workspace-uuid>'" \
--     -f supabase/seeds/phase2_sharepoint_bridges.sql
--
-- Two bridges:
--   sharepoint.properties.index    — active. Walks Shared Documents
--     library (TeamBriggs20 site) on a 30-min cadence, indexes metadata
--     into `sharepoint_documents`. Whole library is walked; only paths
--     under /Properties/<TenantName>/<City, State>/ get the rich
--     tenant_name/city/state parsing.
--
--   sharepoint.properties.extract  — paused (Phase 2.5). On-demand fetch
--     of file body for OM/lease extraction into the existing intake
--     pipeline.
-- ============================================================================

\set ws :workspace_id

-- ---- sharepoint.properties.index -------------------------------------------
insert into connector_bridges (
  workspace_id, bridge_key, source_system, direction, ownership,
  schedule, status, allowlist, write_policy, write_allowlist, notes
) values (
  :ws, 'sharepoint.properties.index', 'sharepoint', 'inbound', 'service_account',
  '*/30 * * * *', 'active',
  -- Allowlist of Graph driveItem fields we accept from the PA flow.
  -- Anything else is stripped at ingest. parentReference is a nested
  -- object — the entire object is allowed as a unit and parsed later
  -- by the handler.
  jsonb_build_object('DriveItem', jsonb_build_array(
    'id','name','webUrl','size','eTag',
    'createdDateTime','lastModifiedDateTime',
    'file','folder','parentReference','lastModifiedBy'
  )),
  'none', '{}'::jsonb,
  'Indexes the entire Shared Documents library on the TeamBriggs20 site. ' ||
  'Uses Graph delta queries for incremental sync; watermark stores the deltaLink. ' ||
  '/Properties/<Tenant>/<City, State>/ paths get full path-parsing; other folders ' ||
  '(templates, comps, market reports) are indexed with doc_type=other for later classification.'
) on conflict (workspace_id, bridge_key) do update set
  allowlist = excluded.allowlist,
  schedule  = excluded.schedule,
  notes     = excluded.notes,
  updated_at = now();

-- ---- sharepoint.properties.extract (paused, Phase 2.5) ---------------------
insert into connector_bridges (
  workspace_id, bridge_key, source_system, direction, ownership,
  schedule, status, allowlist, write_policy, write_allowlist, notes
) values (
  :ws, 'sharepoint.properties.extract', 'sharepoint', 'inbound', 'service_account',
  'on_demand', 'paused',
  jsonb_build_object('DriveItem', jsonb_build_array(
    'id','name','webUrl','file','parentReference'
  )),
  'none', '{}'::jsonb,
  'On-demand body fetch + OM/lease extraction into the intake pipeline. ' ||
  'Triggered when a user clicks "extract latest OM" on the property sidebar. ' ||
  'Paused on seed — Phase 2.5 wires the extractor and the on-demand trigger.'
) on conflict (workspace_id, bridge_key) do update set
  allowlist = excluded.allowlist,
  notes     = excluded.notes,
  updated_at = now();
