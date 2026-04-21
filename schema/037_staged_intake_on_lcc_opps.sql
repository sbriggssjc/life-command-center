-- ============================================================================
-- 037: Staged intake tables on LCC Opps (canonical home)
-- Life Command Center — OM intake pipeline unification
--
-- Background:
--   - intake-extractor.js uses opsQuery (LCC Opps) to read staged_intake_*.
--   - Legacy email intake path (api/intake.js) writes via
--     domainQuery('dialysis', ...) to the dialysis DB.
--   - The new Copilot intake path needs a single canonical home that the
--     extractor + matcher already read from.
--
-- This migration is IDEMPOTENT. If the tables were already created manually
-- on LCC Opps, this is a no-op. If not, it creates them with the exact shape
-- the extractor and finalize handlers expect.
-- ============================================================================

-- ============================================================================
-- STAGED INTAKE ITEMS
-- Single row per inbound document batch (one email, one Copilot upload, etc.)
-- intake_id == inbox_items.id (1:1, reused for correlation)
-- ============================================================================

create table if not exists staged_intake_items (
  intake_id            uuid primary key,
  workspace_id         uuid references workspaces(id) on delete cascade,
  source_type          text not null,                  -- 'email' | 'copilot' | 'manual'
  internet_message_id  text,
  status               text not null default 'queued'
                         check (status in ('queued','processing','review_required','failed','finalized','discarded')),
  raw_payload          jsonb default '{}',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists idx_staged_intake_status
  on staged_intake_items(status) where status in ('queued','processing');

create index if not exists idx_staged_intake_workspace
  on staged_intake_items(workspace_id);

create index if not exists idx_staged_intake_msgid
  on staged_intake_items(internet_message_id) where internet_message_id is not null;

-- ============================================================================
-- STAGED INTAKE ARTIFACTS
-- One row per attachment or inline document tied to an intake.
-- inline_data: base64 string (preferred for documents ≤25MB).
-- storage_path: Supabase Storage path (for larger files, future use).
-- ============================================================================

create table if not exists staged_intake_artifacts (
  id            uuid primary key default gen_random_uuid(),
  intake_id     uuid not null references staged_intake_items(intake_id) on delete cascade,
  file_name     text not null,
  file_type     text,
  mime_type     text,
  inline_data   text,                      -- base64 payload
  storage_path  text,                      -- Supabase Storage object path
  size_bytes    bigint,
  sha256        text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_staged_intake_artifacts_intake
  on staged_intake_artifacts(intake_id);

-- Keep at least one of inline_data or storage_path populated
-- (permit both nullable during email path URL-fetch, but artifact rows
--  without content are filtered out by the extractor)
-- NO CHECK constraint — the extractor skips empty rows explicitly.

-- ============================================================================
-- STAGED INTAKE EXTRACTIONS
-- Immutable result of AI extraction — one row per successful extract.
-- extraction_snapshot holds the merged OM/rent-roll/lease-abstract result.
-- ============================================================================

create table if not exists staged_intake_extractions (
  id                    uuid primary key default gen_random_uuid(),
  intake_id             uuid not null references staged_intake_items(intake_id) on delete cascade,
  extraction_snapshot   jsonb not null,
  document_type         text,                  -- 'om' | 'lease_abstract' | 'rent_roll' | 'unknown'
  extraction_version    text default 'v1',
  created_at            timestamptz not null default now()
);

create index if not exists idx_staged_intake_extractions_intake
  on staged_intake_extractions(intake_id, created_at desc);

-- ============================================================================
-- RLS
-- Workspace-scoped via staged_intake_items.workspace_id. Artifacts +
-- extractions inherit scope through their intake_id FK.
-- ============================================================================

alter table staged_intake_items       enable row level security;
alter table staged_intake_artifacts   enable row level security;
alter table staged_intake_extractions enable row level security;

-- Policies: only allow reads/writes by the workspace's members.
-- The write path uses the service-role key via opsQuery, which bypasses RLS.
-- These policies gate interactive Supabase Studio / user-token access.

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'staged_intake_items'
      and policyname = 'staged_intake_items_member_select'
  ) then
    create policy staged_intake_items_member_select on staged_intake_items
      for select using (
        workspace_id in (
          select workspace_id from workspace_memberships where user_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies where tablename = 'staged_intake_artifacts'
      and policyname = 'staged_intake_artifacts_member_select'
  ) then
    create policy staged_intake_artifacts_member_select on staged_intake_artifacts
      for select using (
        intake_id in (
          select intake_id from staged_intake_items
           where workspace_id in (
             select workspace_id from workspace_memberships where user_id = auth.uid()
           )
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies where tablename = 'staged_intake_extractions'
      and policyname = 'staged_intake_extractions_member_select'
  ) then
    create policy staged_intake_extractions_member_select on staged_intake_extractions
      for select using (
        intake_id in (
          select intake_id from staged_intake_items
           where workspace_id in (
             select workspace_id from workspace_memberships where user_id = auth.uid()
           )
        )
      );
  end if;
end $$;
