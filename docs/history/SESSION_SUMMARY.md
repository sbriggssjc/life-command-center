# Life Command Center — Rebuild Session Summary

> **Date**: 2026-03-17
> **Branch**: `claude/rebuild-command-center-X7uEd`
> **Commits**: 8 phase commits (Phase 0 through Phase 7)
> **Net impact**: +11,300 lines added, -3,435 lines removed across 34 files

---

## What Was Done

This session executed all 8 phases (Phase 0 through Phase 7) of a full-stack rebuild that transforms the Life Command Center from a single-user operator dashboard into a shared team operational platform. The entire rebuild was planned, implemented, and committed in a single session.

---

## Phase 0: Program Setup and Baseline

**Goal**: Audit the existing codebase, document the current state, identify all gaps, and lock architecture decisions before building anything.

### Files Created
| File | LOC | Purpose |
|------|-----|---------|
| `ROLLOUT.md` | 340 | Master rollout tracker — system map, gap register, architecture decisions, phase checklists |
| `schema/001_workspace_and_users.sql` | ~120 | Workspace, users, roles, membership tables |
| `schema/002_connectors.sql` | ~100 | Connector accounts, sync jobs, sync errors |
| `schema/003_canonical_entities.sql` | ~100 | Canonical entities, external identities |
| `schema/004_operations.sql` | ~120 | Inbox items, action items, activity events, research tasks |
| `schema/005_domains.sql` | ~100 | Domain registry, data sources, entity mappings, queue configs |

### What It Does

**Current-State Audit**:
- Full architecture inventory: Vanilla HTML/JS/CSS frontend, Vercel serverless API, two Supabase projects (Gov + Dia), Power Automate integration broker, external edge functions
- File inventory with LOC counts for all 12+ files
- Navigation structure documented (5 tabs, Business sub-tabs with 10 domain sections each)
- All integration paths classified (Gov/Dia Supabase, Salesforce, Outlook, Power Automate, Open-Meteo, Treasury)
- Data flow classification: shared vs. per-user vs. mixed vs. external

**Gap Register (10 gaps identified)**:
- **G1**: No multi-user model — hardcoded single user ("Scott"), no auth, no workspace concept
- **G2**: Overly broad API proxy — arbitrary table/filter/select, allows POST/PATCH to any table
- **G3**: No canonical operational model — activities, emails, tasks, research are separate silos
- **G4**: Single-user connector bindings — no per-user Salesforce/Outlook identity
- **G5**: No unified work queue — work organized by source system, not ownership/urgency
- **G6**: Frontend monolith — 14,000+ LOC across 3 JS files + 3,600 LOC inline in index.html
- **G7**: No domain expansion framework — Gov and Dia are independent parallel implementations
- **G8**: Client-side data stitching — large dataset loads, client-side joins, limited pagination
- **G9**: Power Automate opacity — no in-app visibility of flow health or errors
- **G10**: Missing entity deduplication — known duplicates in entity names

**Architecture Decisions (7 locked)**:
- **AD1**: Workspace-first model — one shared workspace for 4-person team
- **AD2**: Per-user connector accounts — each user gets own Outlook + Salesforce bindings
- **AD3**: Visibility model — shared/assigned/private scopes with promotion workflow
- **AD4**: Canonical operational types — all work normalizes to inbox_item, action_item, activity_event
- **AD5**: Policy-aware connectors — respect SSO and enterprise policy constraints
- **AD6**: Vercel serverless + Supabase backend — keep existing platform, add shared ops schema
- **AD7**: Incremental migration — additive changes, no big-bang rewrite

**Canonical Schema (migrations 001-005)**:
- 5 SQL migration files defining the complete canonical data model
- Workspace/user/membership/role tables with enum types
- Connector accounts with execution methods (direct_api, power_automate, webhook)
- Sync jobs and sync errors with correlation tracking
- Canonical entities (person, organization, asset) with external identity linking
- Operational tables: inbox_items, action_items, activity_events, research_tasks
- Domain registry with data sources, entity mappings, and queue configurations

---

## Phase 1: Workspace, Roles, and Policy Foundation

**Goal**: Build the auth and multi-user foundation — middleware, workspace management, RLS policies, and hardened API proxies.

### Files Created
| File | LOC | Purpose |
|------|-----|---------|
| `api/_shared/auth.js` | 240 | Auth middleware: JWT verification, API key auth, role checks, visibility enforcement |
| `api/_shared/ops-db.js` | 75 | Shared Supabase PostgREST client for canonical ops tables |
| `api/workspaces.js` | 115 | Workspace CRUD API |
| `api/members.js` | 175 | User and membership management API |
| `api/connectors.js` | 205 | Per-user connector account API |
| `schema/006_rls_policies.sql` | 265 | Row-level security policies for all canonical tables |

### What It Does

**Auth Middleware (`api/_shared/auth.js`)**:
- JWT token verification with Supabase auth
- API key authentication as fallback
- Role-based access control: `owner`, `manager`, `operator`, `viewer`
- Visibility enforcement: checks private/assigned/shared scopes
- **Transitional mode**: Falls back to a dev user when `OPS_SUPABASE_URL` is not configured, preserving existing single-user behavior during migration

**Workspace Management (`api/workspaces.js`)**:
- Create, read, update workspace with owner tracking
- Workspace settings stored as JSONB

**User/Membership API (`api/members.js`)**:
- Invite users to workspace with role assignment
- List workspace members with role filtering
- Update roles, deactivate memberships
- Enforces that workspace must always have at least one owner

**Connector Accounts (`api/connectors.js`)**:
- Per-user binding for Outlook, Salesforce, and other connectors
- Execution method tracking: `direct_api`, `power_automate`, `webhook`
- Health status tracking per connector
- Auto-create connector account on first use

**RLS Policies (`schema/006_rls_policies.sql`)**:
- Row-level security on all canonical tables
- Workspace-scoped isolation — users only see data from their workspace
- Visibility-aware policies respecting private/assigned/shared scopes
- Manager override for assigned-visibility items

**Frontend User Context**:
- Added `LCC_USER` global and `loadUserContext()` function
- Replaced all hardcoded "Scott" references with dynamic user context
- Auth token passed on all API calls to new endpoints

**API Proxy Hardening**:
- Added auth middleware to `gov-query.js` and `dia-query.js`
- Non-breaking: auth passes through in transitional mode

---

## Phase 2: Canonical Data and Queue Model

**Goal**: Build the canonical CRUD APIs, lifecycle state machines, and unified queue views that power the operational surfaces.

### Files Created
| File | LOC | Purpose |
|------|-----|---------|
| `api/_shared/lifecycle.js` | 200 | State machines, enum validators, transition effect definitions |
| `api/entities.js` | 180 | Canonical entity CRUD with external identity linking |
| `api/inbox.js` | 220 | Inbox items: list, triage, promote to action, assign |
| `api/actions.js` | 210 | Action items: CRUD with lifecycle state transitions |
| `api/activities.js` | 100 | Activity events: append-only timeline logging |
| `api/queue.js` | 155 | Unified queue: my_work, team_queue, inbox_triage, work_counts, entity_timeline |
| `schema/007_queue_views.sql` | 240 | 7 SQL views for unified queue |

### What It Does

**Lifecycle State Machines (`api/_shared/lifecycle.js`)**:
- **Inbox lifecycle**: `new` → `triaged` → `promoted`/`dismissed`/`snoozed`
- **Action lifecycle**: `open` → `in_progress` → `waiting`/`completed`/`cancelled`
- **Sync lifecycle**: `pending` → `running` → `completed`/`failed`
- Transition validator enforces legal state changes
- Transition effects: auto-set `completed_at` on completion, etc.
- Enum validators for entity types, priorities, visibility scopes, connector types

**Entities API (`api/entities.js`)**:
- CRUD for canonical entities (person, organization, asset)
- External identity linking: connect canonical entities to source system records (Gov property ID, Dia clinic ID, SF account ID)
- Dedup on external identity: prevents duplicate canonical entities for the same source record
- Workspace-scoped with visibility enforcement

**Inbox API (`api/inbox.js`)**:
- List inbox items with filtering by status, source type, assignee
- Triage: update status with activity logging
- Promote: convert inbox item to action item (sets status to `promoted`, creates linked action)
- Assign: set assignee with activity logging
- All mutations log to activity_events

**Actions API (`api/actions.js`)**:
- Full CRUD with lifecycle state enforcement
- Transition validation: only legal state changes allowed
- Due date tracking with overdue detection
- Entity linking: actions can be associated with canonical entities
- Domain tagging: actions tagged with originating domain

**Activities API (`api/activities.js`)**:
- Append-only timeline: POST only, no PATCH or DELETE
- Event types: status_change, assignment, note, sync, escalation, etc.
- Linked to entities, actions, or inbox items
- Immutable audit trail for compliance

**Queue API (`api/queue.js`)**:
- **my_work**: Current user's open actions + assigned inbox, sorted by priority/due date
- **team_queue**: All shared actions across workspace
- **inbox_triage**: New/triaged inbox items awaiting action
- **research_queue**: Open research tasks
- **work_counts**: Aggregated counts for dashboard cards
- **entity_timeline**: Activity history for a specific entity

**Queue SQL Views (`schema/007_queue_views.sql`)**:
- `v_my_work`, `v_team_queue`, `v_inbox_triage`, `v_sync_exceptions`, `v_entity_timeline`, `v_research_queue`, `v_work_counts`
- Pre-joined views with entity names, assignee info, domain labels
- Overdue flagging via computed columns

---

## Phase 3: Outlook and Salesforce Connector Rollout

**Goal**: Build per-user sync orchestration for email, calendar, and Salesforce data flowing into the canonical model.

### Files Created
| File | LOC | Purpose |
|------|-----|---------|
| `api/sync.js` | 380 | Sync orchestration: ingest emails/calendar/SF, outbound retries, health dashboard |

### What It Does

**Email Ingestion (`ingest_emails`)**:
- Calls existing edge function `ai-copilot/sync/flagged-emails` with per-user connector credentials
- Transforms flagged emails into `inbox_item` records with `source_type: 'email'`
- Deduplicates via external identity (email message ID)
- Creates sync job record with correlation ID for tracking
- Logs sync errors on failure

**Calendar Ingestion (`ingest_calendar`)**:
- Calls existing edge function `ai-copilot/sync/calendar-events` with per-user credentials
- Transforms calendar events into `activity_event` records
- Handles work + personal calendar separation
- Deduplicates via external identity (event ID)

**Salesforce Activity Ingestion (`ingest_sf_activities`)**:
- Calls existing edge function `ai-copilot/sync/sf-activities` with per-user credentials
- Activities → `activity_event` records
- Open SF tasks → `inbox_item` records with `source_type: 'salesforce'`
- Links to canonical entities via external identity when SF account/contact IDs match

**Outbound Command Handling (`outbound`)**:
- Sends commands back to source systems (e.g., log call to Salesforce, complete To-Do in Outlook)
- Exponential backoff retry: 1s, 2s, 4s on failure
- Records sync job with success/failure status

**Sync Health Dashboard (`health`)**:
- Per-user connector health: last sync time, success rate, error count
- Overall workspace sync summary
- Lists recent sync errors with retry capability

**Sync Error Retry (`retry`)**:
- Retry a specific failed sync error by ID
- Re-attempts the original operation
- Updates error record with retry result

**Connector Auto-Resolution**:
- If no `connector_account` exists for a user+type combination, one is auto-created
- Supports the transition period where existing users haven't explicitly set up connectors

**Frontend Integration**:
- `triggerCanonicalSync()` added to frontend — fires after initial page load
- Runs email, calendar, and SF sync in background
- Non-blocking: failures don't affect main app functionality

---

## Phase 4: Shared Team Workflow Rollout

**Goal**: Build compound multi-step workflows on top of the canonical model APIs.

### Files Created
| File | LOC | Purpose |
|------|-----|---------|
| `api/workflows.js` | 420 | Workflow engine with 9 compound operations |
| `schema/008_watchers_and_oversight.sql` | 180 | Watchers, escalations, manager overview views |

### What It Does

**Promotion Workflows** — compound operations that move items through the system:
- **`promote_to_shared`**: Private inbox item → shared team action item. Auto-watches creator and assignee, tracks provenance from source inbox item, handles direct `new→promoted` transition.
- **`sf_task_to_action`**: Salesforce task inbox item → entity-linked shared action. Auto-creates external identity link between the SF task and the canonical entity.
- **`research_followup`**: Completes a research task and optionally creates a follow-up action item in one atomic operation.

**Team Operations** — reassignment, escalation, and bulk actions:
- **`reassign`**: Transfer any work item (action, inbox, or research) to another team member. Logs activity, auto-watches new assignee.
- **`escalate`**: Escalate an action to a manager with tracked reason. Creates an `escalation` record, auto-bumps priority, both parties auto-watched.
- **`bulk_assign`**: Manager-only batch assignment of multiple items to one user.
- **`bulk_triage`**: Batch triage of inbox items with optional priority and assignee.

**Subscriber Model**:
- **`watch`/`unwatch`**: Subscribe to action items, entities, or inbox items.
- Auto-watch pattern: creators, assignees, and escalation parties are automatically subscribed.

**Schema**:
- `watchers` table with constraint ensuring exactly one target per row (action, entity, or inbox).
- `escalations` table with resolution tracking.
- `v_manager_overview` view: per-user team health metrics (active/overdue/completed actions, inbox backlog, connector health, last activity).
- `v_unassigned_work` view: items across all types with no assignee.

---

## Phase 5: UX and Interaction Redesign

**Goal**: Rework the frontend from a 5-tab source-organized layout to a queue-first operational layout with 9+ sections.

### Files Created
| File | LOC | Purpose |
|------|-----|---------|
| `ops.js` | 520 | Operational UI module — 7 new page renderers |

### Files Modified
| File | Change |
|------|--------|
| `index.html` | New page containers, reworked bottom nav, More drawer, updated stat cards |
| `styles.css` (inline at this point) | ~150 lines of new CSS for queue items, badges, freshness dots, sync banners |

### Navigation Redesign

**Before**: 5 static bottom tabs — Today, Business, Calendar, Messages, Settings.

**After**: 5 primary bottom tabs + slide-up More drawer:
- **Primary tabs**: Today, My Work, Queue, Inbox, More
- **More drawer** (4-column grid): Calendar, Entities, Research, Metrics, Sync Health, Business, Messages, Settings

Centralized `handlePageLoad()` router dispatches to the correct renderer for all 11 pages. `navTo()` and `navToFromMore()` support navigation from anywhere.

### Seven New Operational Pages

| Page | Data Source | Key Features |
|------|-----------|--------------|
| **My Work** | `queue?view=my_work` | Filter pills (all/open/in_progress/waiting/overdue), quick-action controls |
| **Team Queue** | `queue?view=team_queue` + `workflows?action=unassigned` | Unassigned work alert section, assign/escalate controls |
| **Inbox Triage** | `inbox?action=list` | Select-all checkbox bar, bulk triage/promote/dismiss, per-item quick actions |
| **Entities** | `entities?action=list` | Entity type filter pills, click-to-detail |
| **Research** | `queue?view=research_queue` | Active/completed filter, complete + follow-up workflow buttons |
| **Metrics** | `queue?view=work_counts` + `workflows?action=oversight` | Work count cards, team member stats, open escalation list |
| **Sync Health** | `connectors?action=list` + `sync?action=health` | Connector status cards, sync summary, error list with retry |

### Queue Item UX
- Every item displays status, priority, type, and domain badges.
- Quick-action buttons on every item: **Start**, **Complete**, **Wait**, **Assign**, **Escalate**.
- Overdue items highlighted with red left border; urgent items pulse-animate.

### Freshness and Sync Warnings
- **Freshness dots**: green (<5 min), yellow (<6 hr), red (>6 hr) on all items.
- **Sync warning banners** when connectors are degraded or failing.
- **Home page stat cards** rewired to canonical model (My Actions, Inbox, Due This Week) via `work_counts` API.

---

## Phase 6: Performance and Operational Optimization

**Goal**: Split the monolithic frontend, add pagination, create materialized views, add performance indexes, and instrument everything.

### Files Created
| File | LOC | Purpose |
|------|-----|---------|
| `styles.css` | 830 | Extracted CSS (was inline in index.html) |
| `app.js` | 2,865 | Extracted core JS (nav, calendar, weather, messages, settings, copilot) |
| `api/queue-v2.js` | 250 | Paginated queue endpoints with server-side aggregation |
| `schema/009_performance.sql` | 200 | Materialized views, 25+ indexes, perf_metrics table |

### Frontend Modularization

**Before**: `index.html` was 3,955 lines containing all HTML, CSS, and JS.

**After**: `index.html` is 372 lines of pure HTML structure. CSS and JS extracted to separate files:

| File | LOC | Contents |
|------|-----|----------|
| `index.html` | 372 | HTML structure only |
| `styles.css` | 830 | All component styles |
| `app.js` | 2,865 | Core JS (nav, calendar, weather, messages, settings, copilot, business tabs) |
| `gov.js` | 3,700 | Government domain module (unchanged) |
| `dialysis.js` | 4,352 | Dialysis domain module (unchanged) |
| `detail.js` | 2,261 | Property detail panel (unchanged) |
| `ops.js` | 520 | Operational UI (Phase 5) |
| `treasury.js` | 152 | Market data (unchanged) |

### Queue V2 API (`api/queue-v2.js`)
- Proper `page`/`per_page` pagination on all views (my_work, team_queue, inbox, research, work_counts, entity_timeline).
- Sort parameter whitelisting (due_date, created_at, priority, status, title).
- Cursor-based pagination on `entity_timeline` for infinite scroll.
- `Server-Timing` and `X-Response-Time` headers on every response.
- ops.js auto-tries v2 endpoints first, gracefully degrades to v1 on 404.

### Materialized Views
- **`mv_work_counts`**: Pre-computed workspace-level aggregations — open/overdue/completed actions, inbox counts, research, sync errors, entity totals, escalations. Replaces expensive joins.
- **`mv_user_work_counts`**: Per-user action/inbox/research counts for fast badge rendering.
- **`refresh_work_counts()`**: PL/pgSQL function for concurrent refresh via pg_cron.

### Performance Indexes (25+)
All use partial index WHERE clauses to minimize index size:

| Table | Indexes |
|-------|---------|
| `action_items` | workspace+status, assigned, owner, due_date, entity, domain, completed_at |
| `inbox_items` | workspace+status, assigned, source_type, received_at |
| `entities` | workspace+type, name trigram (pg_trgm), domain |
| `activity_events` | entity+time, workspace+time, actor+time |
| `external_identities` | source_system+external_id |
| `sync_jobs` | connector+time, status |
| `sync_errors` | unresolved by connector |
| `connector_accounts` | workspace+type |
| `workspace_memberships` | user_id |

### Client/Server Instrumentation
- **Client**: `opsPerf()` wraps every render function. Logs to `opsPerfLog` array (last 200 entries). Console warns on >500ms renders. Beacons >100ms timings to server.
- **Server**: `perf_metrics` table with metric_type, endpoint, duration_ms, metadata jsonb. Time-partitioned index. 30-day auto-expiry recommendation.

---

## Phase 7: Domain Expansion Framework

**Goal**: Create a generic framework for onboarding new business verticals, standardize how Gov and Dia connect, and provide templates for future domains.

### Files Created
| File | LOC | Purpose |
|------|-----|---------|
| `api/domains.js` | 470 | Domain expansion API — full lifecycle management |
| `schema/010_domain_seeds.sql` | 200 | Bootstrap Gov and Dia domain configurations |

### Domain Onboarding API (12 endpoints)

| Action | Method | Purpose |
|--------|--------|---------|
| `list` | GET | List registered domains with sources and mappings |
| `get` | GET | Full domain config with all related records |
| `templates` | GET | List available built-in domain templates |
| `register` | POST | Create new domain with slug validation and dedup |
| `add_source` | POST | Attach data source (supabase, api, csv, manual, webhook) |
| `add_entity_mapping` | POST | Map source tables → canonical entities with field mapping |
| `add_queue_config` | POST | Configure queue feeding with priority/filter expressions |
| `validate` | POST | Probe data source connections, update `last_verified_at` |
| `apply_template` | POST | Bootstrap complete domain from built-in template |
| `toggle` | POST | Activate/deactivate domain |
| `sync_entities` | POST | Generic entity sync from domain sources to canonical model |

### Field Mapping Engine
The `applyFieldMapping()` function transforms domain source records into canonical entities:
- **Simple field reference**: `"city"` → `record.city`
- **Template interpolation**: `"{address} - {city}, {state}"` → `"123 Main St - Tulsa, OK"`
- **Array concat**: `["first_name", "last_name"]` → `"John Smith"`
- **Metadata passthrough**: `_metadata` and `_external_id` special fields

### Generic Entity Sync
`sync_entities` performs a complete domain sync:
1. Reads `domain_entity_mappings` for the domain
2. Queries the domain database through its proxy endpoint
3. Applies field mapping to each record
4. Checks for existing canonical entity via `external_identities`
5. Updates existing or creates new entity with external identity link
6. Logs activity event with counts

### 4 Built-in Domain Templates

| Template | Slug | Entity Types | Queue Types | Data Source |
|----------|------|-------------|-------------|-------------|
| **Government** | `government` | property, company | pipeline, research | Gov Supabase |
| **Dialysis** | `dialysis` | property, company | pipeline | Dia Supabase |
| **Education/Daycare** | `education_daycare` | property, company | pipeline, research (license verification) | Manual |
| **Urgent Care** | `urgent_care` | property, company | pipeline, research (market analysis) | Manual |

Each template includes complete configuration: data sources, entity mappings with field mapping objects, and queue configs with priority expressions and filter expressions.

### Schema Seed (`010_domain_seeds.sql`)
Idempotent SQL migration that bootstraps Government and Dialysis domains:
- Creates domain records with display names, colors, icons, and config
- Attaches data sources with proxy paths
- Creates entity mappings (properties → property, players/providers → company)
- Creates queue configs with priority expressions and filter expressions
- Uses `NOT EXISTS` guards for safe re-runs

---

## Complete File Inventory (Created/Modified This Session)

### Schema Migrations (10 files, ~1,930 LOC)
| File | LOC | Phase | Contents |
|------|-----|-------|----------|
| `schema/001_workspace_and_users.sql` | ~120 | 0 | Workspaces, users, roles, membership |
| `schema/002_connectors.sql` | ~100 | 0 | Connector accounts, sync jobs, sync errors |
| `schema/003_canonical_entities.sql` | ~100 | 0 | Entities (person/org/asset), external identities |
| `schema/004_operations.sql` | ~120 | 0 | Inbox items, action items, activity events, research tasks |
| `schema/005_domains.sql` | ~100 | 0 | Domain registry, data sources, entity mappings, queue configs |
| `schema/006_rls_policies.sql` | 265 | 1 | Row-level security policies for all tables |
| `schema/007_queue_views.sql` | 240 | 2 | 7 unified queue views |
| `schema/008_watchers_and_oversight.sql` | 180 | 4 | Watchers, escalations, v_manager_overview, v_unassigned_work |
| `schema/009_performance.sql` | 200 | 6 | Materialized views, 25+ indexes, perf_metrics |
| `schema/010_domain_seeds.sql` | 200 | 7 | Gov and Dia domain bootstrap data |

### Shared Infrastructure (3 files, ~515 LOC)
| File | LOC | Phase | Purpose |
|------|-----|-------|---------|
| `api/_shared/auth.js` | 240 | 1 | JWT + API key auth, role checks, visibility enforcement |
| `api/_shared/lifecycle.js` | 200 | 2 | State machines, enum validators, transition effects |
| `api/_shared/ops-db.js` | 75 | 1 | Shared Supabase PostgREST client |

### API Endpoints (13 files, ~3,480 LOC)
| File | LOC | Phase | Endpoints |
|------|-----|-------|-----------|
| `api/workspaces.js` | 115 | 1 | Workspace CRUD |
| `api/members.js` | 175 | 1 | User/membership management |
| `api/connectors.js` | 205 | 1 | Per-user connector accounts |
| `api/entities.js` | 180 | 2 | Canonical entity CRUD + external identity |
| `api/inbox.js` | 220 | 2 | Inbox triage, promote, assign |
| `api/actions.js` | 210 | 2 | Action items with lifecycle transitions |
| `api/activities.js` | 100 | 2 | Append-only activity timeline |
| `api/queue.js` | 155 | 2 | Unified queue views (v1) |
| `api/sync.js` | 380 | 3 | Sync orchestration, health, retries |
| `api/workflows.js` | 420 | 4 | 9 workflow operations (promote, SF link, reassign, escalate, watch, bulk ops) |
| `api/queue-v2.js` | 250 | 6 | 6 paginated queue views with instrumentation |
| `api/domains.js` | 470 | 7 | 12 domain management operations |

### Frontend Modules (3 new files, ~4,215 LOC)
| File | LOC | Phase | Purpose |
|------|-----|-------|---------|
| `ops.js` | 520 | 5 | 7 operational page renderers |
| `styles.css` | 830 | 6 | Complete extracted CSS |
| `app.js` | 2,865 | 6 | Core JS: nav, calendar, weather, messages, settings, copilot |

### Documentation (2 files)
| File | Phase | Purpose |
|------|-------|---------|
| `ROLLOUT.md` | 0 | Master rollout tracker — created in Phase 0, updated every phase |
| `schema/README.md` | 0+ | Schema documentation, updated incrementally |

### Modified Files
| File | Change Summary |
|------|---------------|
| `index.html` | 3,955 → 372 LOC. Extracted CSS/JS, added 7 new page containers, reworked nav to 5+More, added More drawer |
| `api/gov-query.js` | Added auth middleware (non-breaking, transitional mode) |
| `api/dia-query.js` | Added auth middleware (non-breaking, transitional mode) |

---

## Cumulative System Architecture (All Phases)

### Schema (10 migrations)
```
001_workspace_and_users.sql    — Workspaces, users, roles, membership
002_connectors.sql             — Per-user connector accounts, sync tracking
003_canonical_entities.sql     — Entities (person/org/asset), external identities
004_operations.sql             — Inbox items, action items, activity events, research tasks
005_domains.sql                — Domain registry, data sources, entity mappings, queue configs
006_rls_policies.sql           — Row-level security for all tables
007_queue_views.sql            — 7 unified queue views
008_watchers_and_oversight.sql — Watchers, escalations, manager views
009_performance.sql            — Materialized views, 25+ indexes, perf metrics
010_domain_seeds.sql           — Gov + Dia domain bootstrap
```

### API Layer (16 endpoints)
```
api/_shared/auth.js       — JWT + API key auth, role checks, visibility
api/_shared/lifecycle.js  — State machines, enum validators
api/_shared/ops-db.js     — Shared Supabase PostgREST client
api/workspaces.js         — Workspace CRUD
api/members.js            — User/membership management
api/connectors.js         — Per-user connector accounts
api/entities.js           — Canonical entity CRUD + external identity
api/inbox.js              — Inbox triage, promote, assign
api/actions.js            — Action items with lifecycle transitions
api/activities.js         — Append-only activity timeline
api/queue.js              — Unified queue views (v1)
api/queue-v2.js           — Paginated queue with instrumentation (v2)
api/sync.js               — Sync orchestration, health, retries
api/workflows.js          — Compound team workflows
api/domains.js            — Domain expansion lifecycle
api/gov-query.js          — Gov Supabase proxy (hardened)
api/dia-query.js          — Dia Supabase proxy (hardened)
```

### Frontend (6 JS modules + 1 CSS)
```
app.js        — Core: nav, calendar, weather, messages, settings, copilot (2,865 LOC)
gov.js        — Government domain module (3,700 LOC)
dialysis.js   — Dialysis domain module (4,352 LOC)
detail.js     — Property detail panel (2,261 LOC)
ops.js        — Operational pages: My Work, Queue, Inbox, Entities, Research, Metrics, Sync (520 LOC)
treasury.js   — Market data (152 LOC)
styles.css    — All component styles (830 LOC)
index.html    — HTML structure only (372 LOC)
```

### Navigation (11 pages)
```
Primary (bottom nav):   Today | My Work | Queue | Inbox | More
More drawer:            Calendar | Entities | Research | Metrics | Sync Health | Business | Messages | Settings
```

---

## Key Design Patterns Established

1. **Auto-watch on assignment**: Creators, assignees, and escalation targets are automatically subscribed as watchers.
2. **Promotion workflow**: Private inbox items can be promoted to shared team actions with full provenance tracking.
3. **Queue-first UI**: Every work item has inline quick-action buttons (Start/Complete/Wait/Assign/Escalate).
4. **Freshness indicators**: Green/yellow/red dots show data age on every item.
5. **V2 auto-fallback**: Frontend tries paginated v2 endpoints first, silently degrades to v1.
6. **Domain templates**: New business verticals can be bootstrapped with a single API call.
7. **Field mapping engine**: Template interpolation (`{address} - {city}, {state}`) maps any source schema to canonical entities.
8. **Materialized views**: Pre-computed counts replace expensive joins; concurrent refresh via pg_cron.
9. **Append-only activity events**: Immutable audit trail — no PATCH or DELETE.
10. **Transitional auth**: Auth middleware falls back to dev user when OPS DB isn't configured, preserving existing behavior.
