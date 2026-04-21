-- ============================================================================
-- 039: Supabase Storage bucket for large OM uploads
-- Life Command Center — Direct-to-storage OM ingestion (bypasses Vercel 4.5MB cap)
--
-- >>> PREFERRED SETUP PATH: use the Supabase Studio → Storage UI <<<
--
-- Running this migration from the SQL Editor fails with
--   ERROR 42501: must be owner of table objects
-- because storage.objects is owned by supabase_storage_admin, not the SQL
-- Editor's user. RLS on storage.objects can only be altered by that owner.
--
-- This file is kept for documentation — what needs to exist, and how the
-- bucket should be configured. Do the actual creation via the UI:
--
--   Supabase Studio → Storage → New bucket
--     - Name: lcc-om-uploads
--     - Public: OFF
--     - File size limit: 100 MB
--     - Allowed MIME types: (blank, or the list below)
--
-- The prepare-upload handler uses the service-role key which bypasses RLS,
-- so policies are optional. Add them later via the Storage UI's Policies tab
-- if you need authenticated-member read access from browser clients.
-- ============================================================================

-- ── Best-effort bucket upsert ─────────────────────────────────────────────
-- This part DOES work in the SQL Editor for most Supabase projects because
-- storage.buckets is user-writable. If it also errors, fall back to the UI.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'lcc-om-uploads',
  'lcc-om-uploads',
  false,
  104857600,                               -- 100 MB per object
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update set
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ── Policies intentionally omitted ────────────────────────────────────────
-- Previously this migration tried to ALTER TABLE storage.objects ENABLE
-- ROW LEVEL SECURITY and CREATE POLICY statements on storage.objects.
-- Both require ownership of storage.objects which is held by
-- supabase_storage_admin (not the SQL Editor user). Those are now dropped
-- in favor of the Storage UI path.
--
-- If you need workspace-member read access later:
--   Supabase Studio → Storage → lcc-om-uploads → Policies → New policy
--     (template: "Give authenticated users access to only their own folder")
