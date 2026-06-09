-- ============================================================================
-- Phase 1 — storage adapter columns on staged_intake_artifacts (LCC Opps)
-- 2026-06-09 (intelligence-hub architecture, Phase 1)
--
-- Adds the two reference columns the pluggable storage adapter
-- (api/_shared/storage-adapter.js) records per artifact:
--   storage_backend : 'supabase' | 'sharepoint_pa'  (NULL = legacy supabase
--                     row identified by storage_path)
--   storage_ref     : backend-specific reference —
--                     supabase   -> "<bucket>/<object>" (mirrors storage_path)
--                     sharepoint -> server-relative URL in the Team Briggs lib
--
-- storage_path is KEPT for back-compat: existing readers + the offload worker
-- continue to use it for the supabase backend. SharePoint rows leave it NULL
-- and carry storage_ref instead.
--
-- SAFE BY CONSTRUCTION: additive, nullable, no default (metadata-only ADD
-- COLUMN — no table rewrite, no long lock), no constraint. Existing rows read
-- exactly as before (NULL backend => treated as supabase via storage_path).
-- Deploy-order-agnostic: old code ignores the columns; new code tolerates NULL.
-- Idempotent (IF NOT EXISTS).
-- ============================================================================

ALTER TABLE public.staged_intake_artifacts
  ADD COLUMN IF NOT EXISTS storage_backend text,
  ADD COLUMN IF NOT EXISTS storage_ref     text;

COMMENT ON COLUMN public.staged_intake_artifacts.storage_backend IS
  'Storage backend that holds the bytes: supabase | sharepoint_pa. NULL = legacy supabase row (use storage_path).';
COMMENT ON COLUMN public.staged_intake_artifacts.storage_ref IS
  'Backend-specific reference. supabase: "<bucket>/<object>" (= storage_path). sharepoint_pa: server-relative URL in the Team Briggs Documents library.';
