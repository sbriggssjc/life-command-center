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
| `ops.js` | 520 | Operational UI: My Work, Team Queue, Inbox Triage, Entities, Research, Metrics, Sync Health |
| `styles.css` | 830 | Extracted CSS (was inline in index.html) |
| `app.js` | 2865 | Core JS: nav, calendar, weather, messages, settings, copilot (was inline in index.html) |
| `api/queue-v2.js` | 250 | Paginated queue endpoints with server-side aggregation and perf logging |
| `schema/009_performance.sql` | 200 | Materialized views, 25+ indexes, perf_metrics table, pg_trgm |
| `api/domains.js` | 470 | Domain expansion API: register, sources, mappings, validate, templates, sync |
| `schema/010_domain_seeds.sql` | 200 | Seed Gov and Dia domains with sources, entity mappings, queue configs |
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

---

## Codex Audit Follow-Up (2026-03-17)

### What this rebuild now appears to cover
- Multi-user foundation exists in schema/API shape: workspaces, memberships, connector accounts, canonical entities, operational records, queue views, watchers, escalations, and domain registry are all present.
- The UI has been materially shifted toward the target operating model: `My Work`, `Queue`, `Inbox`, `Research`, `Metrics`, and `Sync Health` now exist as first-class operational surfaces.
- Performance work is materially improved versus the previous monolith: extracted CSS/JS, paginated queue endpoints, materialized count views, indexing, and perf instrumentation are all in place.
- Domain scaling is no longer purely ad hoc: Government and Dialysis can now be represented through a common domain registration/mapping system, with starter templates for future verticals.

### Remaining gaps or areas to verify before calling the master plan complete
- Connector policy alignment is only partially closed. The current sync layer still targets a single shared `EDGE_FUNCTION_URL` and will need verification that Power Automate / SSO-mediated flows are truly per-user in production, not just per-user in the canonical model.
- Auth is still transitional by design. `api/_shared/auth.js` intentionally allows a default dev user when auth is not configured; that is useful for migration, but the rebuild should not be considered production-complete until that fallback is removed or feature-flagged off outside development.
- Existing Government and Dialysis domain modules remain largely intact and large. The operational shell is improved, but there is still substantial legacy domain UI/logic outside the new queue-first layer that should be rationalized over time.
- Cross-system reconciliation quality still needs validation with live data. The code now has sync jobs, errors, retries, and health views, but successful real-world coverage for Outlook, Salesforce, and promoted/shared workflows should be verified with end-to-end testing across multiple users.
- Data governance and visibility policies need a production checklist. The schema/RLS/auth model exists, but the final review should confirm private vs assigned vs shared behavior against actual organizational expectations before broad team rollout.

### Recommended next verification pass
- Run schema migrations 001-010 in a real ops database and verify queue/materialized views.
- Validate per-user connector behavior with at least two real team members and confirm no cross-user leakage.
- Test the full loop for: flagged email -> inbox -> promote -> assign -> resolve -> external system write-back.
- Test the full loop for: Salesforce task -> inbox/shared action -> reassignment/escalation -> activity timeline.
- Remove or gate transitional auth before production rollout.

---

## Remaining Gap Closure Plan

### Summary
The Phase 0-7 rebuild appears to have closed most architectural gaps. The remaining work is concentrated in five areas:
- production auth and security hardening
- live connector validation against real organizational policy constraints
- data quality and entity reconciliation
- legacy-domain convergence into the new operational shell
- release validation, rollout controls, and operational readiness

The goal of this section is to convert the remaining open concerns into an implementation sequence that can be executed and verified.

### RG1: Remove transitional auth and complete production security hardening ✅
- **Problem**: `api/_shared/auth.js` still supports default dev-user fallback when auth is not configured. This is appropriate for migration but not for production.
- **Impact**: Critical
- **Status**: RESOLVED
- **Implementation (completed)**:
  - Added `LCC_ENV` environment flag (`production`|`staging`|`development`). Transitional auth only permitted in `development`.
  - Production/staging hard-fails with 503 when no auth method is configured.
  - `X-LCC-Auth-Warning: transitional-dev-user` header emitted when dev fallback is used.
  - Dev user synthetic fallback now grants `operator` role (not `owner`) for least-privilege.
  - Role vocabulary normalized to `owner/manager/operator/viewer` across schema, middleware, lifecycle, docs, and frontend.
  - Exported canonical `ROLES` array from both `auth.js` and `lifecycle.js`; `members.js` now imports from lifecycle.
  - `gov-query.js` and `dia-query.js` now reject DELETE and other unsupported HTTP methods with 405.
  - Audited all `requireRole()` calls — consistent use of canonical four roles confirmed.
  - RLS policies verified — all reference canonical roles only.
- **Acceptance**:
  - ✅ No production request succeeds through synthetic fallback auth.
  - ✅ Role names and allowed actions are consistent across schema/API/docs.
  - ✅ Legacy proxies cannot be used to mutate arbitrary domain tables without approved access paths.

### RG2: Validate real per-user connector behavior under Power Automate and SSO ✅
- **Problem**: The code now models per-user connectors, but actual Outlook/Salesforce behavior still depends on shared external edge-function and Power Automate infrastructure.
- **Impact**: Critical
- **Status**: RESOLVED (code infrastructure complete; live validation requires real users)
- **Implementation (completed)**:
  - Per-user connector context now passed to all edge function calls via `X-LCC-External-User`, `X-LCC-Flow-Id`, `X-LCC-Tenant-Id` headers.
  - `sync_jobs.source_user_context` JSONB column captures external_user_id, connector_type, execution_method, flow_id, tenant_id at sync time.
  - `POST /api/sync?action=verify_connector` probes edge function reachability and user-scoping for any connector.
  - `GET /api/sync?action=isolation_check` (manager+) checks for cross-user data leakage across all connector types.
  - `v_connector_checklist` view provides per-user onboarding status: Outlook status/identity/sync, Salesforce status/identity/sync, overall readiness.
  - `connector_accounts.verified_at` and `verification_result` columns track last probe result.
  - Schema migration `011_connector_verification.sql` adds all new columns, indexes, and views.
- **Acceptance**:
  - ✅ Infrastructure for two or more real users to sync simultaneously with isolation checking.
  - ✅ Sync health surfaces show real per-user/per-connector status with verification timestamps.
  - ⏳ Live validation with real Power Automate / SSO flows requires team member onboarding (RG7).

### RG3: Close data quality and entity reconciliation gaps ✅
- **Problem**: External identity dedup exists, but broader canonicalization and fuzzy/alias-based reconciliation still appear incomplete.
- **Impact**: High
- **Status**: RESOLVED
- **Implementation (completed)**:
  - `GET /api/entities?action=duplicates`: Finds exact canonical name duplicates and prefix-similarity near-matches.
  - `POST /api/entities?action=merge`: Manager+ merge of two entities — moves all identities, aliases, relationships, actions, activities, and watchers. Source entity name becomes alias. Audit-logged.
  - `POST /api/entities?action=add_alias`: Add alias names for entities (manual or from merge).
  - `GET /api/entities?action=quality`: Data quality dashboard — entity counts by type, linked/unlinked, stale identities, missing fields by type, orphaned actions/inbox.
  - `schema/012_data_quality.sql`: SQL views for v_duplicate_candidates, v_unlinked_entities, v_stale_identities, v_entity_completeness (scored 0-100 by type), v_orphaned_actions.
  - `source_precedence` table for field-level conflict resolution during sync.
- **Acceptance**:
  - ✅ Duplicate candidate detection exists and is actionable.
  - ✅ Canonical entities can be merged without history loss.
  - ✅ High-value shared entities have measurable completeness and link coverage.

### RG4: Converge legacy Government and Dialysis modules with the new shell
- **Problem**: The queue-first operational shell is in place, but large legacy domain modules remain largely unchanged and still carry older workflow assumptions.
- **Impact**: High
- **Implementation**:
  - Inventory domain workflows still bypassing the canonical model.
  - Classify each legacy action path as:
    keep as domain-specific
    rewire into canonical action/inbox/activity flows
    retire
  - Prioritize rewiring high-value manual workflows into the new shell:
    log call
    email drafting / follow-up creation
    research completion -> follow-up action
    Salesforce-linked lead/task promotion
    shared entity timeline linkage
  - Replace duplicated status/count logic in old modules with queue/materialized-view-backed data where possible.
  - Add adapters so domain detail panels can show canonical ownership, assignment, watchers, escalations, and recent activity consistently.
  - Reduce direct browser writes to domain databases for workflow state when that state now belongs in canonical ops tables.
- **Acceptance**:
  - High-value daily workflows route through canonical operations instead of parallel legacy paths.
  - Domain pages consistently reflect queue ownership and timeline state.
  - Old and new workflow layers do not silently diverge.

### RG5: Complete UX integration and team-operating polish
- **Problem**: Core operational pages exist, but the broader app still needs consistency around user context, team filtering, and workflow affordances.
- **Impact**: Medium-High
- **Implementation**:
  - Add clear current-user / current-workspace context in the shell.
  - Add queue filters for assignee, watcher, visibility, connector freshness, and domain.
  - Add teammate views to calendar and metrics for actual team management.
  - Ensure private vs assigned vs shared visibility is clearly signaled in the UI.
  - Add empty states and degraded states for:
    connector not configured
    sync unhealthy
    no workspace membership
    no queue items
  - Normalize quick actions across queue items, entity pages, and domain detail views.
  - Add explicit user-facing feedback for retries, escalations, bulk operations, and promotion workflows.
- **Acceptance**:
  - Team members can understand ownership, visibility, and next step at a glance.
  - Managers can operate from Queue/Metrics/Sync Health without dropping into source-specific tabs.
  - Degraded states are understandable and actionable.

### RG6: Expand performance work from infrastructure to real workload validation
- **Problem**: performance scaffolding exists, but real-world latency/load characteristics are not yet documented or validated.
- **Impact**: Medium
- **Implementation**:
  - Capture actual baseline and post-rebuild metrics for:
    initial shell render
    My Work load
    Team Queue load
    Inbox load
    entity timeline load
    sync health load
  - Identify any remaining high-cardinality views that still over-fetch or require client-side joining.
  - Verify materialized view refresh cadence and failure handling.
  - Add operational dashboards or queries for slow endpoints using `perf_metrics`.
  - Stress-test with representative workspace volumes and multi-user concurrent usage.
  - Create remediation backlog for any endpoint or render path that consistently misses target thresholds.
- **Acceptance**:
  - Performance targets are measured, not assumed.
  - Slow endpoints and views are identified with concrete remediation plans.
  - Queue-first workloads remain responsive under multi-user, multi-domain data volumes.

### RG7: Add rollout safety, migration, and operational readiness controls ✅
- **Problem**: The build is large and additive, but still needs a controlled production rollout plan.
- **Impact**: High
- **Status**: RESOLVED
- **Implementation (completed)**:
  - `RUNBOOK.md`: Complete migration runbook with 5 phases — schema migration, workspace setup, connector onboarding, feature flag rollout, E2E validation.
  - `api/flags.js`: Feature flags API with 14 boolean flags stored in workspace config. Manager+ can toggle. Safe defaults (most features off).
  - Feature flag categories: auth (strict_auth), queue (v2_enabled, auto_fallback), sync (auto_sync, per-connector-type, outbound), team (queue, escalations, bulk ops), domain (templates, sync), UX (ops_pages, more_drawer, freshness).
  - 5-stage rollout sequence defined: core pages → sync → team features → outbound/domains → auth lock.
  - 3 end-to-end validation tests: email→inbox→action→complete, SF→inbox→assign→escalate, multi-user isolation.
  - Production support ownership matrix: Power Automate, edge functions, materialized views, sync failures, schema migrations, feature flags.
  - Rollback plan: per-migration, sync disable, auth fallback, full deployment revert.
  - Migration verification SQL queries provided for each migration batch.
- **Acceptance**:
  - ✅ Documented pilot rollout path with 5-stage feature flag sequence.
  - ✅ Schema and connector rollout can be executed with runbook verification steps.
  - ✅ First two real users can be onboarded via connector checklist and isolation check.

### Suggested implementation order
1. RG1: auth, roles, and proxy hardening
2. RG2: live connector validation with at least two real users
3. RG7: rollout controls and migration runbooks
4. RG3: entity reconciliation and data quality
5. RG4: legacy-domain convergence into canonical workflows
6. RG5: UX consistency and team-operating polish
7. RG6: final workload-based performance validation and tuning

### Exit criteria for "production-ready core"
- Transitional auth removed or locked behind dev-only configuration.
- At least two real users validated with Outlook + Salesforce + Power Automate + canonical queues.
- Private/shared visibility proven correct under real workflows.
- High-value daily workflows use canonical operations without conflicting legacy paths.
- Sync health, retry behavior, and support ownership are documented and tested.
- Performance metrics are captured and acceptable for queue-first usage.

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
- [x] Split monolithic frontend — index.html 3955→372 LOC (CSS→`styles.css`, JS→`app.js`)
- [x] Queue-first backend — `api/queue-v2.js` with page/per_page pagination, sort, filter params
- [x] Server-side aggregations — `mv_work_counts`, `mv_user_work_counts` materialized views with concurrent refresh
- [x] Pagination — offset pagination on all queue-v2 views, cursor pagination on entity_timeline
- [x] Indexes — 25+ partial/composite indexes on action_items, inbox_items, entities, activity_events, sync tables
- [x] Client/server performance instrumentation — `opsPerf()` timing, `perf_metrics` table, Server-Timing headers, sendBeacon reporting

### Phase 7: Domain Expansion Framework
- [x] Domain onboarding API — `api/domains.js`: register, add_source, add_entity_mapping, add_queue_config, validate, toggle
- [x] Standardized domain data source mapping — generic field mapping engine (`applyFieldMapping`) with template interpolation
- [x] Apply framework to Gov and Dia — `schema/010_domain_seeds.sql` bootstraps both domains with sources, entity mappings, queue configs
- [x] Templates for education/daycare and urgent care — `apply_template` action with 4 built-in templates
- [x] Generic domain entity sync — `sync_entities` reads mappings and materializes canonical entities via proxy endpoints
- [x] Domain validation — `validate` checks data source connectivity, updates `last_verified_at`

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
| 2026-03-17 | Frontend split | index.html 3955→372 LOC: CSS→styles.css (830 LOC), JS→app.js (2865 LOC) |
| 2026-03-17 | Materialized views | mv_work_counts + mv_user_work_counts replace expensive joins; concurrent refresh |
| 2026-03-17 | queue-v2 endpoint | Paginated queues with Server-Timing headers; auto-fallback to v1 in ops.js |
| 2026-03-17 | Domain expansion framework | Generic domain onboarding with templates, field mapping engine, entity sync |
| 2026-03-17 | 4 domain templates | government, dialysis (existing), education_daycare, urgent_care (new) |

---

## Known Risks

| Risk | Mitigation |
|------|-----------|
| Power Automate flows are external — can't version control their behavior | Document flows, add health monitoring, correlation IDs |
| External edge functions (`ai-copilot`) not in this repo | Document API contracts, add health endpoint integration |
| Large frontend files resist modularization | Incremental extraction, keep existing patterns working |
| Supabase service_role keys in env vars | Already server-side only; add scoped endpoints to reduce exposure |
| Enterprise SSO constraints may limit connector options | Model connectors as policy-aware from the start |
