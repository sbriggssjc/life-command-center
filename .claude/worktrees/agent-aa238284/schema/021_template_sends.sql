-- ============================================================================
-- 021: Template Sends Tracking Table
-- Life Command Center
-- ============================================================================

create table if not exists template_sends (
  id                  uuid primary key default gen_random_uuid(),
  template_id         text not null,
  template_version    integer not null default 1,
  sent_at             timestamptz default now(),
  sent_by             uuid references auth.users(id),
  contact_id          uuid,
  entity_id           uuid,
  entity_type         text,
  packet_snapshot_id  uuid references context_packets(id),
  subject_line_used   text,
  edit_distance_pct   float,
  opened              boolean,
  opened_at           timestamptz,
  replied             boolean,
  replied_at          timestamptz,
  deal_advanced       boolean,
  deal_advanced_at    timestamptz,
  outcome_note        text
);

create index if not exists idx_template_sends_template on template_sends(template_id, template_version);
create index if not exists idx_template_sends_contact on template_sends(contact_id, sent_at desc);
create index if not exists idx_template_sends_user on template_sends(sent_by, sent_at desc);
create index if not exists idx_template_sends_pending_reply on template_sends(replied) where replied is null;

alter table template_sends enable row level security;
