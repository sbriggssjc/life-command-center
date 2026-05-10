-- ============================================================================
-- Phase 2 — SharePoint bridge schema corrections
-- ----------------------------------------------------------------------------
-- The Phase 0 scaffold of `sharepoint_documents` assumed a
-- /Properties/<Letter>/<City, State>/ tree (letter buckets). The actual
-- TeamBriggs20 layout is /Properties/<TenantName>/<City, State>/, so
-- swap `tenant_letter char(1)` for `tenant_name text` and update the
-- supporting index.
--
-- The table is empty at the time this migration runs (Phase 0 + 1 only
-- created scaffolding; no SharePoint rows have been inserted), so the
-- column drop is non-destructive.
-- ============================================================================

drop index if exists ix_sharepoint_documents_path;

alter table sharepoint_documents drop column if exists tenant_letter;
alter table sharepoint_documents add column if not exists tenant_name text;

create index if not exists ix_sharepoint_documents_path
  on sharepoint_documents (workspace_id, tenant_name, city, state);

-- Confidence column for property-entity linkage attempted by the worker.
-- Stored alongside metadata so the UI can surface "low-confidence match —
-- click to confirm" affordances without parsing JSONB.
alter table sharepoint_documents
  add column if not exists match_confidence numeric;
create index if not exists ix_sharepoint_documents_low_confidence
  on sharepoint_documents (workspace_id, match_confidence)
  where match_confidence is not null and match_confidence < 0.7;
