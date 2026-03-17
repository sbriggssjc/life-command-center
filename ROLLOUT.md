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
| `api/config.js` | 15 | Connection status endpoint |
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
- [ ] Design workspace/user/membership/role schema
- [ ] Design connector binding model with execution method
- [ ] Define visibility scopes (private/assigned/shared)
- [ ] Add route-level auth to API proxies
- [ ] Harden API proxy — scoped command endpoints
- [ ] Remove assumption of single global user
- [ ] Add object-level access enforcement

### Phase 2: Canonical Data and Queue Model
- [ ] Design canonical entity schema (person, org, asset)
- [ ] Design operational schema (inbox_item, action_item, activity_event)
- [ ] Design external identity linking model
- [ ] Design unified queue views (my work, team queue, inbox triage)
- [ ] Define state transitions for inbox/action/sync lifecycle
- [ ] Build canonical types as TypeScript/JS interfaces
- [ ] Create Supabase migrations for canonical tables

### Phase 3: Outlook and Salesforce Connector Rollout
- [ ] Implement per-user connector binding storage
- [ ] Per-user flagged email ingestion
- [ ] Per-user calendar event ingestion
- [ ] Per-user Salesforce activity ingestion
- [ ] Link source artifacts to canonical entities
- [ ] Add outbound command handling with retries
- [ ] Add connector health dashboard

### Phase 4: Shared Team Workflow Rollout
- [ ] Private inbox → shared action workflow
- [ ] Salesforce task → shared entity action workflow
- [ ] Research item → assigned follow-up workflow
- [ ] Team reassignment and escalation
- [ ] Provenance, owner, assignee, watcher behavior
- [ ] Manager-level queue oversight

### Phase 5: UX and Interaction Redesign
- [ ] Rework nav: My Work, Team Queue, Inbox, Calendar, Entities, Research, Metrics, Sync Health, Settings
- [ ] Queue-first triage UI
- [ ] Assignment and quick-action controls
- [ ] Visible freshness and sync warnings
- [ ] Reduce tab-hopping and context switching

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

---

## Known Risks

| Risk | Mitigation |
|------|-----------|
| Power Automate flows are external — can't version control their behavior | Document flows, add health monitoring, correlation IDs |
| External edge functions (`ai-copilot`) not in this repo | Document API contracts, add health endpoint integration |
| Large frontend files resist modularization | Incremental extraction, keep existing patterns working |
| Supabase service_role keys in env vars | Already server-side only; add scoped endpoints to reduce exposure |
| Enterprise SSO constraints may limit connector options | Model connectors as policy-aware from the start |
