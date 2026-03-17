# Canonical Schema

This directory contains the canonical data model for the Life Command Center rebuild.

- `001_workspace_and_users.sql` — Workspace, users, roles, membership
- `002_connectors.sql` — Per-user connector accounts and sync tracking
- `003_canonical_entities.sql` — Unified entity model (person, org, asset)
- `004_operations.sql` — Inbox items, action items, activity events
- `005_domains.sql` — Domain registry and domain data source mapping
- `006_rls_policies.sql` — Row-level security policies for all tables (Phase 1)
- `007_queue_views.sql` — Unified queue views: my_work, team_queue, inbox_triage, sync_exceptions, entity_timeline, research_queue, work_counts (Phase 2)
- `008_watchers_and_oversight.sql` — Watchers/subscribers, escalations, manager overview, unassigned work views (Phase 4)
- `009_performance.sql` — Materialized views (mv_work_counts, mv_user_work_counts), 25+ indexes, perf_metrics table, pg_trgm (Phase 6)
- `010_domain_seeds.sql` — Bootstrap Government and Dialysis domains with sources, entity mappings, queue configs (Phase 7)
- `011_connector_verification.sql` — Connector verification, isolation check support, v_connector_checklist (RG2)

These migrations are designed for a shared Supabase project that serves as the canonical operational backbone alongside the existing Gov and Dia domain databases.

## Frontend Modules (Phase 5)
- `ops.js` — Operational UI module rendering My Work, Team Queue, Inbox Triage, Entities, Research, Metrics, Sync Health

## API Modules (RG7)
- `api/flags.js` — Feature flags API for rollout control (14 flags, workspace-scoped)

## Applying Migrations

Run these in order against your ops Supabase project. Each migration is idempotent (`CREATE IF NOT EXISTS`). RLS policies in `006` depend on all prior tables existing.

For the complete migration runbook with verification steps and rollback plan, see `RUNBOOK.md`.
