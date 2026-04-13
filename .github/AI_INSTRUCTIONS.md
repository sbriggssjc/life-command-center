# AI Assistant Instructions — Life Command Center (LCC)

This file provides critical constraints and architectural context for any AI assistant
(GitHub Copilot, ChatGPT, Claude, Cursor, Windsurf, etc.) working on this codebase.

**READ THIS BEFORE MAKING ANY CHANGES TO THE /api/ DIRECTORY.**

---

## HARD CONSTRAINT: Vercel Hobby Plan — 12 Serverless Function Limit

This project is deployed on Vercel's Hobby plan, which has a **maximum of 12 serverless
functions per deployment**. Each `.js` file directly inside `/api/` counts as one function.
Files in subdirectories starting with `_` (like `_shared/` and `_handlers/`) do NOT count.

### Current Function Inventory (9 of 12 — 3 slots free)

| # | File | Purpose |
|---|------|---------|
| 1 | actions.js | Action lifecycle + activity logging |
| 2 | admin.js | Workspaces, members, flags, connectors, diagnostics, edge proxies (10+ sub-routes) |
| 3 | apply-change.js | Audited mutation service |
| 4 | domains.js | Domain CRUD + templates + validation |
| 5 | entity-hub.js | Contacts + Entities router (delegates to _handlers/) |
| 6 | intake.js | Outlook message intake + summary (2 sub-routes) |
| 7 | operations.js | Bridge actions + Workflow engine + Chat (18+ sub-routes) |
| 8 | queue.js | Queue (v1 & v2) + inbox CRUD |
| 9 | sync.js | Sync orchestration + RCM/LoopNet ingest + webhooks (10+ sub-routes) |

#### Deleted in Phase 4b (migrated to admin.js + Supabase Edge Functions):
- ~~daily-briefing.js~~ → edge function `daily-briefing` on LCC Opps, proxied via admin.js `_route=edge-brief`
- ~~data-proxy.js~~ → edge function `data-query` on LCC Opps, proxied via admin.js `_route=edge-data`
- ~~diagnostics.js~~ → absorbed into admin.js routes: `_route=config`, `_route=diag`, `_route=treasury`

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
- `?_source=<name>` for data source selection (edge-data proxy pattern)
- `?_edgeRoute=<name>` for mapping to edge function _route params (admin.js edge proxy)

### Frontend Architecture
- **app.js** — Main orchestration, user context, feature flags, Copilot UI
- **gov.js** — Government domain UI and workflows
- **dialysis.js** — Dialysis domain UI and workflows
- **detail.js** — Cross-domain detail panel with workflow/write operations
- **ops.js** — Daily human review and queue operations UI

### Data Flow
```
Browser → app.js/gov.js/dialysis.js
  → /api/admin?_route=edge-data (gov/dia queries → Supabase Edge Function data-query)
  → /api/operations (bridge + workflow actions)
  → /api/entity-hub (contacts + entities)
  → /api/queue (work queue + inbox)
  → /api/sync (ingest pipelines + connectors)
```

### Microsoft 365 Integration
- Power Automate handles: email→task, calendar sync, daily briefing delivery
- LCC provides: intake endpoints, chat API, sync endpoints
- Copilot vision: entry point for Tier 1-2 actions via Teams/Outlook/Chat

### Scheduled Jobs (Phase 5 — pg_cron)

pg_cron (v1.6.4) runs on the LCC Opps Supabase project (`xengecqvemvfknjvbvrq`).
HTTP jobs use the `lcc_cron_post()` helper function which reads `lcc_api_key` from
Supabase Vault and calls endpoints via `pg_net`.

| Job Name | Schedule (UTC) | Type | Target |
|----------|---------------|------|--------|
| `refresh-work-counts` | `*/5 * * * *` (every 5 min) | SQL | `refresh_work_counts()` — materialized view refresh |
| `nightly-preassemble` | `0 7 * * *` (2:00 AM CT) | HTTP→Vercel | `/api/preassemble` — context cache warming |
| `nightly-cross-domain-match` | `0 8 * * *` (3:00 AM CT) | HTTP→Vercel | `/api/cross-domain-match` — batch contact matching |
| `daily-briefing-snapshot` | `0 10 * * *` (5:00 AM CT) | HTTP→Edge | `/daily-briefing` — daily briefing assembly |
| `weekly-intelligence-report` | `0 11 * * 0` (6:00 AM CT Sun) | HTTP→Vercel | `/api/weekly-report` — weekly intelligence report |
| `cleanup-cron-history` | `0 4 * * *` (11:00 PM CT) | SQL | Purge `cron.job_run_details` older than 7 days |

**Key infrastructure:**
- `lcc_cron_post(endpoint, body, target)` — SECURITY DEFINER function, reads API key from `vault.decrypted_secrets`
- Vault secret `lcc_api_key` — must contain the same value as Vercel's `LCC_API_KEY` env var
- `pg_net` extension handles async HTTP from within PostgreSQL

**Monitoring:** `SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;`

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
5. `/api/config` and `/api/treasury` routes in `admin.js` do NOT call
   `authenticate()` — they are intentionally public. All other endpoints require auth.

### Other Environment Variables
- `OPS_SUPABASE_URL` / `OPS_SUPABASE_KEY` — Required for OPS database access
- `GOV_SUPABASE_KEY` — Required for government domain queries via edge-data proxy
- `DIA_SUPABASE_KEY` — Required for dialysis domain queries via edge-data proxy
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
