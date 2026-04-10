# Life Command Center — Migration Runbook

> **Purpose**: Step-by-step guide for deploying the canonical operational platform.
> **Audience**: System administrators and the LCC development team.
> **Last updated**: 2026-03-17

---

## Prerequisites

- Access to Vercel dashboard for LCC deployment
- Supabase project access for the new ops database
- Power Automate admin access for flow configuration
- At least two team members available for validation

---

## Environment Variables

These must be set in Vercel before deployment:

| Variable | Required | Description |
|----------|----------|-------------|
| `OPS_SUPABASE_URL` | Yes | URL for the canonical ops Supabase project |
| `OPS_SUPABASE_KEY` | Yes | Service role key for the ops project |
| `GOV_SUPABASE_KEY` | Yes | Service role key for Government domain (existing) |
| `GOV_SUPABASE_URL` | No | Defaults to existing Gov project URL |
| `DIA_SUPABASE_KEY` | Yes | Service role key for Dialysis domain (existing) |
| `DIA_SUPABASE_URL` | No | Defaults to existing Dia project URL |
| `EDGE_FUNCTION_URL` | No | Defaults to existing ai-copilot edge function URL |
| `LCC_API_KEY` | Yes | API key used by Power Automate integrations and **required (strictly enforced)** for the `/api/property` endpoint which mirrors the Railway MCP `get_property_context` tool. Callers must send it as `X-LCC-Key: <value>`. Other endpoints fall back to transitional dev auth when unset. |
| `LCC_ENV` | Yes | Set to `production` for live deployment |

---

## Phase 1: Schema Migration

### Order of execution

Run these SQL migrations in order against the **ops Supabase project**. Each is idempotent.

```
1. schema/001_workspace_and_users.sql     — Core tables
2. schema/002_connectors.sql              — Connector infrastructure
3. schema/003_canonical_entities.sql      — Entity model
4. schema/004_operations.sql              — Operational tables
5. schema/005_domains.sql                 — Domain registry
6. schema/006_rls_policies.sql            — Row-level security
7. schema/007_queue_views.sql             — Queue views
8. schema/008_watchers_and_oversight.sql  — Watchers, escalations
9. schema/009_performance.sql             — Materialized views, indexes
10. schema/010_domain_seeds.sql           — Gov + Dia domain bootstrap
11. schema/011_connector_verification.sql — Connector verification support
```

### Verification after each batch

After migrations 001-005:
```sql
-- Verify core tables exist
select table_name from information_schema.tables
where table_schema = 'public'
and table_name in ('workspaces', 'users', 'workspace_memberships',
  'connector_accounts', 'sync_jobs', 'sync_errors',
  'entities', 'external_identities',
  'inbox_items', 'action_items', 'activity_events', 'research_tasks',
  'domains', 'domain_data_sources', 'domain_entity_mappings', 'domain_queue_configs');
-- Should return 16 rows
```

After migration 006:
```sql
-- Verify RLS is enabled
select tablename, rowsecurity from pg_tables
where schemaname = 'public' and rowsecurity = true;
```

After migration 007:
```sql
-- Verify views
select table_name from information_schema.views
where table_schema = 'public'
and table_name like 'v_%';
-- Should include: v_my_work, v_team_queue, v_inbox_triage, v_sync_exceptions,
--   v_entity_timeline, v_research_queue, v_work_counts
```

After migration 009:
```sql
-- Verify materialized views
select matviewname from pg_matviews where schemaname = 'public';
-- Should include: mv_work_counts, mv_user_work_counts

-- Refresh them
select refresh_work_counts();
```

### Rollback considerations

- Migrations 001-005 create new tables only — no impact on existing data.
- Migration 006 adds RLS policies — can be dropped individually if needed.
- Migration 007 creates views — can be dropped without data loss.
- Migrations 008-011 are additive — safe to drop.
- **No migration modifies existing Gov or Dia databases.**

---

## Phase 2: Initial Workspace Setup

```sql
-- Create the team workspace
insert into workspaces (name, slug, owner_id)
values ('SJC Team', 'sjc', null)
returning id;
-- Note the workspace ID for subsequent steps
```

```sql
-- Create team member records
-- (Replace UUIDs and emails with actual values)
insert into users (email, display_name, is_active) values
  ('scott@example.com', 'Scott Briggs', true),
  ('user2@example.com', 'Team Member 2', true),
  ('user3@example.com', 'Team Member 3', true),
  ('user4@example.com', 'Team Member 4', true);

-- Add workspace memberships
insert into workspace_memberships (workspace_id, user_id, role)
select '<workspace_id>', id,
  case when email = 'scott@example.com' then 'owner' else 'operator' end
from users where email in ('scott@example.com', 'user2@example.com', 'user3@example.com', 'user4@example.com');
```

---

## Phase 3: Connector Onboarding

### Per-user connector checklist

For each team member, register their connectors:

```
POST /api/connectors
{
  "connector_type": "outlook",
  "execution_method": "power_automate",
  "display_name": "Outlook - <user name>",
  "external_user_id": "<user's email address>",
  "target_user_id": "<user UUID>"  // if creating for another user
}
```

Repeat for `salesforce` connector type.

### Verification per user

```
POST /api/sync?action=verify_connector
{ "connector_id": "<connector UUID>" }
```

Expected: `edge_function_reachable: true`, no errors.

### Isolation check

After at least two users have connectors:

```
GET /api/sync?action=isolation_check
```

Expected: `fully_isolated: true`, no `cross_user_items`.

---

## Phase 4: Feature Flag Rollout

Enable features incrementally. Start conservative, expand once validated.

### Rollout sequence

```
# Stage 1: Core operational pages (pilot users)
POST /api/flags  { "flag": "ops_pages_enabled", "value": true }
POST /api/flags  { "flag": "more_drawer_enabled", "value": true }
POST /api/flags  { "flag": "queue_v2_enabled", "value": true }

# Stage 2: Sync automation
POST /api/flags  { "flag": "auto_sync_on_load", "value": true }

# Stage 3: Team features
POST /api/flags  { "flag": "team_queue_enabled", "value": true }
POST /api/flags  { "flag": "escalations_enabled", "value": true }
POST /api/flags  { "flag": "bulk_operations_enabled", "value": true }

# Stage 4: Outbound and domain expansion
POST /api/flags  { "flag": "sync_outbound_enabled", "value": true }
POST /api/flags  { "flag": "domain_templates_enabled", "value": true }
POST /api/flags  { "flag": "domain_sync_enabled", "value": true }

# Stage 5: Production auth lock
POST /api/flags  { "flag": "strict_auth", "value": true }
```

### Check current flags

```
GET /api/flags
```

---

## Phase 5: End-to-End Validation

### Test 1: Email → Inbox → Action → Complete

1. Flag an email in Outlook
2. `POST /api/sync?action=ingest_emails`
3. Verify item appears in `GET /api/inbox?action=list`
4. `POST /api/workflows?action=promote_to_shared` with the inbox item ID
5. Verify action appears in `GET /api/queue?view=my_work`
6. `PATCH /api/actions?id=<action_id>` with `{ "status": "completed" }`
7. Verify activity trail: `GET /api/queue?view=entity_timeline&entity_id=<id>`

### Test 2: Salesforce → Inbox → Assign → Escalate

1. `POST /api/sync?action=ingest_sf_activities`
2. Verify SF task appears as inbox item
3. `POST /api/workflows?action=sf_task_to_action` with inbox item + entity
4. `POST /api/workflows?action=reassign` to another team member
5. `POST /api/workflows?action=escalate` to manager with reason
6. Verify in `GET /api/workflows?action=oversight`

### Test 3: Multi-user isolation

1. User A syncs emails → verify items have `source_user_id = A`
2. User B syncs emails → verify items have `source_user_id = B`
3. `GET /api/sync?action=isolation_check` → verify `fully_isolated: true`
4. User A views inbox → should not see User B's private items

---

## Production Support Ownership

| Area | Owner | Notes |
|------|-------|-------|
| Power Automate flows | TBD | Outlook flagged-email, calendar, To-Do sync flows |
| Edge functions (ai-copilot) | TBD | Salesforce sync, email sync, calendar sync |
| Materialized view refresh | Automated (pg_cron) | `select refresh_work_counts();` every 5 min |
| Sync failure handling | On-call operator | Monitor via Sync Health page or `GET /api/sync?action=health` |
| Schema migrations | Development team | Run in order, verify with checklist above |
| Feature flag management | Manager+ role | Via `POST /api/flags` |

---

## Rollback Plan

### If schema migration fails
- Each migration is isolated. Drop the failed migration's objects and retry.
- No migration touches Gov or Dia databases.

### If sync causes data issues
- Disable sync via feature flags: `auto_sync_on_load: false`, connector-type flags to `false`
- Check `GET /api/sync?action=health` for error details
- Retry specific errors via `POST /api/sync?action=retry&error_id=<id>`

### If auth blocks users
- Set `LCC_ENV=development` temporarily to re-enable transitional auth
- Check workspace memberships: `GET /api/members?action=me`

### Full rollback
- Revert Vercel deployment to pre-rebuild commit
- Existing Gov/Dia functionality is unaffected (additive architecture)
