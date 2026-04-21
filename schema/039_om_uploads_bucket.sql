-- ============================================================================
-- 039: Supabase Storage bucket for large OM uploads
-- Life Command Center — Direct-to-storage OM ingestion (bypasses Vercel 4.5MB cap)
--
-- Run ONCE in Supabase Studio → SQL Editor on LCC Opps project. Creates the
-- bucket that /api/intake/prepare-upload mints signed upload URLs against.
-- After this migration:
--   1. Create an RLS policy (handled below)
--   2. Power Automate / Chrome extension can call prepare-upload → PUT bytes
--      directly to Supabase Storage → then call stage-om with storage_path
-- ============================================================================

-- ── Create the bucket if it doesn't exist ──────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'lcc-om-uploads',
  'lcc-om-uploads',
  false,                                   -- NOT public; access via RLS only
  104857600,                               -- 100 MB per-object cap
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ── RLS policies ─────────────────────────────────────────────────────────
-- Service-role can write (used by prepare-upload handler when minting signed
-- URLs; the signed URL itself carries its own auth so the PUT from Power
-- Automate / Chrome extension doesn't need service-role).
--
-- Authenticated workspace members can read (for viewing/downloading staged
-- OMs from the LCC UI).

alter table storage.objects enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where tablename = 'objects'
       and policyname = 'lcc_om_uploads_service_write'
  ) then
    create policy lcc_om_uploads_service_write on storage.objects
      for all
      using (bucket_id = 'lcc-om-uploads' and auth.role() = 'service_role')
      with check (bucket_id = 'lcc-om-uploads' and auth.role() = 'service_role');
  end if;

  if not exists (
    select 1 from pg_policies
     where tablename = 'objects'
       and policyname = 'lcc_om_uploads_member_read'
  ) then
    create policy lcc_om_uploads_member_read on storage.objects
      for select
      using (
        bucket_id = 'lcc-om-uploads'
        and auth.uid() in (
          select user_id from public.workspace_memberships
        )
      );
  end if;
end $$;
