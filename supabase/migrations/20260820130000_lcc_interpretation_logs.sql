-- Lightweight append-only interpretation / subject-resolution log.
-- Read paths write best-effort rows here; absence/failure must never block a tool.

create table if not exists public.interpretation_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  surface text,
  tool text,
  raw_request text,
  raw_args jsonb not null default '{}'::jsonb,
  interpreted_intent jsonb,
  resolved_subject jsonb,
  resolution_status text not null,
  confidence numeric,
  alternatives jsonb not null default '[]'::jsonb,
  assumptions jsonb not null default '[]'::jsonb,
  quality_flags jsonb not null default '[]'::jsonb,
  output_mode text,
  handler_result_status text,
  user_id uuid
);

create index if not exists interpretation_logs_created_at_idx
  on public.interpretation_logs (created_at desc);

create index if not exists interpretation_logs_tool_status_idx
  on public.interpretation_logs (tool, resolution_status, created_at desc);

