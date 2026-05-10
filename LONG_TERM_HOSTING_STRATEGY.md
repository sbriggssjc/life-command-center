# Long-Term Hosting Strategy

> Last reviewed: 2026-05-10. Optimization branch: `claude/optimize-cloud-subscriptions-KJT9J`.
>
> **Pricing update 2026-05-09**: Railway Hobby is $5/mo minimum with $5
> of monthly usage credits included. For an LCC-sized Express server,
> actual compute is under $5/mo, so the bill is effectively $5 flat. The
> earlier draft of this doc estimated $10–$15/mo — corrected below.

## TL;DR

Two viable compute options at current scale, both pairing with the same
data-layer recommendation (single consolidated Supabase Pro project):

- **Option A (Render Starter — recommended for predictability and team growth)**: $7/mo flat + $25/mo Supabase = **~$32/mo**, fully predictable bill, no per-seat ceiling.
- **Option B (Railway Hobby — cheapest at single-admin scale)**: $5/mo + $25/mo Supabase = **~$30/mo today**, but with a "single developer workspace" admin ceiling that forces an upgrade to Railway Pro at $20/seat the moment a second person needs deploy access.

The $50/mo savings from consolidating three Supabase projects → one is
the **same in both options** and is the bigger long-term lever.

## Current decision (2026-05-10)

**Near-term**: Subscribe to Railway Hobby to restore service today
($5/mo). Keep `RENDER_MIGRATION_PLAN.md` documented and ready to
execute when any of these triggers fire:

- A second team member needs deploy/admin access (Railway Hobby's
  single-developer-workspace ceiling kicks you to Pro at $20/seat)
- Railway introduces another pricing change or trial-throttle pattern
- You want fully predictable flat-rate billing
- Real Railway usage starts exceeding $5/mo of credits regularly

**Long-term**: Render Starter remains the recommended end state because
it removes the per-seat ceiling. The $24/year premium ($7 vs $5) is the
right trade for not having a future surprise upgrade to $20/seat Pro.

## What you're paying for today

| Service | Plan | Approx. monthly |
|---|---|---|
| Supabase `Dialysis_DB` | Pro | $25 |
| Supabase `LCC Opps` | Pro | $25 |
| Supabase `government` | Pro | $25 |
| Railway `tranquil-delight` (LCC) | Hobby (verified 2026-05-09) | $5/mo + usage above $5 of credits |
| Vercel | Hobby (dev only) | $0 |
| GitHub | Free | $0 |
| OpenAI API | Variable | $10–$50 |
| Power Automate | Bundled with M365 | (existing) |
| **Total infra** | | **~$85–$130/mo** |

Three of those line items — the three Supabase projects — represent
**historical accident, not architecture**. They were created at
different times for different domains (Government, then Dialysis, then
LCC) and never consolidated.

## Cost matrix by user/subspecialty growth

This is the matrix that drives the recommendation. Per-seat options
break fast; flat-compute options stay predictable.

| End state | 1 admin, 5 users, 2 domains | 2 admins, 10 users, 3 domains | 3 admins, 25 users, 7 domains |
|---|---|---|---|
| A. Vercel Pro + 1 Supabase Pro | $45 | **$125** | **$525** |
| B. Railway Hobby + 1 Supabase Pro | **$30** | **$70** (forced to Pro: $20 + $25) | **$85** (3 seats) |
| **C. Render Starter + 1 Supabase Pro** | $32 | **$32** | **$32** |
| D. Fly.io + 1 Supabase Pro | $30 | $30 | $30 |
| Status quo (3 Supabase + Railway Hobby) | $85 | $85 | $85+ |

Key observation: at **1 admin**, Railway Hobby (Option B) is $2/mo
cheaper than Render Starter (Option C). At **2+ admins**, Railway forces
an upgrade to Pro and Option C wins by $38/mo. Vercel Pro is the worst
shape at any scale beyond a single user.

Note: "users" here means end-users hitting the LCC frontend. "Admins"
means Railway/Vercel workspace members who can deploy or change
settings. End-user count doesn't affect Railway/Render/Fly billing
— only admin count does (on Railway).

## Why Render over Railway and Fly

All three have the right pricing shape (compute-priced, not per-seat).
The tiebreaker is operational headache and team-growth ceiling.

| | Render Starter | Railway Hobby | Fly.io |
|---|---|---|---|
| Monthly cost (1 admin) | $7 flat per service | $5/mo + usage above $5 credits | ~$3–$10 pay-per-use |
| Multi-admin upgrade | None needed | **Pro at $20/seat/month** | None needed |
| Trial-throttle history | None | **Trial expired 2026-05-09 — took LCC offline 10+ hrs** | None |
| Express deploy | Auto-detect, click setup | nixpacks, click setup | `fly.toml` + `flyctl` install |
| Sleep on idle | No (Starter); yes (Free) | No | No |
| Predictability | High (flat $7) | Medium (minimum + overage) | Medium |
| Log retention | 7 days | 7 days (Hobby) | 30 days |
| Ops headache | Lowest | Low | Highest |

**Render wins on "predictable + grows-with-team,"** which matches the
team's stated priority of avoiding free-tier and trial-tier surprises.
**Railway Hobby is the right answer for today** because it's cheapest
at single-admin scale and avoids any migration work.

The practical play is: **Hobby now, Render when team grows.**

## Why consolidating Supabase is the bigger long-term lever

You're paying $75/mo for three Supabase Pro projects when one would do
the same job. One Supabase Pro project with schemas (`gov`, `dia`,
`lcc`, plus future subspecialties) = **$25/mo. Saves $50/mo recurring,
larger than the entire LCC compute bill.**

More importantly, it scales. Each new subspecialty (industrial NNN,
retail NNN, medical office, etc.) becomes a new schema in the existing
project, not a new $25/mo project. At 5 subspecialties:

- **Sprawl pattern**: 5 Pro projects = $125/mo just for databases
- **Consolidated pattern**: 1 Pro project = $25/mo until data caps hit

Supabase Pro caps: 8 GB DB, 250 GB egress/month. Combined data across
the three current projects is roughly 80 MB — you have ~100x headroom
for data growth before needing the next tier (Team plan, $599/mo, or
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

## Recommended end state (long-term target)

### Compute

| Workload | Where | Cost |
|---|---|---|
| LCC Express server (`server.js`, 9 handlers) | **Render Starter** (long-term) or **Railway Hobby** (near-term) | $7/mo or $5/mo |
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

**~$30–$32/mo + OpenAI variable**, flat regardless of end-user count or
subspecialty count, until Supabase data caps hit (many years away).

## Cost trajectory by growth scenario

| Scenario | Compute | Database | OpenAI | **Total** |
|---|---|---|---|---|
| Today (1 admin, 5 users, 2 domains) | $5 (Railway Hobby) | $25 | $20 | **$50/mo** |
| 1 admin, 10 users, 3 domains | $5 (Railway Hobby) | $25 | $30 | **$60/mo** |
| 2 admins, 10 users, 3 domains | $7 (Render Starter — migration triggered) | $25 | $30 | **$62/mo** |
| 3+ admins, 25 users, 5 domains | $7 (Render Starter) | $25 | $50 | **$82/mo** |
| 50 users, 7 domains | $14 (2 instances or upgrade) | $25–$599 (depends on DB size) | $80 | **$120–$700/mo** |

The cliff is Supabase Pro's data cap (8 GB / 250 GB egress). Beyond
that you choose between Team plan ($599/mo) or self-hosted Postgres on
a cheap VPS. That's a problem for future-you, not today-you.

OpenAI is variable but the LCC copilot is batched and uses cheap models
(`gpt-5-mini` per `package.json`). Even at heavy use it's not the
biggest line item.

## Migration sequencing

### Today — restore service via Railway Hobby ($5/mo, 5 minutes)

1. Subscribe to Railway Hobby in the dashboard (the "Trial expired" →
   Subscribe page)
2. Site is back as soon as Railway redeploys (typically <5 min)
3. No code or config changes needed; existing env vars are preserved
4. Document the date and the Hobby plan terms in your billing record

### When triggered — migrate to Render ($7/mo, ~70 min)

Execute `RENDER_MIGRATION_PLAN.md` when any of these fires:

- A second team member needs deploy/admin access
- Railway introduces another pricing change
- You want fully predictable flat billing
- Railway usage starts exceeding $5/mo of credits regularly

### Months 2–3 — consolidate Supabase (separate branch and PR)

This is more risky than the compute swap and should not be bundled
with it.

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
4. **Cost stays flat** at ~$30–$32/mo + OpenAI

## What this strategy explicitly avoids

- **Per-seat pricing.** No Vercel Pro, no Railway Pro per-seat plans.
- **Pausing free tiers in production.** No Supabase Free, no Render
  Free for the user-facing app.
- **Multiple databases for one logical product.** One Postgres,
  multiple schemas, RLS for isolation.
- **Vendor lock-in to one company.** server.js is plain Express; if
  Render's pricing changes, the same server redeploys to Fly or back
  to Railway in an hour.
- **Hidden compute costs.** Both Render Starter ($7 flat) and Railway
  Hobby ($5 + minimal overage at LCC scale) are under control.
- **Forgotten subscriptions.** This doc and the migration plan are
  committed to the repo; revisit them on each Q1 planning cycle.

## Decisions captured here

1. **Compute platform near-term: Railway Hobby** ($5/mo, click-subscribe to restore service today)
2. **Compute platform long-term: Render Starter** ($7/mo, when triggered by team-growth or pricing event)
3. **Database platform: Supabase Pro, single consolidated project** (separate migration branch, ~$50/mo savings)
4. **Function-count consolidation already done** (`server.js` merges 13 Vercel-style handlers into 9 Express routes — sidesteps Vercel Hobby's 12-function cap, regardless of where we host)
5. **Edge functions stay on Supabase** (free with Pro; no reason to move them)
6. **Cron-style work stays on GitHub Actions** (free; already migrated for govlease)
7. **Local Windows tasks stay local** (file-system requirements)
