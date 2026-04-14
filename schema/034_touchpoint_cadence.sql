-- ============================================================================
-- 034: Touchpoint Cadence Tracker
-- Life Command Center
-- ============================================================================
-- Tracks each contact's position in the 7-touch prospecting sequence
-- plus quarterly maintenance cadence. One row per contact-property pair.
-- The cadence engine reads this to recommend next actions and auto-select
-- templates. Updated by record_send and manual touchpoint logging.
-- ============================================================================

-- ── MAIN TRACKER TABLE ─────────────────────────────────────────────────────

create table if not exists touchpoint_cadence (
  id                    uuid primary key default gen_random_uuid(),
  created_at            timestamptz default now(),
  updated_at            timestamptz default now(),

  -- Contact identification (at least one must be set)
  entity_id             uuid,                -- LCC entity hub ID
  contact_id            uuid,                -- legacy contact_id (dia/gov DB)
  sf_contact_id         text,                -- Salesforce contact ID

  -- Property anchor (the specific asset this cadence targets)
  property_id           uuid,
  property_address      text,                -- denormalized for display
  domain                text,                -- government | dialysis

  -- ── Cadence State ────────────────────────────────────────────────────────

  -- Priority tier: A (hot), B (standard), C (low priority / research)
  priority_tier         text not null default 'B'
    check (priority_tier in ('A', 'B', 'C')),

  -- Current phase: prospecting (touches 1-7) or maintenance (quarterly)
  phase                 text not null default 'prospecting'
    check (phase in ('prospecting', 'maintenance', 'paused', 'dormant', 'converted')),

  -- Which touch number the contact is ON (1-7 for prospecting; 0 = not started)
  current_touch         integer not null default 0,

  -- Timestamp of most recent touchpoint of any kind
  last_touch_at         timestamptz,
  last_touch_type       text,                -- email | phone | flyer | meeting
  last_touch_template   text,                -- template_id used (e.g. T-001)

  -- Next recommended action
  next_touch_due        timestamptz,         -- when the next touch should happen
  next_touch_type       text,                -- email | phone
  next_touch_template   text,                -- recommended template_id

  -- ── Outcome Tracking ─────────────────────────────────────────────────────

  -- Engagement signals
  emails_sent           integer not null default 0,
  emails_opened         integer not null default 0,
  emails_replied        integer not null default 0,
  calls_made            integer not null default 0,
  calls_connected       integer not null default 0,
  meetings_scheduled    integer not null default 0,

  -- Consecutive unopened emails (for cool-down rules)
  consecutive_unopened  integer not null default 0,

  -- ── Cool-Down State ──────────────────────────────────────────────────────

  -- Last marketing flyer sent (3-day buffer before personal email)
  last_flyer_at         timestamptz,
  -- Last meeting/pitch (48hr buffer)
  last_meeting_at       timestamptz,
  -- Phone decline — no calls for 30 days
  phone_declined_at     timestamptz,
  -- Unsubscribe / opt-out
  unsubscribe_status    text not null default 'active'
    check (unsubscribe_status in ('active', 'paused', 'opt_out')),

  -- ── Escalation Flags ─────────────────────────────────────────────────────

  -- Lease expiration approaching (within 12 months)
  lease_expiry_flag     boolean default false,
  lease_expiry_date     date,
  -- New lease award detected
  new_award_flag        boolean default false,
  new_award_date        date,
  -- Market shift trigger
  market_shift_flag     boolean default false,

  -- ── Metadata ─────────────────────────────────────────────────────────────

  owner_user_id         uuid references auth.users(id),  -- assigned BD rep
  notes                 text,

  -- Prevent duplicate cadences for same contact+property
  constraint uq_cadence_contact_property unique (
    coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(property_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(sf_contact_id, '')
  )
);

-- ── INDEXES ────────────────────────────────────────────────────────────────

create index if not exists idx_cadence_entity on touchpoint_cadence(entity_id) where entity_id is not null;
create index if not exists idx_cadence_sf_contact on touchpoint_cadence(sf_contact_id) where sf_contact_id is not null;
create index if not exists idx_cadence_property on touchpoint_cadence(property_id) where property_id is not null;
create index if not exists idx_cadence_next_due on touchpoint_cadence(next_touch_due) where phase in ('prospecting', 'maintenance');
create index if not exists idx_cadence_phase_tier on touchpoint_cadence(phase, priority_tier);
create index if not exists idx_cadence_domain on touchpoint_cadence(domain);

-- ── RLS ────────────────────────────────────────────────────────────────────

alter table touchpoint_cadence enable row level security;

-- ── AUTO-UPDATE updated_at ─────────────────────────────────────────────────

create or replace function trg_cadence_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_cadence_updated_at on touchpoint_cadence;
create trigger set_cadence_updated_at
  before update on touchpoint_cadence
  for each row execute function trg_cadence_updated_at();

-- ── VIEW: Overdue Touchpoints (for daily briefing / queue) ─────────────────

create or replace view v_overdue_touchpoints as
select
  tc.*,
  case
    when tc.next_touch_due < now() - interval '7 days' then 'critical'
    when tc.next_touch_due < now() then 'overdue'
    when tc.next_touch_due < now() + interval '2 days' then 'due_soon'
    else 'on_track'
  end as urgency
from touchpoint_cadence tc
where tc.phase in ('prospecting', 'maintenance')
  and tc.unsubscribe_status = 'active'
  and tc.next_touch_due is not null
order by tc.next_touch_due asc;
