# Railway Deployment Guide — Life Command Center

This document covers deploying LCC on Railway, replacing the Vercel Hobby plan
deployment that was constrained by a 12 serverless function limit.

## Why Railway?

The Vercel Hobby plan enforces a hard limit of 12 serverless functions per
deployment. LCC hit this limit and has experienced 8+ production outages from
accidental 13th-file deployments. Railway runs a single Express server with
unlimited routes — no function count constraint.

## Architecture

```
Vercel (before):  12 separate serverless functions + vercel.json rewrites
Railway (after):  1 Express server (server.js) mounting all 12 handlers as routes
```

The API handler code is unchanged. Each handler exports `async function(req, res)`,
which is the same signature Express uses. The `server.js` file replaces
`vercel.json` rewrites with Express `app.all()` route aliases.

## Environment Variables

Set these in the Railway dashboard under your service's **Variables** tab.
Copy values from your existing Vercel environment or `.env.example`.

### Required

| Variable | Description |
|----------|-------------|
| `OPS_SUPABASE_URL` | Ops Supabase project URL |
| `OPS_SUPABASE_KEY` | Ops Supabase service_role key (server-side only) |
| `GOV_SUPABASE_URL` | Government domain Supabase URL |
| `GOV_SUPABASE_KEY` | Government domain Supabase key |
| `DIA_SUPABASE_URL` | Dialysis domain Supabase URL |
| `DIA_SUPABASE_KEY` | Dialysis domain Supabase key |
| `LCC_ENV` | Set to `production` for Railway prod deployment |

### Optional

| Variable | Description |
|----------|-------------|
| `PORT` | Railway sets this automatically — do not override |
| `LCC_API_KEY` | API key for Power Automate / external integrations |
| `GOV_API_URL` | Government write service base URL |
| `EDGE_FUNCTION_URL` | AI copilot edge function URL |
| `AI_CHAT_PROVIDER` | `edge` / `openai` / `ollama` / `disabled` |
| `AI_CHAT_URL` | Optional override for chat proxy target |
| `AI_CHAT_MODEL` | AI chat model name |
| `AI_CHAT_POLICY` | `manual` / `balanced` |
| `AI_PROVIDER` | `openai` / `ollama` / `disabled` |
| `AI_MODEL` | AI model name |
| `AI_API_BASE_URL` | OpenAI-compatible or Ollama base URL |
| `AI_TIMEOUT_S` | AI request timeout in seconds |
| `OPENAI_API_KEY` | OpenAI API key |
| `PA_COMPLETE_TASK_URL` | Power Automate complete-task flow URL |
| `DIAG_SECRET` | Secret token for `/api/diag` endpoint |
| `ALLOWED_ORIGINS` | Comma-separated allowed CORS origins |
| `MORNING_BRIEFING_STRUCTURED_URL` | Morning briefing JSON URL |
| `MORNING_BRIEFING_HTML_URL` | Morning briefing HTML URL |
| `WEBEX_ACCESS_TOKEN` | WebEx OAuth token |
| `MS_GRAPH_TOKEN` | Microsoft Graph OAuth token |
| `AI_CHAT_FEATURE_PROVIDERS` | JSON map of feature-specific AI providers |
| `AI_CHAT_FEATURE_MODELS` | JSON map of feature-specific AI models |

## Deployment Steps

### 1. Connect Repository

1. Log in to [railway.app](https://railway.app)
2. Click **New Project** → **Deploy from GitHub repo**
3. Select the `life-command-center` repository
4. Railway detects `railway.json` and uses its configuration automatically

### 2. Set Environment Variables

1. Go to your service's **Variables** tab
2. Add all required variables listed above
3. Copy values from Vercel: `vercel env ls` then `vercel env pull`
4. Railway automatically redeploys when variables change

### 3. Verify Deployment

After deployment completes:

```bash
# Health check
curl https://YOUR-RAILWAY-DOMAIN.railway.app/api/diag

# Config check (public, no auth)
curl https://YOUR-RAILWAY-DOMAIN.railway.app/api/config

# Frontend
open https://YOUR-RAILWAY-DOMAIN.railway.app
```

### 4. Custom Domain

1. In Railway, go to **Settings** → **Networking** → **Custom Domain**
2. Add your domain (e.g., `lcc.yourdomain.com`)
3. Create a CNAME record pointing to Railway's provided target
4. Wait for DNS propagation and SSL provisioning

## Updating Power Automate Flows

If the deployment domain changes from the Vercel URL:

1. Open Power Automate → **My flows**
2. For each flow that calls LCC endpoints:
   - Edit the HTTP action(s)
   - Replace the old Vercel domain with the new Railway domain
   - The URL paths remain identical (e.g., `/api/intake-outlook-message`)
3. Test each flow after updating
4. Flows using `X-LCC-Key` header continue to work unchanged

## Vercel → Railway DNS Cutover

For zero-downtime migration:

1. **Before cutover**: Deploy to Railway, verify all endpoints work
2. **Set TTL low**: Reduce DNS TTL to 60s on the old A/CNAME record (24h before)
3. **Update DNS**: Point domain CNAME to Railway's target
4. **Verify**: Test all critical paths (queue, intake, sync, chat)
5. **Update integrations**: Update Power Automate flows if using Vercel domain directly
6. **Keep Vercel warm**: Leave Vercel deployment running for 48h as fallback
7. **Decommission**: After 48h with no issues, remove Vercel deployment

## Running Locally

```bash
npm install
cp .env.example .env.local
# Fill in .env.local with your values
node server.js
# Server starts on http://localhost:3000
```

## Docker (Fallback Builder)

Railway prefers Nixpacks, but if that fails it falls back to the Dockerfile:

```bash
docker build -t lcc .
docker run -p 3000:3000 --env-file .env.local lcc
```

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| 503 on all API routes | Missing `OPS_SUPABASE_URL`/`KEY` | Set required env vars |
| CORS errors in browser | `ALLOWED_ORIGINS` not set | Set to your frontend domain or omit for `*` |
| Health check failing | Server not starting | Check Railway deploy logs for import errors |
| 401 on all endpoints | `LCC_API_KEY` set but frontend doesn't send it | Remove `LCC_API_KEY` or implement frontend auth |
