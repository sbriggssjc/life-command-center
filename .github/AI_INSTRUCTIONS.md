# AI Assistant Instructions — Life Command Center (LCC)

This file provides critical constraints and architectural context for any AI assistant
(GitHub Copilot, ChatGPT, Claude, Cursor, Windsurf, etc.) working on this codebase.

**READ THIS BEFORE MAKING ANY CHANGES TO THE /api/ DIRECTORY.**

---

## HARD CONSTRAINT: Vercel Hobby Plan — 12 Serverless Function Limit

This project is deployed on Vercel's Hobby plan, which has a **maximum of 12 serverless
functions per deployment**. Each `.js` file directly inside `/api/` counts as one function.
Files in subdirectories starting with `_` (like `_shared/` and `_handlers/`) do NOT count.

### Current Function Inventory (12 of 12 — NO ROOM)

| # | File | Purpose |
|---|------|---------|
| 1 | actions.js | Action lifecycle + activity logging |
| 2 | admin.js | Workspace, members, feature flags (3 sub-routes) |
| 3 | apply-change.js | Audited mutation service |
| 4 | daily-briefing.js | Daily snapshot aggregation |
| 5 | data-proxy.js | Gov/Dia query proxy + write service (4 sub-routes) |
| 6 | diagnostics.js | Config, diagnostics, treasury (3 sub-routes) |
| 7 | domains.js | Domain CRUD + templates + validation |
| 8 | entity-hub.js | Contacts + Entities router (delegates to _handlers/) |
| 9 | intake.js | Outlook message intake + summary (2 sub-routes) |
| 10 | operations.js | Bridge actions + Workflow engine + Chat (18+ sub-routes) |
| 11 | queue.js | Queue (v1 & v2) + inbox CRUD |
| 12 | sync.js | Sync + connectors + RCM/LoopNet ingest (5 sub-routes) |

### RULES — Read These Carefully

1. **NEVER create a new .js file directly in /api/.** You will break the deployment.
   If you need a new endpoint, add it as a sub-route to an existing function using
   the `action` or `_route` query parameter pattern.

2. **NEVER rename or split an existing /api/*.js file** without verifying the total
   count stays at 12 or fewer.

3. **New helper/utility code goes in /api/_shared/ or /api/_handlers/.** These
   directories are ignored by Vercel's function counter.

4. **If you must add a new logical endpoint**, follow this pattern:
   - Add handler logic inside an existing file or in `_handlers/`
   - Add a rewrite rule in `vercel.json` to route the new path
   - Add a case to the relevant dispatcher's switch statement

5. **After any changes to /api/**, verify the count:
   ```bash
   ls api/*.js | wc -l  # Must be <= 12
   ```

6. **The vercel.json rewrite order matters.** Specific routes must come before the
   catch-all `"/api/(.*)"` rule at the bottom.

---

## Architectural Design Principles

### System Roles
- **LCC** = Copilot-facing orchestration shell + human review surface
- **GovernmentProject (Supabase)** = Authoritative backend for government domain rules
- **DialysisProject (Supabase)** = Authoritative backend for dialysis domain rules

### Boundary Rules
- LCC orchestrates; domain backends execute domain logic
- Copilot/AI assistants never duplicate backend matching/promotion/canonical write rules
- All canonical writes go through audited paths (`apply-change.js` or domain write services)
- Human approval required for canonical mutations (Tier 3 actions)

### Action Tier Model
- **Tier 1 (Read-only):** Autonomous — queue summaries, alerts, sync health
- **Tier 2 (Low-risk):** Lightweight confirmation — requeue, retry, task creation
- **Tier 3 (Human-in-loop):** Explicit confirmation — canonical writes, evidence promotion, merges

### Consolidation Pattern
When multiple logical endpoints share a single serverless function, they use:
- `?action=<name>` for action-based routing
- `?_route=<name>` for vercel.json rewrite routing
- `?_domain=<name>` for domain-based delegation (entity-hub pattern)
- `?_source=<name>` for data source selection (data-proxy pattern)

### Frontend Architecture
- **app.js** — Main orchestration, user context, feature flags, Copilot UI
- **gov.js** — Government domain UI and workflows
- **dialysis.js** — Dialysis domain UI and workflows
- **detail.js** — Cross-domain detail panel with workflow/write operations
- **ops.js** — Daily human review and queue operations UI

### Data Flow
```
Browser → app.js/gov.js/dialysis.js
  → /api/data-proxy (gov/dia queries, keys server-side)
  → /api/operations (bridge + workflow actions)
  → /api/entity-hub (contacts + entities)
  → /api/queue (work queue + inbox)
  → /api/sync (ingest pipelines + connectors)
```

### Microsoft 365 Integration
- Power Automate handles: email→task, calendar sync, daily briefing delivery
- LCC provides: intake endpoints, chat API, sync endpoints
- Copilot vision: entry point for Tier 1-2 actions via Teams/Outlook/Chat

---

## CRITICAL: Authentication & Environment Variables

### LCC_API_KEY — DO NOT SET IN VERCEL

The `api/_shared/auth.js` module has a **transitional authentication mode** that is
essential for the current single-user deployment. The logic works as follows:

- If `LCC_API_KEY` is **NOT set** → transitional mode: unauthenticated requests are
  allowed through and the system resolves a default owner user from the OPS database.
  This is the CURRENT PRODUCTION MODE.
- If `LCC_API_KEY` **IS set** → full auth enforcement: every request must include either
  a Supabase JWT (`Authorization: Bearer <jwt>`) or the API key (`X-LCC-Key` header).
  The frontend does NOT currently send either of these headers, so setting this variable
  **will cause universal 401 errors on every data endpoint**.

**Rules:**
1. **DO NOT add `LCC_API_KEY` to Vercel environment variables** until the frontend has
   been updated to send authentication headers on every API call.
2. **DO NOT recommend setting `LCC_API_KEY`** as a security improvement without also
   implementing the frontend auth flow (login, token storage, header injection).
3. The `.env.example` file lists `LCC_API_KEY` as blank — this is intentional.
4. When the time comes to enable auth, the full implementation requires:
   - Supabase Auth configured with user accounts
   - Frontend login flow with JWT token management
   - `X-LCC-Key` or `Authorization: Bearer` header on every `fetch()` call
   - OPS database `users` and `workspace_memberships` tables populated
5. `/api/config` and `/api/treasury` routes in `diagnostics.js` do NOT call
   `authenticate()` — they are intentionally public. All other endpoints require auth.

### Other Environment Variables
- `OPS_SUPABASE_URL` / `OPS_SUPABASE_KEY` — Required for OPS database access
- `GOV_SUPABASE_KEY` — Required for government domain queries via data-proxy
- `DIA_SUPABASE_KEY` — Required for dialysis domain queries via data-proxy
- `LCC_ENV` — Defaults to 'development'; set to 'production' in Vercel

---

## Commit Message Standards

Use descriptive round-numbered commits for feature work:
```
Round N: Brief description of changes

- file.js: Specific change description
- file2.js: Specific change description
- sw.js: Cache bump to vXXX
```

Do NOT use generic messages like "GPT changes." — these have historically caused
deployment failures because they bypass review of the function count constraint.

---

## File Reference

| Path | Purpose |
|------|---------|
| `/api/*.js` | Serverless functions (MAX 12) |
| `/api/_shared/` | Shared modules (auth, db, lifecycle, ai) |
| `/api/_handlers/` | Delegated handler modules (contacts, entities) |
| `/vercel.json` | Rewrite rules, headers, build config |
| `/.github/AI_INSTRUCTIONS.md` | This file — AI assistant guardrails |
| `/LCC_ARCHITECTURE_STRATEGY.md` | Full architecture strategy (2026-04-03) |
| `/copilot_authoritative_architecture_plan.md` | Copilot integration plan |
| `/copilot_capability_map_lcc.md` | Action registry + Wave 1-4 roadmap |
