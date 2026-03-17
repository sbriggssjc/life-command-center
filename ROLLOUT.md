# Life Command Center — Rebuild Rollout Tracker

> **Purpose**: Track progress across all phases of the LCC rebuild from operator dashboard to shared team operational platform.
> **Last updated**: 2026-03-17
> **Branch**: `claude/rebuild-command-center-X7uEd`

---

## Current-State System Map

### Architecture Overview

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | Vanilla HTML/JS/CSS (single `index.html` + domain modules) | PWA-capable, mobile-first, ~3,600 lines in index.html |
| Domain Modules | `gov.js` (3,700 LOC), `dialysis.js` (4,352 LOC), `detail.js` (2,261 LOC) | Loaded as separate scripts, override placeholder functions |
| API Proxy | Vercel serverless functions in `/api/` | `gov-query.js`, `dia-query.js`, `treasury.js`, `config.js` |
| Backend | Supabase (PostgREST) — two separate projects | Gov: `scknotsqkcheojiaewwh`, Dia: `zqzrriwuavgrquhisnoa` |
| External Edge Functions | Supabase Edge Functions (`ai-copilot`) | Hosts sync endpoints for Salesforce, Outlook, calendar |
| Integration Broker | Power Automate flows | Outlook flagged-email sync, calendar sync, To-Do sync |
| External APIs | Open-Meteo (weather), US Treasury (yields), Salesforce (via edge fn) | |
| Hosting | Vercel | Serverless API routes, static frontend |

### File Inventory

| File | LOC | Purpose |
|------|-----|---------|
| `index.html` | 3,617 | Full app shell: HTML structure, CSS, all core JS logic |
| `gov.js` | 3,700 | Government domain module: overview, search, ownership, pipeline, sales, leases, loans, players, research |
| `dialysis.js` | 4,352 | Dialysis domain module: overview, search, CMS data, NPI intel, sales, leases, loans, players, research, activity |
| `detail.js` | 2,261 | Unified property detail panel shared across Gov and Dia |
| `api/gov-query.js` | 143 | Vercel serverless proxy for Government Supabase (GET/POST/PATCH) |
| `api/dia-query.js` | 139 | Vercel serverless proxy for Dialysis Supabase (GET/POST/PATCH) |
| `api/treasury.js` | 152 | Treasury yield data API (XML/CSV/Fiscal Data API fallbacks) |
| `api/_shared/auth.js` | 240 | Auth middleware: JWT, API key, role checks, visibility |
| `api/_shared/lifecycle.js` | 200 | State machines, enum validators, transition effects |
| `api/_shared/ops-db.js` | 75 | Shared Supabase PostgREST client for canonical tables |
| `api/workspaces.js` | 115 | Workspace CRUD API |
| `api/members.js` | 175 | User/membership management API |
| `api/connectors.js` | 205 | Per-user connector account API |
| `api/entities.js` | 180 | Canonical entity CRUD + external identity linking |
| `api/inbox.js` | 220 | Inbox items: triage, promote to action, assign |
| `api/actions.js` | 210 | Action items: CRUD with lifecycle state transitions |
| `api/activities.js` | 100 | Activity events: append-only timeline logging |
| `api/queue.js` | 155 | Unified queue: my work, team, inbox, counts, entity timeline |
| `api/sync.js` | 380 | Sync orchestration: ingest emails/calendar/SF, outbound retries, health |
| `api/workflows.js` | 420 | Workflow engine: promote, link SF, research follow-up, reassign, escalate, bulk ops |
| `ops.js` | 480 | Operational UI: My Work, Team Queue, Inbox Triage, Entities, Research, Metrics, Sync Health |
| `api/config.js` | 15 | Connection status endpoint |
| `schema/006_rls_policies.sql` | 265 | Row-level security policies for all tables |
| `schema/007_queue_views.sql` | 240 | Unified queue views for operational surfaces |
| `schema/008_watchers_and_oversight.sql` | 180 | Watchers, escalations, manager overview, unassigned work views |
| `sw.js` | 62 | Service worker for PWA |
| `config.js` | 15 | Root config (duplicate of api/config.js) |
| `flow-*.json` | 4 files | Power Automate flow definitions |

### Navigation Structure (Current)

**Bottom Nav (5 tabs)**:
1. **Today** (`pageHome`) — Greeting, stats (Activities/Emails/Events/Due), weather, markets/treasury, activity breakdown, today's schedule, priority tasks, flagged emails
2. **Business** (`pageBiz`) — Sub-tabs: Dialysis, Government, Marketing, Prospects, All Other
3. **Calendar** (`pageCal`) — Full calendar view
4. **Messages** (`pageMessages`) — Flagged/Recent/Sent email tabs
5. **Settings** (`pageSettings`) — Connection status, sync controls, preferences

**Business Sub-tabs**:
- **Dialysis**: Overview, Search, CMS Data, NPI Intel, Sales, Leases, Loans, Players, Research, Activity
- **Government**: Overview, Search, Ownership, Pipeline, Sales, Leases, Loans, Players, Research
- **Marketing**: Deals + Leads from Dialysis Supabase
- **Prospects**: Cross-database search across Gov + Dia
- **All Other**: Salesforce activities not tied to a domain

### Integration Paths

| Integration | Direction | Method | Owner | Notes |
|------------|-----------|--------|-------|-------|
| Gov Supabase | Read/Write | Vercel proxy → PostgREST | Shared | `gov-query.js` proxies all requests |
| Dia Supabase | Read/Write | Vercel proxy → PostgREST | Shared | `dia-query.js` proxies all requests |
| Salesforce Activities | Read | Edge Function (`ai-copilot/sync/sf-activities`) | Single-user | No per-user binding |
| Salesforce Log | Write | Edge Function (`ai-copilot/sync/log-to-sf`) | Single-user | Logs calls/activities |
| Outlook Flagged Emails | Read | Edge Function (`ai-copilot/sync/flagged-emails`) | Single-user | Via Power Automate |
| Calendar Events | Read | Edge Function (`ai-copilot/sync/calendar-events`) | Single-user | Work + Personal calendars |
| Power Automate | Broker | External flows | Enterprise | Email flag → To-Do, Calendar sync |
| Open-Meteo | Read | Direct fetch | Public | Weather with geolocation |
| Treasury.gov | Read | Vercel proxy | Public | Yield curve data |
| AI Copilot | Read/Write | Edge Function (`ai-copilot/chat`) | Single-user | Natural language queries |

### Data Flow Classification

| Workflow | Current Scope | Target Scope |
|----------|--------------|--------------|
| Gov properties/leases/ownership | Shared (Supabase) | Shared |
| Dia clinics/CMS/NPI/sales | Shared (Supabase) | Shared |
| Salesforce activities | Single-user global | Per-user, promotable to shared |
| Flagged emails | Single-user global | Per-user, promotable to shared actions |
| Calendar events | Single-user global | Per-user |
| Marketing deals/leads | Shared (Dia Supabase) | Shared |
| Research outcomes | Shared (domain Supabase) | Shared |
| AI copilot conversations | Single-user | Per-user |

---

## Gap Register

### G1: No multi-user model
- **Impact**: Critical — blocks team expansion
- **Current**: Hardcoded single user ("Scott"), no auth, no workspace concept
- **Required**: Workspace, user, membership, role, visibility model

### G2: Overly broad API proxy
- **Impact**: High — security risk at scale
- **Current**: `gov-query.js` and `dia-query.js` accept arbitrary table/filter/select params, allow POST/PATCH to any table
- **Required**: Scoped command endpoints, route-level auth, input validation

### G3: No canonical operational model
- **Impact**: High — blocks unified queue
- **Current**: Activities, emails, tasks, research items are separate data silos
- **Required**: Canonical entity, inbox_item, action_item, activity_event types

### G4: Single-user connector bindings
- **Impact**: High — blocks team connector rollout
- **Current**: Salesforce/Outlook connections are global, no per-user identity
- **Required**: Per-user connector accounts with health monitoring

### G5: No unified work queue
- **Impact**: Medium — forces context switching
- **Current**: Work is organized by source system and domain tab
- **Required**: My Work, Team Queue, Inbox views organized by ownership/urgency

### G6: Frontend monolith
- **Impact**: Medium — maintainability and performance
- **Current**: 14,000+ LOC across 3 large JS files + 3,600 LOC in index.html
- **Required**: Modular code organization, lazy loading, pagination

### G7: No domain expansion framework
- **Impact**: Medium — each vertical requires custom architecture
- **Current**: Gov and Dia are independent parallel implementations
- **Required**: Domain registry, standardized data source mapping, shared queue

### G8: Client-side data stitching
- **Impact**: Medium — performance at scale
- **Current**: Large dataset loads, client-side joins, limited pagination
- **Required**: Server-side aggregations, queue-first endpoints, virtualization

### G9: Power Automate opacity
- **Impact**: Medium — hard to debug sync issues
- **Current**: Flow definitions exist but no in-app visibility of flow health/errors
- **Required**: Connector health dashboard, sync error tracking, correlation IDs

### G10: Missing entity deduplication
- **Impact**: Low-Medium — data quality
- **Current**: Known duplicates in entity names (Boyd Watterson variants, etc.)
- **Required**: Entity alias table, canonical name resolution

---

## Architecture Decisions (Locked)

### AD1: Workspace-first model
- One shared workspace for the 4-person team
- All operational records are workspace-scoped
- Future: support multiple workspaces if needed

### AD2: Per-user connector accounts
- Each user gets their own Outlook + Salesforce bindings
- Connector execution method: `direct_api` | `power_automate` | `webhook`
- Outlook and Salesforce initially treated as Power Automate-mediated

### AD3: Visibility model
- **shared**: All workspace members can see (entities, domain data, promoted actions)
- **assigned**: Only owner/assignee can see, but managers can view
- **private**: Only the source user (drafts, personal inbox before promotion)
- Source artifacts (emails, calendar) default to private; promotable to shared

### AD4: Canonical operational types
- All work items normalize into: `inbox_item`, `action_item`, `activity_event`
- All business entities normalize into: `entity_person`, `entity_organization`, `entity_asset`
- External systems link via `external_identity` mapping

### AD5: Policy-aware connectors
- Salesforce auth is SSO-governed — do not bypass
- Outlook access is enterprise-policy-mediated via Power Automate
- Supabase remains the shared domain data platform
- Connector model must support mediated execution, not just direct API

### AD6: Vercel serverless + Supabase backend
- Keep Vercel as hosting and serverless function platform
- Keep Supabase as shared domain data backend
- Add a new shared Supabase project (or schema) for canonical operational data
- API proxy hardening happens via scoped endpoint refactoring

### AD7: Incremental migration
- All changes are additive — no big-bang rewrite
- New canonical model runs alongside existing domain queries
- Frontend refactoring happens after backend foundation is solid

---

## Phase Progress

### Phase 0: Program Setup and Baseline
- [x] Create rollout tracking file (this document)
- [x] Inventory all current integration paths
- [x] Classify workflows by scope (shared/per-user/mixed/external)
- [x] Document current navigation structure
- [x] Document file inventory and LOC
- [ ] Baseline performance metrics (page load, sync freshness)
- [ ] Document Power Automate flow ownership
- [x] Create gap register
- [x] Lock architecture decisions

### Phase 1: Workspace, Roles, and Policy Foundation
- [x] Design workspace/user/membership/role schema
- [x] Design connector binding model with execution method
- [x] Define visibility scopes (private/assigned/shared)
- [x] Add route-level auth to API proxies
- [x] Harden API proxy — scoped command endpoints
- [x] Remove assumption of single global user
- [x] Add object-level access enforcement (RLS policies)
- [x] Create auth middleware (`api/_shared/auth.js`) with JWT + API key support
- [x] Create workspace management API (`api/workspaces.js`)
- [x] Create user/membership API (`api/members.js`)
- [x] Create connector accounts API (`api/connectors.js`)
- [x] Create RLS policies migration (`schema/006_rls_policies.sql`)
- [x] Add user context system to frontend (`LCC_USER`, `loadUserContext()`)
- [x] Replace hardcoded "Scott" references with dynamic user context

### Phase 2: Canonical Data and Queue Model
- [x] Design canonical entity schema (person, org, asset) — `schema/003`
- [x] Design operational schema (inbox_item, action_item, activity_event) — `schema/004`
- [x] Design external identity linking model — `schema/003` external_identities
- [x] Design unified queue views (my work, team queue, inbox triage) — `schema/007_queue_views.sql`
- [x] Define state transitions for inbox/action/sync lifecycle — `api/_shared/lifecycle.js`
- [x] Build canonical types as JS constants and validators — `api/_shared/lifecycle.js`
- [x] Create Supabase migrations for canonical tables — `schema/003-005`
- [x] Create shared ops DB helper — `api/_shared/ops-db.js`
- [x] Create entities API with external identity linking — `api/entities.js`
- [x] Create inbox API with triage/promote/assign — `api/inbox.js`
- [x] Create action items API with lifecycle transitions — `api/actions.js`
- [x] Create activity events API (append-only timeline) — `api/activities.js`
- [x] Create unified queue API (my work, team, inbox, counts) — `api/queue.js`
- [x] Create queue SQL views: v_my_work, v_team_queue, v_inbox_triage, v_sync_exceptions, v_entity_timeline, v_research_queue, v_work_counts

### Phase 3: Outlook and Salesforce Connector Rollout
- [x] Implement per-user connector binding storage — auto-resolves from connector_accounts
- [x] Per-user flagged email ingestion — `POST /api/sync?action=ingest_emails` → inbox_items
- [x] Per-user calendar event ingestion — `POST /api/sync?action=ingest_calendar` → activity_events
- [x] Per-user Salesforce activity ingestion — `POST /api/sync?action=ingest_sf_activities` → activity_events + inbox_items (open tasks)
- [x] Link source artifacts to canonical entities — external_id dedup, source_connector_id tracking
- [x] Add outbound command handling with retries — `POST /api/sync?action=outbound` with exponential backoff
- [x] Add connector health dashboard — `GET /api/sync?action=health` with per-user breakdown
- [x] Add sync job tracking with correlation IDs — every sync creates a sync_job record
- [x] Add sync error recording with retry support — `POST /api/sync?action=retry&error_id=`
- [x] Add background canonical sync trigger to frontend — `triggerCanonicalSync()` fires after initial load

### Phase 4: Shared Team Workflow Rollout
- [x] Private inbox → shared action workflow — `POST /api/workflows?action=promote_to_shared`
- [x] Salesforce task → shared entity action workflow — `POST /api/workflows?action=sf_task_to_action`
- [x] Research item → assigned follow-up workflow — `POST /api/workflows?action=research_followup`
- [x] Team reassignment and escalation — `reassign` and `escalate` workflow actions
- [x] Provenance, owner, assignee, watcher behavior — auto-watch on create/assign/escalate
- [x] Manager-level queue oversight — `GET /api/workflows?action=oversight`
- [x] Watcher/subscriber model — `schema/008_watchers_and_oversight.sql`
- [x] Escalation tracking with resolution — `escalations` table
- [x] Unassigned work view — `v_unassigned_work` + `v_manager_overview`
- [x] Bulk operations — `bulk_assign` (manager+) and `bulk_triage`

### Phase 5: UX and Interaction Redesign
- [x] Rework nav: 5 primary tabs (Today, My Work, Queue, Inbox, More) + drawer (Calendar, Entities, Research, Metrics, Sync, Business, Messages, Settings)
- [x] Queue-first triage UI — inbox with select-all, bulk triage/promote/dismiss, per-item quick actions
- [x] Assignment and quick-action controls — Start/Complete/Wait/Assign/Escalate on every queue item
- [x] Visible freshness and sync warnings — freshness dots (green/yellow/red), sync warning banners, connector health cards
- [x] Reduce tab-hopping — centralized `handlePageLoad()` router, `navTo()`/`navToFromMore()` supports all 11 pages
- [x] Operational pages module (`ops.js`) — My Work, Team Queue, Inbox Triage, Entities, Research, Metrics, Sync Health
- [x] Home page stat cards wired to canonical model via `work_counts` API
- [x] Manager oversight view — team member stats, open escalations, unassigned work alert

### Phase 6: Performance and Operational Optimization
- [ ] Split monolithic frontend into modules
- [ ] Queue-first backend endpoints
- [ ] Server-side aggregations / materialized views
- [ ] Pagination and virtualization
- [ ] Indexes on key fields
- [ ] Client/server performance instrumentation

### Phase 7: Domain Expansion Framework
- [ ] Domain registry and onboarding contract
- [ ] Standardize domain data source mapping
- [ ] Apply framework to Gov and Dia
- [ ] Template for education/daycare and urgent care

---

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-17 | AD1-AD7 locked | Based on full codebase audit and master plan analysis |
| 2026-03-17 | Phase 0 started | Foundation must be documented before building |
| 2026-03-17 | Incremental migration approach | Avoid big-bang rewrite risk; keep app functional throughout |
| 2026-03-17 | Phase 1 implemented | Auth middleware, scoped APIs, RLS policies, user context system |
| 2026-03-17 | Transitional auth mode | Auth falls back to dev user when OPS_SUPABASE_URL not set — preserves existing behavior |
| 2026-03-17 | API proxy auth added non-breaking | Existing proxies get auth checks but pass through in transitional mode |
| 2026-03-17 | Phase 2 implemented | Queue views, lifecycle state machines, all canonical CRUD APIs |
| 2026-03-17 | Shared ops-db helper created | DRY Supabase PostgREST client used by all Phase 2+ endpoints |
| 2026-03-17 | Inbox promotion workflow | Inbox items promote to action items with activity logging |
| 2026-03-17 | Activity events are append-only | No PATCH/DELETE — immutable audit trail |
| 2026-03-17 | Phase 3 implemented | Sync orchestration, per-user connectors, outbound retries, health dashboard |
| 2026-03-17 | Dual data path during transition | Existing edge fn calls continue; canonical sync runs in background |
| 2026-03-17 | Auto-resolve connectors | If no connector_account exists for user+type, one is auto-created |
| 2026-03-17 | Phase 4 implemented | Workflow engine, watchers, escalation, bulk ops, manager oversight |
| 2026-03-17 | Auto-watch pattern | Creators and assignees auto-subscribed; escalation adds both parties |
| 2026-03-17 | Phase 5 UX redesign | 5+More nav, queue-first pages, freshness indicators, quick-action controls |
| 2026-03-17 | ops.js module | 480 LOC: My Work, Team Queue, Inbox Triage, Entities, Research, Metrics, Sync Health |

---

## Known Risks

| Risk | Mitigation |
|------|-----------|
| Power Automate flows are external — can't version control their behavior | Document flows, add health monitoring, correlation IDs |
| External edge functions (`ai-copilot`) not in this repo | Document API contracts, add health endpoint integration |
| Large frontend files resist modularization | Incremental extraction, keep existing patterns working |
| Supabase service_role keys in env vars | Already server-side only; add scoped endpoints to reduce exposure |
| Enterprise SSO constraints may limit connector options | Model connectors as policy-aware from the start |
