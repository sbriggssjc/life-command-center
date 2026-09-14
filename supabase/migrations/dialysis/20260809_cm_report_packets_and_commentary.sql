-- Capital Markets report packet freeze + commentary store.
-- Applied to each vertical's domain DB. Dialysis lands first; government uses
-- the same table shape when cm_gov_* views register.

create extension if not exists "uuid-ossp";

create table if not exists public.cm_report_snapshots (
  snapshot_id uuid primary key default uuid_generate_v4(),
  vertical text not null,
  fiscal_quarter text not null,
  period_end date not null,
  packet jsonb not null,
  frozen_at timestamptz not null default now(),
  frozen_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cm_report_snapshots_vertical_quarter_uq unique (vertical, fiscal_quarter)
);

create index if not exists cm_report_snapshots_period_idx
  on public.cm_report_snapshots (vertical, period_end desc);

create table if not exists public.cm_report_commentary (
  commentary_id uuid primary key default uuid_generate_v4(),
  vertical text not null,
  fiscal_quarter text not null,
  page_id text not null,
  title text,
  copy text not null default '',
  status text not null default 'draft'
    check (status in ('draft', 'edited', 'approved')),
  source text not null default 'manual',
  edited_by text,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cm_report_commentary_page_uq unique (vertical, fiscal_quarter, page_id)
);

create index if not exists cm_report_commentary_quarter_idx
  on public.cm_report_commentary (vertical, fiscal_quarter, status, page_id);
