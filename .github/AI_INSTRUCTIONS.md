# AI Assistant Instructions — Life Command Center (LCC)

This file provides critical constraints and architectural context for any AI assistant
(GitHub Copilot, ChatGPT, Claude, Cursor, Windsurf, etc.) working on this codebase.

**READ THIS BEFORE MAKING ANY CHANGES TO THE /api/ DIRECTORY.**

---

## ROUTING: server.js is the single source of truth (Vercel retired 2026-07-20)

Production is the **Railway Express server** (`server.js`). Vercel was retired
2026-07-20 after 40+ consecutive failed deploys on the Hobby 12-function cap;
`vercel.json` is **deleted**. **There is NO serverless-function cap any more.**
`server.js` is the sole `/api/*` routing table — add a route by mounting it there.

### RULES — Read These Carefully

1. **Add a new endpoint as a `?_route=` (or `?action=`) sub-route of an existing
   handler**, not a brand-new top-level pipeline. This is good structure (one
   handler owns a family of related routes), independent of any platform cap.

2. **Mount every new route in `server.js`** — add the `app.all('/api/<name>', …)`
   alias that sets `req.query._route = '<name>'` and delegates to the handler. That
   mount IS the route; there is no vercel.json to update. (`test/operations-subroutes.test.mjs`
   guards that every server.js-mounted `_route` has a matching dispatch.)

3. **New helper/utility code goes in /api/_shared/ or /api/_handlers/.**

4. **After a deploy, run the deploy gate:** `npm run verify:deploy` (compares live
   `/version` to the merge SHA and probes that critical routes return JSON, not the
   SPA HTML). A stale/unshipped deploy fails here — the real 2026-07-20 root cause
   was four unshipped merges misdiagnosed as dispatch regressions.

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
When multiple logical endpoints share a single handler, they use:
- `?action=<name>` for action-based routing
- `?_route=<name>` for server.js sub-route alias routing
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

### LCC_API_KEY — Ready for Production (Phase 6b)

The `api/_shared/auth.js` module has a **transitional authentication mode** with
three paths (tried in order): Supabase JWT → API Key → Dev Fallback.

- If `LCC_API_KEY` is **NOT set** → transitional mode: unauthenticated requests are
  allowed through and the system resolves a default owner user from the OPS database.
- If `LCC_API_KEY` **IS set** → the frontend `auth.js` global fetch interceptor
  automatically injects `X-LCC-Key` on all `/api/` requests (loaded from auth-config).
  Power Automate also sends `X-LCC-Key`. Both paths are authenticated.
- `LCC_ENV=production` or `staging` → unauthenticated requests return 401.
  `LCC_ENV=development` (default) → unauthenticated requests fall through to dev user.

**To enable production auth:**
1. Set `LCC_API_KEY=<your-key>` in Vercel env vars
2. Set `LCC_ENV=production` in Vercel env vars
3. The frontend will auto-inject the key on every API call

**Rules:**
1. `/api/config`, `/api/treasury`, and `/api/admin?_route=auth-config` do NOT call
   `authenticate()` — they are intentionally public.
2. For **multi-user production** with individual accounts, switch to Supabase JWT:
   - Set `OPS_SUPABASE_ANON_KEY` in Vercel (for client-side Supabase Auth)
   - Create user accounts in Supabase Auth
   - Remove `lcc_api_key` from auth-config response (switch to JWT-only)
3. The `.env.example` lists `LCC_API_KEY` as blank — this is intentional for dev.

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
| `/api/*.js` | API handlers (no function cap — Vercel retired 2026-07-20) |
| `/api/_shared/` | Shared modules (auth, db, lifecycle, ai) |
| `/api/_handlers/` | Delegated handler modules (contacts, entities) |
| `/server.js` | Railway Express entry — the `/api/*` routing table + headers |
| `/.github/AI_INSTRUCTIONS.md` | This file — AI assistant guardrails |
| `/LCC_ARCHITECTURE_STRATEGY.md` | Full architecture strategy (2026-04-03) |
| `/copilot_authoritative_architecture_plan.md` | Copilot integration plan |
| `/copilot_capability_map_lcc.md` | Action registry + Wave 1-4 roadmap |
