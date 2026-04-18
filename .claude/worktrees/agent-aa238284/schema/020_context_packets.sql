-- ============================================================================
-- 020: Context Packets Cache Table
-- Life Command Center
-- ============================================================================

create table if not exists context_packets (
  id              uuid primary key default gen_random_uuid(),
  packet_type     text not null,
  entity_id       uuid,
  entity_type     text,
  requesting_user uuid references auth.users(id),
  surface_hint    text,
  payload         jsonb not null,
  token_count     integer,
  assembled_at    timestamptz default now(),
  expires_at      timestamptz not null,
  invalidated     boolean default false,
  invalidation_reason text,
  assembly_duration_ms integer,
  model_version   text
);

create index if not exists idx_packets_entity on context_packets(entity_id, packet_type);
create index if not exists idx_packets_expiry on context_packets(expires_at) where not invalidated;
create index if not exists idx_packets_type_entity on context_packets(packet_type, entity_id, assembled_at desc);

alter table context_packets enable row level security;
