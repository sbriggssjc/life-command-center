# Infrastructure Topology

> Last reviewed: 2026-05-16. Optimization branch: `claude/optimize-cloud-subscriptions-KJT9J`.
>
> **Correction note**: An earlier version of this file (committed earlier
> in this branch) claimed LCC was "fully on Vercel." That was wrong.
> The most recent code signal — the 2026-04-24 hostname audit comment
> in the `Dialysis_DB` edge function CORS configs, plus `package.json`'s
> `start:railway` script and the existence of `server.js` on a deploy
> branch — confirms LCC actually runs on Railway. The Railway dashboard
> (handsome-luck project) now hosts three services: `tranquil-delight`
> (live LCC production, Hobby plan since 2026-05-10), `life-command-center`
> (dormant rename attempt, online but unused), and `Dialysis` (added per
> the Dialysis compute-routing migration — see `DialysisProject/INFRASTRUCTURE.md`).
>
> **2026-05-16 deploy unblock**: Two stale-config errors were corrected
> this revision and are described in the *Recent fixes* section below.

## Current state (as of 2026-05-10)

| Concern | Where it runs | Cost |
|---|---|---|
| LCC Express server (consolidates 9 API handlers from `api/`) | **Railway** — `tranquil-delight` service in `handsome-luck` project, **Hobby plan** (subscribed 2026-05-10) | $5/mo + usage above $5 of monthly credits (verified pricing screenshot 2026-05-09) |
| LCC frontend (`index.html`, `office-addins/`) | Same Railway service via `express.static` | (included) |
| LCC API handlers (`actions.js`, `admin.js`, `apply-change.js`, `domains.js`, `entity-hub.js`, `intake.js`, `operations.js`, `queue.js`, `sync.js`) | Loaded as Express routes by `server.js`; not Vercel serverless functions in production | (included) |
| Edge functions (21 total across 3 projects — see `EDGE_FUNCTION_AUDIT.md`) | Supabase | Included in Pro plans |
| Operational database | Supabase `LCC Opps` (us-east-1) | Pro plan, $25/mo |
| Government domain database | Supabase `government` (us-west-2) | Pro plan, $25/mo |
| Dialysis domain database | Supabase `Dialysis_DB` (us-west-1) | Pro plan, $25/mo |
| Workflow CI (advisor checks, drift checks, cron heartbeat) | GitHub Actions | Free |
| Local dev | `vercel dev` against `api/` folder (the Vercel-style serverless functions are still the dev surface) | Free |

## Why LCC moved off Vercel

The `api/` folder has 13 `.js` files at its root, each of which Vercel
would treat as a separate serverless function. **Vercel Hobby caps
functions at 12.** When the count crossed 12, Vercel deployments started
failing.

`package.json`:

```json
"check:functions": "...if(c>12){console.error('ERROR: exceeds Vercel Hobby 12-function limit');process.exit(1)}"
```

The team's response was to wrap the same handlers in a single Express
server (`server.js` on a deploy branch). The Express server consolidates
the 13 files into 9 canonical mounts plus aliased rewrite routes,
sidestepping the 12-function cap. That server is what Railway runs.

See `LCC_VERCEL_404_AUDIT_WORKLOG.md` for the original triage notes
from that period.

## Hosting plan: near-term Railway Hobby, long-term Render Starter

This branch documents two viable hosting paths:

- **Near-term (today)**: Railway Hobby at $5/mo. Service was restored
  2026-05-10 by subscribing to Hobby — no migration work needed.
- **Long-term trigger-based migration to Render Starter** ($7/mo,
  ~70 min wall-clock) when any of these fires:
  - A second team member needs deploy/admin access (Railway Hobby's
    "single developer workspace" forces a Pro upgrade at $20/seat)
  - Railway introduces another pricing change
  - Railway usage starts exceeding $5/mo of monthly credits
  - The team wants fully predictable flat-rate billing

Full rationale: `LONG_TERM_HOSTING_STRATEGY.md`. Step-by-step migration:
`RENDER_MIGRATION_PLAN.md`.

## What was decommissioned earlier in this branch

- **Stale `Dockerfile`**: Deleted. Its `CMD ["node", "server.js"]`
  pointed at a file not present on the default branch. Railway's
  nixpacks reads `package.json`'s `start` script (`node server.js`)
  directly, so the Dockerfile was never the actual build path.
  *Correction (2026-05-16):* the earlier claim that "nothing references
  it" was incomplete — `railway.json` still had
  `"builder": "DOCKERFILE"` pointing at the deleted file, which broke
  every `tranquil-delight` deploy from 2026-05-13 through 2026-05-16.
  Fixed in the *Recent fixes* section below.
- **Misleading `.env.example` comment**: An earlier commit on this
  branch changed `LCC_BASE_URL`'s example value to a Vercel URL.
  This branch has since reverted it to point at the Railway URL
  until the Render cut-over (see `RENDER_MIGRATION_PLAN.md`).

## Recent fixes (2026-05-16)

Two service builds in `handsome-luck` were stuck on stale config and
have been unblocked in this revision:

1. **`tranquil-delight` (LCC) — DOCKERFILE builder pointed at deleted file.**
   `railway.json` had `"build": { "builder": "DOCKERFILE", "dockerfilePath": "Dockerfile" }`,
   but the Dockerfile was deleted earlier in this branch. Every push
   from 2026-05-13 through 2026-05-16 failed with
   `couldn't locate the dockerfile at path Dockerfile`, so production
   was running a 6-day-old image (PR #721) while ~10 newer PRs queued
   up unrunnable. Fix: revert to `"build": { "builder": "NIXPACKS" }`.
   nixpacks auto-detects the `node server.js` start script via
   `package.json`, which matches the doc-stated build path.

2. **`Dialysis` — `requirements.txt` referenced a sibling not in the build cache layer.**
   Root cause: `requirements.txt` was a 2-line file containing
   `-r requirements_utf8.txt` plus `-e .`. Railpack's caching layer
   copies only the manifest files (`requirements.txt`,
   `pyproject.toml`) before running `pip install`, so the `-r`
   reference resolved before `requirements_utf8.txt` existed in the
   build context. Fix: inline the deps directly into
   `requirements.txt` (now the canonical file), and convert
   `requirements_utf8.txt` to a one-line forwarder (`-r requirements.txt`)
   so the 8+ CI workflows and scripts that reference it keep working
   without a sweeping rename. The `-e .` directive was also dropped
   from the install step — it would have failed in the same caching
   layer (source tree not yet copied) and isn't required at runtime
   because `app.py` imports `from src.x ...` work from cwd.

## What this branch tracks separately

- **`LONG_TERM_HOSTING_STRATEGY.md`** — the full cost analysis and
  Option A (Render long-term) vs Option B (Railway Hobby short-term)
  framing.
- **`RENDER_MIGRATION_PLAN.md`** — trigger-based step-by-step Render
  setup, env var inventory, smoke tests, Power Automate repoint,
  Railway shutdown.
- **`EDGE_FUNCTION_AUDIT.md`** — 21-function inventory of edge
  functions across the three Supabase projects, with a gap register
  (Gaps A–F) and three obvious deletion candidates.

The Supabase consolidation itself is **not** in scope for this
branch — it's higher-risk and should be its own PR. This branch
documents the target architecture; execution is sequenced for a
later quarter (see strategy doc).

## Cross-region / cross-project notes

LCC currently reads from three Supabase projects in three regions:

- `LCC Opps` — us-east-1 (its own data, primary writes)
- `government` — us-west-2 (read-through proxy via `gov-query`)
- `Dialysis_DB` — us-west-1 (read-through proxy via `dia-query`)

Cross-region traffic adds 60–120 ms per call (us-east ↔ us-west) and
pulls Supabase egress on both sides of every cross-domain query.

After Supabase consolidation, all three become schemas in a single
project in one region — cross-domain reads collapse to single-region
in-process queries.

## Where each system actually serves traffic from (today)

- `tranquil-delight-production-633f.up.railway.app` — LCC frontend
  + API + Office Add-in manifests (Railway Hobby, $5/mo)
- `zqzrriwuavgrquhisnoa.supabase.co` (`Dialysis_DB`) — 21 edge functions,
  most of them belonging to LCC (architectural mismatch, see
  `EDGE_FUNCTION_AUDIT.md` Gap F)
- `xengecqvemvfknjvbvrq.supabase.co` (`LCC Opps`) — 4 edge functions,
  3 of which are duplicates of the `Dialysis_DB` versions
- `scknotsqkcheojiaewwh.supabase.co` (`government`) — 2 edge functions
  (`bulk-import-awards`, `sam-entity-lookup`)

## Where each system *should* serve traffic from (post-migration)

- `lcc.teambriggs.com` (or `lcc-production.onrender.com`) — LCC
  Express server on Render Starter (when migration is triggered)
- `<consolidated>.supabase.co` — single Supabase Pro project hosting
  `gov`, `dia`, `lcc` schemas plus all edge functions in one
  namespace
