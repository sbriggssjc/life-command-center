# Render Migration Plan — LCC Express Server

> **Status (2026-05-10): trigger-based, not urgent.** The team subscribed
> to Railway Hobby ($5/mo) to restore service. Execute this plan when
> any of these triggers fire:
>
> - A second team member needs deploy/admin access (Railway Hobby's
>   single-developer-workspace ceiling forces a Pro upgrade at $20/seat)
> - Railway introduces another pricing change or trial-throttle pattern
> - Railway usage starts exceeding $5/mo of credits regularly
> - You want fully predictable flat-rate billing
>
> See `LONG_TERM_HOSTING_STRATEGY.md` for the full Option A vs Option B
> rationale.
>
> Branch: `claude/optimize-cloud-subscriptions-KJT9J`.

## Goal

Replace the Railway-hosted LCC Express server with an equivalent Render
Starter deployment. Trades $5/mo Railway Hobby for $7/mo Render Starter
(+$2/mo) in exchange for: predictable flat billing, no per-seat
admin ceiling, and exit from a platform with a recent trial-throttle
pattern.

## Pre-flight: what we know about the current Railway deploy

From `package.json`, `server.js`, and the Railway dashboard (verified
2026-05-09):

- **Entry point**: `node server.js` (Express, ESM, port from `PORT` env
  with default 3000)
- **Start script**: `npm start` runs `node server.js`. Railway's
  nixpacks auto-detects this from `package.json`. (No `Dockerfile`
  needed; the original one was deleted earlier in this branch.)
- **Health check endpoints**: `GET /health` and `GET /api/health` —
  both return `{status: 'ok', ts: <epoch_ms>}` with no auth or DB
  dependency. Render's health checks should target one of these.
- **Static files**: `index.html` + `office-addins/` are served
  directly from the repo root via `express.static(__dirname)`.
- **Office Add-in token replacement**: `server.js` substitutes
  `RAILWAY_URL` placeholders in `manifest.xml` and `taskpane.html`
  using `process.env.LCC_BASE_URL`. The placeholder name is misleading
  but the substitution logic is host-agnostic — set `LCC_BASE_URL` to
  the Render URL and the same code works without modification.
- **CORS**: `process.env.ALLOWED_ORIGINS` (comma-separated) or `*`
  default. Same as Railway.
- **Node version**: `>=20.0.0` (from `engines` in `package.json`).
- **Deploy branch**: `server.js` lives on a non-default branch (the
  default branch only has `api/` for Vercel-style serverless
  development). Confirm in the Railway dashboard which branch the
  current production deployment tracks; that's the branch to point
  Render at.

## Step-by-step migration

### 1. Inventory environment variables from Railway (5 min)

In the Railway dashboard → `tranquil-delight` → Variables tab, copy
every variable to a secure scratchpad. Expected groups, based on
`server.js` and `.env.example`:

- **Supabase credentials** (3 sets): `OPS_SUPABASE_URL`,
  `OPS_SUPABASE_KEY`, `GOV_SUPABASE_URL`, `GOV_SUPABASE_KEY`,
  `DIA_SUPABASE_URL`, `DIA_SUPABASE_KEY`. Use service-role keys
  (server-side).
- **Edge function URL**: `EDGE_FUNCTION_URL` — currently points at
  the `Dialysis_DB` project's `ai-copilot` function (see
  `EDGE_FUNCTION_AUDIT.md`).
- **AI configuration**: `AI_CHAT_PROVIDER`, `AI_CHAT_URL`,
  `AI_CHAT_MODEL`, `AI_CHAT_POLICY`, `AI_PROVIDER`, `AI_MODEL`,
  `AI_API_BASE_URL`, `AI_TIMEOUT_S`, `OPENAI_API_KEY`.
- **Power Automate**: `PA_COMPLETE_TASK_URL`,
  `PA_NEW_LEAD_WEBHOOK_URL`.
- **Auth**: `LCC_API_KEY`, `LCC_ENV` (`production`).
- **External APIs**: `GOV_API_URL`, `WEBEX_ACCESS_TOKEN`,
  `MS_GRAPH_TOKEN`.
- **Diagnostics + alerts**: `DIAG_SECRET`, `TEAMS_INTAKE_WEBHOOK_URL`,
  `TEAMS_COLD_ALERTS_ENABLED`.
- **Intake**: `INTAKE_EXTRACTION_ENABLED`, `INTERNAL_EMAIL_DOMAINS`.
- **Briefing**: `MORNING_BRIEFING_STRUCTURED_URL`,
  `MORNING_BRIEFING_HTML_URL`.
- **Self-reference**: `LCC_BASE_URL` — will need to be updated to
  the Render URL **after** the new service has a stable URL
  (step 5).
- **CORS**: `ALLOWED_ORIGINS` (CSV).

Do not copy `RAILWAY_*`-prefixed variables — those are Railway-specific
(`RAILWAY_PUBLIC_DOMAIN`, `RAILWAY_PRIVATE_DOMAIN`, etc.) and Render
sets its own equivalents automatically.

### 2. Create the Render service (10 min)

1. Sign up / sign in at https://render.com
2. **New** → **Web Service** → connect GitHub → select
   `sbriggssjc/life-command-center`
3. Configure:
   - **Name**: `lcc-production` (or any name; URL will be
     `lcc-production.onrender.com`)
   - **Region**: Oregon (us-west-2) — same region as the Supabase
     `Dialysis_DB` and `government` projects, minimizes cross-region
     latency
   - **Branch**: the same branch Railway is currently deploying from
     (the one containing `server.js`). Confirm in Railway's
     dashboard if uncertain.
   - **Runtime**: Node
   - **Build command**: `npm install`
   - **Start command**: `npm start` (resolves to `node server.js`)
   - **Plan**: **Starter** ($7/mo) — not Free; Starter prevents
     idle-sleep
   - **Health check path**: `/health`
4. **Advanced** → **Auto-deploy on push**: ON
5. **Environment** tab → paste every variable from step 1
   - Set `LCC_BASE_URL` to `https://lcc-production.onrender.com` (or
     whatever Render assigned; Render shows this on the service page
     immediately after creation)
   - Set `LCC_ENV=production`
6. **Create Web Service**. Render builds and deploys; expect 2–3 min
   for the first deploy.

### 3. Smoke-test the Render deployment (10 min)

Until DNS / external integrations are repointed, the Render service
has no inbound traffic. Use this window to validate.

Run these against `https://lcc-production.onrender.com`:

```
# Health (no auth, no DB)
curl https://lcc-production.onrender.com/health
# Expected: {"status":"ok","ts":<epoch>}

# Health behind /api (same handler, different path)
curl https://lcc-production.onrender.com/api/health

# Static index.html
curl -I https://lcc-production.onrender.com/
# Expected: HTTP/2 200, content-type: text/html

# An API endpoint that requires the API key
curl -H "X-LCC-Key: <LCC_API_KEY value>" \
  https://lcc-production.onrender.com/api/property?id=test
# Expected: 200 with JSON, or 404 with JSON — not 5xx

# Office Add-in manifest serving (token replacement test)
curl https://lcc-production.onrender.com/office-addins/outlook/manifest.xml \
  | grep -i 'lcc-production.onrender.com'
# Expected: lcc-production.onrender.com appears (RAILWAY_URL was replaced)
```

If any test 5xxs, check Render's **Logs** tab for the stack trace.
Most likely cause is a missing env var.

### 4. Update Power Automate flows (15 min)

PA flows that POST to LCC use the Railway URL. They need to be
repointed.

1. In Power Automate → **My flows**, search for any flow whose
   HTTP action URL contains `tranquil-delight` or
   `up.railway.app`.
2. For each, change the host to `lcc-production.onrender.com`
   (or the Render-assigned URL).
3. Re-save and run a manual test.

Known PA targets (from `server.js` route comments):

- `/api/intake/prepare-upload` — OM signed-upload flow
- `/api/intake/finalize-om` — OM finalize flow
- `/api/intake-outlook-message` — flagged-email intake
- `/api/salesforce-changes` — SF webhook ingestion
- `/api/listing-webhook` — RCM/LoopNet listing webhook

### 5. Update self-references and supabase edge function CORS (15 min)

1. **Render dashboard** → service → **Environment** → set
   `LCC_BASE_URL=https://lcc-production.onrender.com` (or your final
   Render-assigned URL). Save → Render auto-redeploys.
2. **Supabase edge functions** — the CORS allowlist in shared
   `_shared/cors.ts` files lists Railway URLs as fallbacks. Add the
   Render URL to `ALLOWED_ORIGINS`. Affected functions (per
   `EDGE_FUNCTION_AUDIT.md`): `data-query`, `npi-lookup`,
   `npi-registry-sync`, `availability-checker`. Redeploy each.
3. **`.env.example`** in the repo: update the `LCC_BASE_URL` example
   value once the cut-over is complete (this branch reverted it to
   the Railway URL pending cut-over).

### 6. Custom domain (optional, 30 min)

If the team prefers a non-`onrender.com` URL:

1. Render dashboard → service → **Settings** → **Custom Domains**
2. Add a domain (e.g., `lcc.teambriggs.com`)
3. Render shows a CNAME target. Set the CNAME in the DNS provider
4. Wait for DNS propagation (Render auto-provisions Lets Encrypt TLS)
5. Update `LCC_BASE_URL` and PA flow URLs to the new domain

### 7. Cancel Railway (5 min)

Only after 24–48 hours of stable Render operation:

1. Railway dashboard → `handsome-luck` project → `tranquil-delight`
   service → **Settings** → **Delete service**. Confirm.
2. Same steps for the dormant `life-command-center` service.
3. If the `handsome-luck` project is now empty, delete the project.
4. Stop the Railway subscription (account-level billing settings).
   This stops the $5/mo Hobby charge as well.

## Rollback plan

If Render breaks something not caught in the smoke tests:

1. **Don't delete Railway yet.** Step 7 is the last step for a reason.
2. The Railway service is still running (Hobby plan, $5/mo).
3. Switch PA flows back to the Railway URL.
4. Investigate the Render-specific failure with `LCC_ENV=development`
   on a Render preview environment, fix, retry cut-over.

## Smoke-test ownership

- **Frontend rendering**: open `https://lcc-production.onrender.com/`
  in a browser. Verify the LCC dashboard loads, the Daily Briefing
  widget populates, the inbox triage page loads.
- **Auth**: sign in (or use the transitional first-owner fallback
  from `_shared/auth.ts`). Verify the workspace banner shows the
  expected name.
- **Cross-domain reads**: open the Government and Dialysis tabs.
  Verify property lists load (these go through the `gov-query` /
  `dia-query` proxies to the respective Supabase projects).
- **AI copilot**: send a test message. Verify a response within 30s.
- **Office Add-ins**: in Outlook, the LCC Flagged-Email Intake
  add-in should still work after PA flows are repointed (step 4).

## Estimated total wall-clock time

~70 minutes one-shot, plus 24–48 hours of dual-running before Railway
shutdown (step 7). During dual-running you pay both providers
(~$5 + $7 = $12 for a partial month).

## Cost impact

- Before (Railway Hobby): $5/mo + minimal usage overage
- After (Render Starter): $7/mo flat
- Net: +$2/mo on compute, but:
  - No more per-admin upgrade cliff at $20/seat
  - No more usage-overage uncertainty
  - Off the platform with the recent trial-throttle pattern

The Supabase consolidation (separate plan, see
`LONG_TERM_HOSTING_STRATEGY.md`) is the bigger savings lever ($50/mo)
and should be planned independently.
