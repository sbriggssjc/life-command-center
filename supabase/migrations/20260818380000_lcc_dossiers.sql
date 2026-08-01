-- Property / Deal Dossiers (Scott) — a generated, saved brief per entity that
-- replaces the ad-hoc ChatGPT/Claude brief links. v1: the data-only property
-- dossier is generated client-side and opened in a new tab; this table is the
-- persistence seam for when we store/version dossiers and add LLM prose. Deal
-- dossiers reuse the same table (dossier_type='deal'). Applied live to LCC Opps.
create table if not exists lcc_dossiers (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid,
  entity_id     uuid not null,
  dossier_type  text not null default 'property'  check (dossier_type in ('property','deal')),
  storage_ref   text,                 -- "<bucket>/<object>" or SharePoint server-relative
  format        text not null default 'html',
  version       int  not null default 1,
  source_hash   text,                 -- hash of the input data → staleness detection
  title         text,
  generated_at  timestamptz not null default now(),
  generated_by  uuid,
  metadata      jsonb not null default '{}'::jsonb
);

create index if not exists lcc_dossiers_entity_idx on lcc_dossiers (entity_id, dossier_type, generated_at desc);

-- Latest dossier per (entity, type) — what the panel reads to decide View vs Generate.
create or replace view v_lcc_dossier_current as
  select distinct on (entity_id, dossier_type)
    id, workspace_id, entity_id, dossier_type, storage_ref, format, version,
    source_hash, title, generated_at, generated_by, metadata
  from lcc_dossiers
  order by entity_id, dossier_type, generated_at desc;
