# Long-Term Hosting Strategy

> Last reviewed: 2026-05-10. Optimization branch: `claude/optimize-cloud-subscriptions-KJT9J`.

## TL;DR

Move off Railway and onto Render Starter (compute) + a single consolidated
Supabase Pro project (data). Total ongoing cost ~**$32/mo, flat as you
add users and subspecialties**, until the database hits Supabase Pro
caps (8 GB / 250 GB egress) which is many years away at current data
volume.

This isn't a sales pitch for Render — it's a deliberate choice driven
by two pricing rules:

1. **Per-seat pricing is the wrong shape for this team.** Vercel Pro
   is $20/user/month. At 5 users that's $100/mo just for compute,
   and it scales linearly with growth. Render, Railway, and Fly all
   bill compute per service, not per seat — they don't care if you
   have 1 user or 50.
2. **Free tiers that pause are not viable for production.** Supabase
   Free pauses after 7 days of inactivity. Render Free sleeps after
   15 min idle. Railway gave you a finite trial that expired. The
   incremental cost to get a real, always-on plan is small ($7–$25/mo
   per service); the operational pain of unexpected outages is large.

## Current state (what you're paying for today)

| Service | Plan | Approx. monthly |
|---|---|---|
| Supabase `Dialysis_DB` | Pro | $25 |
| Supabase `LCC Opps` | Pro | $25 |
| Supabase `government` | Pro | $25 |
| Railway `tranquil-delight` (LCC) | Hobby + resources | $10–$15 |
| Vercel | Hobby (dev only) | $0 |
| GitHub | Free | $0 |
| OpenAI API | Variable | $10–$50 |
| **Total infra** | | **~$95–$135/mo** |

Three of those line items — the three Supabase projects — represent
**historical accident, not architecture**. They were created at different
times for different domains (Government, then Dialysis, then LCC) and
never consolidated.

## Cost matrix by user/subspecialty growth

This is the matrix that drives the recommendation. Per-seat options
break fast; flat-compute options stay predictable.

| End state | 1 user, 2 domains | 5 users, 3 domains | 10 users, 5 domains | 25 users, 7 domains |
|---|---|---|---|---|
| A. Vercel Pro + 1 Supabase Pro | $45 | **$125** | **$225** | **$525** |
| B. Railway + 1 Supabase Pro | $40 | $40 | $40 | $40 |
| **C. Render Starter + 1 Supabase Pro** | **$32** | **$32** | **$32** | **$32** |
| D. Fly.io + 1 Supabase Pro | $30 | $30 | $30 | $30 |
| Status quo (3 Supabase + Railway) | $95 | $95 | $95 | $95+ |

## Why Render specifically over Railway and Fly

All three have the right pricing shape (compute-priced, not per-seat).
The tiebreaker is operational headache.

| | Render Starter | Railway Hobby | Fly.io |
|---|---|---|---|
| Monthly cost | $7 flat per service | $5 base + $5–$15 resource billing | ~$3–$10 pay-per-use |
| Trial gotchas | None (paid from day 1) | **Just expired — took LCC offline** | None |
| Express deploy | Auto-detect, click setup | nixpacks, click setup | `fly.toml` + `flyctl` install |
| Sleep on idle | No (Starter); yes (Free) | No | No |
| Predictability | High (flat $7) | Low (resource bill varies) | Medium |
| Ops headache | Lowest | Medium | Highest |

**Render wins on "predictable + simple,"** which matches the team's
stated priority of avoiding free-tier and trial-tier surprises. Fly is
technically cheapest but the `flyctl` learning curve is real. Railway
is fine functionally but the trial-throttle pattern is structural —
they keep introducing new pricing tiers and forced migrations.

## Why consolidating Supabase is the bigger long-term lever

Three separate Supabase Pro projects = $75/mo. One Supabase Pro project
with schemas (`gov`, `dia`, `lcc`, plus future subspecialties) = $25/mo.
**That's a $50/mo recurring saving — larger than the entire LCC compute
bill.**

More importantly, it scales. Each new subspecialty (industrial NNN,
retail NNN, medical office, etc.) becomes a new schema in the existing
project, not a new $25/mo project. At 5 subspecialties:

- **Sprawl pattern**: 5 Pro projects = $125/mo just for databases
- **Consolidated pattern**: 1 Pro project = $25/mo until data caps hit

Supabase Pro caps: 8 GB DB, 250 GB egress/month. Combined data across
the three current projects is roughly 80 MB — you have 100x headroom
for data growth before needing the next tier (Team, $599/mo, or
self-hosted Postgres).

### Why three projects exist today (briefly)

- `government` was the first project, created for the gov-lease vertical
- `Dialysis_DB` came next for the dialysis vertical
- `LCC Opps` was created when LCC (the operational platform) was
  designed; intended as the primary LCC backend
- LCC's edge functions ended up deployed on `Dialysis_DB` (not
  `LCC Opps`) for historical reasons — see
  `EDGE_FUNCTION_AUDIT.md` Gap F

None of these reasons is architectural. A single project with three
schemas and proper RLS policies serves the same use case at a third
of the cost.

## Recommended end state

### Compute

| Workload | Where | Cost |
|---|---|---|
| LCC Express server (`server.js`, 9 handlers) | **Render Starter** | $7/mo |
| Dialysis `app.py` (event-triggered worker) | **Render Free** | $0 |
| Govlease cron (hourly trigger sweep) | GitHub Actions (already there) | $0 |
| Supabase Edge Functions (21 fns) | Supabase | included |
| Local Windows scheduled tasks | Local (no change) | $0 |

### Data

| Schema | Source today | Cost contribution |
|---|---|---|
| `gov` | Project `government` | (consolidated) |
| `dia` | Project `Dialysis_DB` | (consolidated) |
| `lcc` | Project `LCC Opps` | (consolidated) |
| `<future_subspecialty_n>` | new schemas as needed | $0 incremental |
| **Single Supabase Pro project total** | | **$25/mo** |

### External (no change)

- OpenAI API — pay-as-you-go, $10–$50/mo depending on copilot usage
- Salesforce — existing seats
- Power Automate — bundled with M365
- GitHub — free for private repos, 2,000 Actions minutes/mo

### Total ongoing cost

**~$32/mo + OpenAI variable**, flat regardless of user count or
subspecialty count, until Supabase data caps hit.

## Cost trajectory by growth scenario

| Scenario | Compute | Database | OpenAI | **Total** |
|---|---|---|---|---|
| Today (5 users, 2 domains) | $7 | $25 | $20 | **$52/mo** |
| 10 users, 3 domains | $7 | $25 | $30 | **$62/mo** |
| 25 users, 5 domains | $7 | $25 | $50 | **$82/mo** |
| 50 users, 7 domains | $14 (2 instances or upgrade) | $25–$599 (depends on DB size) | $80 | **$120–$700/mo** |

The cliff is Supabase Pro's data cap (8 GB / 250 GB egress). Beyond
that you choose between Team plan ($599/mo) or self-hosted Postgres on
a cheap VPS. That's a problem for future-you, not today-you.

OpenAI is variable but the LCC copilot is batched and uses cheap models
(`gpt-5-mini` per `package.json`). Even at heavy use it's not the
biggest line item.

## Migration sequencing

### Week 1 — restore service and exit Railway (this branch)

1. **Pay Railway Hobby for one bridge month (~$15)** so the LCC site
   is back today
2. **Set up Render Starter ($7/mo)** deploying from the `server.js`
   deploy branch (see `RENDER_MIGRATION_PLAN.md`)
3. **Smoke-test Render** against a staging URL
4. **Cut over** DNS / `LCC_BASE_URL` references to Render
5. **Cancel Railway** — saves $10–$15/mo going forward

### Months 2–3 — consolidate Supabase (separate branch and PR)

This is more risky and should not be bundled with the urgent compute
swap.

1. Stand up a new "consolidated" Supabase Pro project
2. Migrate `gov`, `dia`, `lcc` schemas via `pg_dump`/`pg_restore`
   or Supabase's branch feature
3. Update edge function project URLs in one batch (see
   `EDGE_FUNCTION_AUDIT.md` for the inventory)
4. Update `.env` references in LCC and gov-write services
5. Validate dual-running for one week (read from new, write to both)
6. Cut over fully, retire the two extra Supabase projects
7. **Saves $50/mo going forward**

### Quarter 2+ — when adding a new subspecialty

1. Add a new schema in the consolidated project
2. Add a new domain row in the LCC `domains` registry
3. Reuse existing edge functions (data-query, context-broker, etc.)
   with the new schema name
4. **Cost stays flat** at ~$32/mo + OpenAI

## What this strategy explicitly avoids

- **Per-seat pricing.** No Vercel Pro, no Railway Pro per-seat plans.
- **Pausing free tiers in production.** No Supabase Free, no Render
  Free for the user-facing app.
- **Multiple databases for one logical product.** One Postgres,
  multiple schemas, RLS for isolation.
- **Vendor lock-in to one company.** Render is Express-native; if
  Render's pricing changes, server.js redeploys to Fly or back to
  Railway in an hour.
- **Hidden compute costs.** Render Starter is $7 flat. No resource
  multipliers, no surprise bills.

## Decisions captured here

1. **Compute platform: Render** (not Railway, Fly, or Vercel)
2. **Database platform: Supabase Pro, single project**
3. **Function-count consolidation already done** (`server.js` merges
   13 Vercel-style handlers into 9 Express routes — sidesteps Vercel
   Hobby's 12-function cap, regardless of where we host)
4. **Edge functions stay on Supabase** (free with Pro; no reason to
   move them)
5. **Cron-style work stays on GitHub Actions** (free; already migrated
   for govlease)
6. **Local Windows tasks stay local** (file-system requirements)
