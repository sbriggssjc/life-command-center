-- ============================================================================
-- Phase 4 — Cadence-engine alerts
-- ----------------------------------------------------------------------------
-- Records the alerts the daily cadence tick produces. Distinct from the
-- existing `touchpoint_cadence` table (per-contact scheduling state) — this
-- is the cross-data alert surface that says "Bob has gone cold" or "another
-- rep is hammering the Acme account."
--
-- The unique-per-day index means re-running the tick on the same day is
-- idempotent: already-emitted alerts collide and silently skip, so Teams
-- doesn't get spammed and the table doesn't bloat.
-- ============================================================================

create table if not exists cadence_alerts (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  alert_type      text not null
    check (alert_type in (
      'going_cold','heating_up','stale_opportunity',
      'silent_account','other'
    )),
  subject_kind    text not null
    check (subject_kind in ('contact','account','opportunity','property','other')),
  subject_id      uuid,
  subject_label   text,                    -- denormalized name for display
  assigned_to     uuid references users(id) on delete set null,
  severity        text not null default 'info'
    check (severity in ('info','high','critical')),
  message         text not null,
  details         jsonb not null default '{}'::jsonb,
  emitted_at      timestamptz not null default now(),
  emitted_on_date date generated always as ((emitted_at)::date) stored,
  acknowledged_at timestamptz,
  acknowledged_by uuid references users(id) on delete set null,
  resolved_at     timestamptz
);

-- Once-per-(subject, alert_type, day) dedupe. Re-running the tick on the
-- same day is a no-op for already-emitted alerts. A different alert_type
-- against the same subject can still emit (so a contact can be both
-- "going cold" AND "stale_opportunity" on the same day if circumstances
-- warrant).
create unique index if not exists ux_cadence_alerts_dedupe
  on cadence_alerts (workspace_id, alert_type, subject_kind, subject_id, emitted_on_date)
  where subject_id is not null;

-- Hot indexes for the inbox-style "alerts I haven't acknowledged" view.
create index if not exists ix_cadence_alerts_assignee_open
  on cadence_alerts (assigned_to, emitted_at desc)
  where acknowledged_at is null;
create index if not exists ix_cadence_alerts_workspace_emitted
  on cadence_alerts (workspace_id, emitted_at desc);
create index if not exists ix_cadence_alerts_open_per_workspace
  on cadence_alerts (workspace_id, alert_type, emitted_at desc)
  where acknowledged_at is null;
