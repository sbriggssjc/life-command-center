-- ============================================================================
-- 20260506_intake_share_inbox.sql
--
-- Staging table for the iOS Shortcut "Send to LCC" share-target endpoint
-- (POST /api/intake-share). Captures LinkedIn / Instagram / email / article
-- shares with their attached screenshots, then a Vision extractor populates
-- the `extraction` jsonb column with structured property / tenant / deal
-- fields. Promotion to canonical records in the gov-lease and dialysis
-- Supabase projects happens via /api/intake-promote (phase 2).
--
-- Apply against the OPS Supabase project (OPS_SUPABASE_URL).
-- ============================================================================

create table if not exists intake_share_inbox (
  id                 uuid        primary key default gen_random_uuid(),
  workspace_id       uuid        not null,
  source             text        not null,
  source_url         text,
  shared_text        text,
  notes              text,
  domain_hint        text
    check (domain_hint in ('gov_lease','dialysis','general') or domain_hint is null),
  image_count        int         not null default 0,
  raw_payload        jsonb       not null,
  images             jsonb,
  extraction         jsonb,
  extraction_status  text        not null default 'pending'
    check (extraction_status in ('pending','extracting','extracted','failed')),
  extraction_error   text,
  detected_domain    text
    check (detected_domain in ('gov_lease','dialysis','general') or detected_domain is null),
  confidence         numeric,
  status             text        not null default 'new'
    check (status in ('new','reviewed','promoted','rejected')),
  promoted_to        jsonb,
  promoted_at        timestamptz,
  source_user_id     uuid,
  visibility         text        not null default 'shared'
    check (visibility in ('shared','assigned','private')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists intake_share_inbox_status_idx
  on intake_share_inbox (workspace_id, status, created_at desc);

create index if not exists intake_share_inbox_domain_idx
  on intake_share_inbox (workspace_id, detected_domain, status);

create index if not exists intake_share_inbox_extraction_status_idx
  on intake_share_inbox (workspace_id, extraction_status);

comment on table intake_share_inbox is
  'iOS Shortcut "Send to LCC" share-target staging. Written by /api/intake-share.';
comment on column intake_share_inbox.raw_payload is
  'Full request body excluding image bytes (image meta only).';
comment on column intake_share_inbox.images is
  'Array of {sha256, mime_type, size_bytes}. Bytes are not persisted.';
comment on column intake_share_inbox.extraction is
  'Structured Vision output — see api/_shared/share-extractor.js for schema.';
