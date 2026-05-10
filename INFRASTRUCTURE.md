# Infrastructure Topology

> Last reviewed: 2026-05-10. Optimization branch: `claude/optimize-cloud-subscriptions-KJT9J`.

## Current state

| Concern | Where it runs | Cost |
|---|---|---|
| Frontend + serverless API (`api/admin.js`, `api/intake.js`, `api/operations.js`, `api/sync.js`, `api/queue.js`, `api/entity-hub.js`, `api/capital-markets.js`, ...) | Vercel | Free (Hobby) |
| Edge functions (`context-broker`, `daily-briefing`, `data-query`, `availability-checker`) | Supabase project `LCC Opps` | Shared in `TeamBriggs Org` Pro plan |
| Operational database | Supabase `LCC Opps` (us-east-1) | Pro plan |
| Cross-domain reads/writes | Vercel functions call Supabase `government` and `Dialysis_DB` directly via the `gov-query` / `dia-query` proxies | Free |
| Workflow CI (advisor checks, drift checks, cron heartbeat) | GitHub Actions | Free |

## What was decommissioned

The repo previously had a `Dockerfile` (`CMD ["node", "server.js"]`) and a
`LCC_BASE_URL=https://lcc-production.up.railway.app` reference suggesting a
Railway-hosted Node service. We searched the codebase: **no `server.js` or
any `app.listen` / `createServer` / `express()` call exists anywhere**. The
Dockerfile entrypoint pointed at a file that wasn't in the tree — the
container was non-functional and could not have served traffic.

This branch:

- Deletes the unused `Dockerfile`.
- Updates `.env.example` so `LCC_BASE_URL` points at the Vercel deployment
  URL instead of the dead Railway URL.

If a Railway project named `lcc-production` still exists in the Railway
dashboard, **delete it** — it is not deployable from this repo and is
consuming whatever resources it was last given.

### Steps to fully retire the Railway service

1. Open the Railway dashboard, find the `lcc-production` project.
2. Confirm the deployment is unhealthy / failing build (`server.js not found`).
3. Delete the service and the project. Billing stops immediately.
4. Search Power Automate flows / Teams configs for `lcc-production.up.railway.app`
   and re-point at the Vercel URL.

## Cross-region / cross-project note

Today this app reads from three Supabase projects in three regions:

- `LCC Opps` — us-east-1 (its own data, primary writes)
- `government` — us-west-2 (read-through proxy via `gov-query`)
- `Dialysis_DB` — us-west-1 (read-through proxy via `dia-query`)

That cross-region traffic adds 60–120 ms per call (us-east ↔ us-west) and
pulls Supabase egress on both sides of every cross-domain query. The
Supabase consolidation plan in the parallel `INFRASTRUCTURE.md` files in
the `government-lease` and `Dialysis` repos addresses this.
