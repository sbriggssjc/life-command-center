-- ============================================================================
-- Phase 0 — Integration Bridges scaffolding
-- ----------------------------------------------------------------------------
-- Establishes the contract between external systems (Salesforce, SharePoint,
-- Outlook, Calendar, Teams) and LCC's canonical tables. Every external data
-- flow is registered as a row in `connector_bridges` with an explicit
-- field allowlist and write policy; every run is audited in `bridge_runs`;
-- every unit of downstream work goes through `enrichment_jobs`.
--
-- No live bridges are wired up in this migration. This is the scaffolding
-- + storage surfaces the Phase 1+ flows will plug into. The stub worker
-- (api/enrichment-worker.js) drains `enrichment_jobs` and just logs in
-- Phase 0 — real handlers are introduced bridge-by-bridge later.
--
-- Workspace scoping is enforced at the API layer (api/_shared/auth.js) for
-- consistency with the existing codebase; RLS is intentionally not enabled
-- here. The one privacy-sensitive surface (`email_bodies`) gets a stricter
-- read policy when Phase 3 wires Outlook ingest.
-- ============================================================================

-- ---- helpers ---------------------------------------------------------------

create or replace function bridges_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end$$;

-- ---- connector_bridges -----------------------------------------------------
-- Single source of truth for: what's flowing, from where, in what direction,
-- with what allowlist, under whose authority. /api/admin/bridges reads this.

create table if not exists connector_bridges (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,

  -- e.g. 'sf.accounts', 'sharepoint.properties', 'outlook.lcc-intake'
  bridge_key      text not null,
  source_system   text not null
    check (source_system in (
      'salesforce','sharepoint','onedrive','outlook',
      'calendar','teams','manual','other'
    )),
  direction       text not null
    check (direction in ('inbound','outbound','bidirectional')),

  -- Who owns the credentials feeding this bridge.
  -- 'service_account' = shared M365 service account (when IT approves).
  -- 'personal'        = a specific user's delegated connection.
  -- 'tenant_app'      = Azure AD application permission (not currently available).
  ownership       text not null default 'personal'
    check (ownership in ('service_account','personal','tenant_app')),
  owner_user_id   uuid references users(id) on delete set null,

  -- Explicit allowlist of fields this bridge may carry, keyed by entity name.
  -- Example for sf.accounts:
  --   {"Account": ["Id","Name","Type","Industry","BillingAddress","Website","ParentId"]}
  -- The /api/_shared/bridges.js helper strips any field not on the list before
  -- it touches downstream tables.
  allowlist       jsonb not null default '{}'::jsonb,

  -- Write-back policy. Defaults 'none' — adding a new write surface requires
  -- explicitly bumping this and supplying write_allowlist.
  write_policy    text not null default 'none'
    check (write_policy in ('none','minimal','full')),
  write_allowlist jsonb not null default '{}'::jsonb,

  -- Free-text descriptor (e.g. '*/5 * * * *', 'on_demand', 'webhook'). Parsed
  -- by the freshness page for display, not enforced here.
  schedule        text,

  -- Per-bridge incremental watermark (e.g. last LastModifiedDate seen).
  -- JSONB so each source can use whatever shape makes sense.
  watermark       jsonb not null default '{}'::jsonb,

  last_run_at     timestamptz,
  last_success_at timestamptz,
  last_error_at   timestamptz,
  last_error      text,
  consecutive_failures int not null default 0,

  status          text not null default 'active'
    check (status in ('active','paused','archived')),

  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (workspace_id, bridge_key)
);

create index if not exists ix_connector_bridges_workspace_status
  on connector_bridges (workspace_id, status);
create index if not exists ix_connector_bridges_last_run
  on connector_bridges (last_run_at desc);

drop trigger if exists trg_connector_bridges_updated_at on connector_bridges;
create trigger trg_connector_bridges_updated_at
  before update on connector_bridges
  for each row execute function bridges_set_updated_at();

-- ---- bridge_runs -----------------------------------------------------------
-- Audit row per bridge execution. The freshness page joins this against
-- connector_bridges. The bridges helper writes one row per ingest batch.

create table if not exists bridge_runs (
  id               bigserial primary key,
  bridge_id        uuid not null references connector_bridges(id) on delete cascade,
  workspace_id     uuid not null references workspaces(id) on delete cascade,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  status           text not null default 'running'
    check (status in ('running','success','partial','error','rejected')),

  rows_in          int not null default 0,
  rows_accepted    int not null default 0,
  rows_dropped     int not null default 0,
  -- { "field_not_in_allowlist": 7, "missing_required": 1, ... }
  drop_reasons     jsonb not null default '{}'::jsonb,

  watermark_from   jsonb,
  watermark_to     jsonb,

  -- Power Automate flow run id, edge function execution id, etc.
  external_run_id  text,

  error_message    text,
  metadata         jsonb not null default '{}'::jsonb
);

create index if not exists ix_bridge_runs_bridge_started
  on bridge_runs (bridge_id, started_at desc);
create index if not exists ix_bridge_runs_workspace_started
  on bridge_runs (workspace_id, started_at desc);

-- ---- enrichment_jobs -------------------------------------------------------
-- Queue. Anything that needs the worker to follow up lands here. Bridges
-- write; the stub worker picks the oldest pending job, marks it running,
-- and (in Phase 0) just logs the payload.

create table if not exists enrichment_jobs (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  bridge_id       uuid references connector_bridges(id) on delete set null,

  -- e.g. 'salesforce.account.upsert', 'sharepoint.document.classify',
  --      'outlook.message.extract', 'entity.resolve.identity'
  job_type        text not null,
  target_kind     text,         -- 'entity' | 'document' | 'activity' | etc.
  target_id       uuid,         -- LCC id when known
  external_id     text,         -- source-system id (SF Id, Graph item id, ...)
  payload         jsonb not null default '{}'::jsonb,

  status          text not null default 'pending'
    check (status in ('pending','running','done','error','dropped')),
  priority        int not null default 50,   -- 0=urgent, 50=normal, 90=backfill
  attempts        int not null default 0,
  max_attempts    int not null default 5,
  next_run_at     timestamptz not null default now(),

  started_at      timestamptz,
  finished_at     timestamptz,
  error_message   text,
  result          jsonb,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Pending-only partial index keeps the hot worker query cheap as the table
-- accumulates done/error rows.
create index if not exists ix_enrichment_jobs_pending
  on enrichment_jobs (next_run_at, priority)
  where status = 'pending';
create index if not exists ix_enrichment_jobs_workspace_status
  on enrichment_jobs (workspace_id, status, created_at desc);
create index if not exists ix_enrichment_jobs_target
  on enrichment_jobs (target_kind, target_id)
  where target_id is not null;

drop trigger if exists trg_enrichment_jobs_updated_at on enrichment_jobs;
create trigger trg_enrichment_jobs_updated_at
  before update on enrichment_jobs
  for each row execute function bridges_set_updated_at();

-- ---- sharepoint_documents (Phase 2 scaffold) -------------------------------
-- Metadata-only index of SharePoint/OneDrive items. Bodies are NEVER stored
-- here — only path, modification, classification, and the link back to LCC
-- entities. The worker fetches the file on demand for extraction.

create table if not exists sharepoint_documents (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references workspaces(id) on delete cascade,

  drive_id            text not null,
  item_id             text not null,                 -- Graph driveItem id
  parent_path         text,
  name                text not null,
  web_url             text,
  size_bytes          bigint,
  content_type        text,
  etag                text,

  -- Parsed from the path convention `/Properties/<Letter>/<City, State>/...`
  tenant_letter       char(1),
  city                text,
  state               char(2),

  -- Heuristic + LLM classification. Refined by the worker.
  doc_type            text
    check (doc_type is null or doc_type in (
      'om','lease','comp','ownership_research','financial','marketing','other'
    )),

  property_entity_id  uuid,    -- references entities; FK added once entity
  tenant_entity_id    uuid,    -- table is confirmed canonical in this schema

  last_modified_at    timestamptz,
  indexed_at          timestamptz not null default now(),
  extracted_at        timestamptz,
  extraction_status   text not null default 'pending'
    check (extraction_status in ('pending','queued','done','skipped','error')),

  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (workspace_id, drive_id, item_id)
);

create index if not exists ix_sharepoint_documents_property
  on sharepoint_documents (property_entity_id)
  where property_entity_id is not null;
create index if not exists ix_sharepoint_documents_extraction
  on sharepoint_documents (extraction_status, last_modified_at desc);
create index if not exists ix_sharepoint_documents_path
  on sharepoint_documents (workspace_id, tenant_letter, city, state);

drop trigger if exists trg_sharepoint_documents_updated_at on sharepoint_documents;
create trigger trg_sharepoint_documents_updated_at
  before update on sharepoint_documents
  for each row execute function bridges_set_updated_at();

-- ---- email_bodies (Phase 3 scaffold) ---------------------------------------
-- Sensitive payload, separated from the activity_events row that references
-- it. Activity timeline can render without ever joining this table. A
-- retention sweep job will be added in Phase 3.

create table if not exists email_bodies (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references workspaces(id) on delete cascade,
  internet_message_id text,
  conversation_id     text,
  body_preview        text,
  body_format         text check (body_format in ('text','html')),
  body_text           text,
  body_html           text,
  redacted            boolean not null default false,
  source_user_id      uuid references users(id) on delete set null,
  received_at         timestamptz,
  ingested_at         timestamptz not null default now()
);

create index if not exists ix_email_bodies_message_id
  on email_bodies (workspace_id, internet_message_id);
create index if not exists ix_email_bodies_conversation
  on email_bodies (workspace_id, conversation_id);

-- ---- meetings (Phase 3 scaffold) -------------------------------------------
-- Calendar events. Attendees as JSONB for now — split out if per-attendee
-- row-level security becomes necessary.

create table if not exists meetings (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references workspaces(id) on delete cascade,
  external_id         text,           -- Graph event id
  ical_uid            text,
  organizer_email     text,
  source_user_id      uuid references users(id) on delete set null,

  subject             text,
  starts_at           timestamptz,
  ends_at             timestamptz,
  is_online_meeting   boolean default false,
  location            text,
  attendees           jsonb not null default '[]'::jsonb,

  -- Filled in by the enrichment worker once linkage is computed.
  entity_links        jsonb not null default '[]'::jsonb,

  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (workspace_id, external_id)
);

create index if not exists ix_meetings_workspace_starts
  on meetings (workspace_id, starts_at desc);

drop trigger if exists trg_meetings_updated_at on meetings;
create trigger trg_meetings_updated_at
  before update on meetings
  for each row execute function bridges_set_updated_at();

-- ---- bridge freshness view -------------------------------------------------
-- Powers /api/admin/bridges. Joins each bridge to its most recent run.

create or replace view v_bridge_freshness as
  select
    b.id,
    b.workspace_id,
    b.bridge_key,
    b.source_system,
    b.direction,
    b.ownership,
    b.status,
    b.schedule,
    b.last_run_at,
    b.last_success_at,
    b.last_error_at,
    b.last_error,
    b.consecutive_failures,
    extract(epoch from (now() - b.last_run_at))::int    as seconds_since_last_run,
    extract(epoch from (now() - b.last_success_at))::int as seconds_since_last_success,
    (
      select jsonb_build_object(
        'started_at',    r.started_at,
        'finished_at',   r.finished_at,
        'status',        r.status,
        'rows_in',       r.rows_in,
        'rows_accepted', r.rows_accepted,
        'rows_dropped',  r.rows_dropped,
        'drop_reasons',  r.drop_reasons
      )
      from bridge_runs r
      where r.bridge_id = b.id
      order by r.started_at desc
      limit 1
    ) as last_run
  from connector_bridges b;

-- ============================================================================
-- End Phase 0. The competitive_touches view (over activity_events) and any
-- live bridge rows are intentionally deferred to Phase 1.
-- ============================================================================
