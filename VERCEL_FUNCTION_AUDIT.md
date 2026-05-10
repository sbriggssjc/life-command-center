# Vercel Function Audit + Consolidation Plan

> Triggered by failed Vercel deployment 37AfEsDD4 (2026-05-09): "No more
> than 12 Serverless Functions can be added to a Deployment on the
> Hobby plan." The site is currently serving from a stale (last-known-good)
> deployment; new pushes will not deploy until function count drops.
>
> Branch: `claude/vercel-function-audit-NMP4Q`. Audit non-destructive.

## TL;DR

Three problems, in order of urgency:

1. **Live deploys are blocked.** Vercel rejects any push that would result
   in >12 Serverless Functions. The repo currently has exactly 12 in `api/`
   plus 21 in `api/_handlers/` — either the underscore convention isn't
   being honored on this project, or some recent push briefly exceeded
   the cap and the build state is sticky. Either way, the next change
   to anything Vercel sees as a function will fail to deploy.
2. **Zero headroom for growth.** The team's pattern is to add new
   integration handlers as features ship (Salesforce bridges, intake
   variants, capital-markets variants). The next new top-level `api/*.js`
   file breaks deploys.
3. **`api/_handlers/` is in the wrong place.** Even if the underscore
   convention is currently working, putting helper modules under `api/`
   relies on Vercel-specific behavior. Moving them to `lib/handlers/`
   (outside `api/`) makes the design explicit and platform-independent.

Fix in two layers:

- **Immediate (~2 hours)**: move `api/_handlers/` → `lib/handlers/`,
  update imports in the 12 root files. Restores deploys, gives clean
  separation of public surface (`api/`) from internal handlers (`lib/`).
- **Long-term (~1 day)**: collapse the 12 root files into a single
  `api/[...path].js` catch-all dispatcher. Vercel sees 1 function,
  unlimited internal routes. Permanent fix to the function-count problem,
  works on any host.

## Current state

### `api/` root — 12 files (at the cap)

| File | Size | Role |
|---|---|---|
| `actions.js` | 12.8 KB | Action items (todos / queue items) CRUD |
| `admin.js` | 117 KB | Catch-all for admin routes — `/api/config`, `/api/diag`, `/api/treasury`, `/api/daily-briefing`, edge-data proxies, workspaces, members, flags, auth-config, me, connectors, npi-lookup, npi-registry-sync, llc-research-tick, geocode-tick, etc. |
| `apply-change.js` | 16.4 KB | Change-application worker (probably for pending updates) |
| `bridges.js` | 25 KB | **Newly added** — ingest bridge for SF/SP/Outlook/Calendar webhooks + cadence tick + sf-write |
| `capital-markets.js` | 61 KB | CM workbook builder; uses `assets/cm-templates/**` per `vercel.json` `functions` config |
| `domains.js` | 29.8 KB | Domain registry (gov / dia / future subspecialties) |
| `entity-hub.js` | 3.8 KB | Thin dispatcher to `_handlers/` based on `?_domain=` query |
| `intake-share.js` | 7.9 KB | Intake share-link handling |
| `intake.js` | 84 KB | Intake pipeline — outlook-message, summary, extract, queue, promote, discard, ingest_pdf, copilot-action, intake/* preset routes, feedback, accuracy |
| `operations.js` | 201 KB | **Largest file** — chat, draft, context, copilot, weekly-report, workflows, bridge |
| `queue.js` | 43 KB | Queue (action items, inbox) |
| `sync.js` | 118 KB | Sync — RCM ingest/backfill, live-ingest, loopnet-ingest, lead-health, cross-domain-match, listing-webhook |

### `api/_handlers/` — 21 files (should be invisible to Vercel)

These are internal handler modules imported by the 12 root files. Per
Vercel's documented underscore convention, files in `api/_*` folders
should **not** be counted as Serverless Functions.

| File | Size | Imported by |
|---|---|---|
| `briefing-email-handler.js` | 17.7 KB | `entity-hub.js` (probably) |
| `cap-rate-recalc-handler.js` | 8.4 KB | `entity-hub.js` |
| `contact-handler.js` | 6.8 KB | `entity-hub.js` |
| `contacts-handler.js` | 96.4 KB | `entity-hub.js` |
| `deed-parser.js` | 22.6 KB | `intake.js` |
| `entities-handler.js` | 53.2 KB | `entity-hub.js` |
| `geocode-backfill.js` | 16.6 KB | `admin.js` |
| `intake-artifact-download.js` | 5.1 KB | `intake.js` |
| `intake-extractor.js` | 50.8 KB | `intake.js` |
| `intake-feedback.js` | 12.4 KB | `intake.js` |
| `intake-finalize-om.js` | 4.5 KB | `intake.js` |
| `intake-matcher.js` | 16.6 KB | `intake.js` |
| `intake-prepare-upload.js` | 7.7 KB | `intake.js` |
| `intake-promoter.js` | 113.6 KB | `intake.js` |
| `intake-stage-om.js` | 4.1 KB | `intake.js` |
| `memory-log-turn.js` | 3.9 KB | `intake.js` |
| `om-parser.js` | 12.9 KB | `intake.js` |
| `property-handler.js` | 9.1 KB | `entity-hub.js` |
| `retrieve-entity-context.js` | 7.4 KB | `intake.js` |
| `search-handler.js` | 18.8 KB | `entity-hub.js` |
| `sidebar-pipeline.js` | **393 KB** | Capital markets / sidebar (largest single file in repo) |

### `vercel.json` — already heavily consolidated

The rewrites block has 60+ entries mapping URLs like `/api/config`,
`/api/treasury`, `/api/cms-match`, `/api/copilot/portfolio/:action`
to `?_route=` query params on the 12 root files. This is the
"consolidate via routing" pattern — the team has been doing it for
some time. `bridges.js` was the latest such consolidation (replacing
what would have been 7+ separate `salesforce-changes.js`,
`outlook-changes.js`, etc.).

### `package.json` — `check:functions` script

```json
"check:functions": "node -e \"const c=require('fs').readdirSync('api').filter(f=>f.endsWith('.js')).length; console.log(c+'/12 serverless functions'); if(c>12){console.error('ERROR: exceeds Vercel Hobby 12-function limit');process.exit(1)}\""
```

**Counts only `api/*.js`.** If Vercel is also counting `api/_handlers/*.js`,
this script is misleading. Either way, it warns at >12 but doesn't warn
at 12 (zero-headroom).

## Why the deployment is failing right now

The build failure error — "No more than 12 Serverless Functions can be
added to a Deployment on the Hobby plan" — suggests Vercel detected
more than 12. Three plausible explanations:

1. **Vercel is counting `api/_handlers/*.js`** despite the underscore
   convention. This contradicts Vercel's docs but has been intermittently
   reported in their changelog over the past year.
2. **A specific commit briefly created a 13th `.js` in `api/` root** that
   was later removed/renamed, but the build state stayed failed and
   needs a manual redeploy after the fix.
3. **The build is detecting an additional function from somewhere
   non-obvious** — e.g., a vercel.json change, a build artifact, or a
   path with non-standard casing.

The fix below is robust against all three.

## Immediate fix — move `_handlers` out of `api/` (~2 hours)

### What to do

1. Create a top-level `lib/handlers/` directory.
2. Move all 21 files from `api/_handlers/` to `lib/handlers/`.
3. Update imports in the 12 root `api/*.js` files. Pattern:
   - Before: `import handler from './_handlers/intake-extractor.js';`
   - After:  `import handler from '../lib/handlers/intake-extractor.js';`
4. Delete the now-empty `api/_handlers/` directory.
5. Also move `api/_shared/` → `lib/shared/` for the same reason.
   Update imports correspondingly.
6. Verify locally: `npm run check:functions` should still print 12/12,
   and `vercel dev` should start cleanly.
7. Push, watch the Vercel deploy succeed.

### Why this works

Files outside the `api/` directory are never counted as Serverless
Functions by Vercel. Moving the 21 helpers + ~30 shared modules to
`lib/` removes any ambiguity about Vercel's underscore-prefix handling.

### Risks

- **Many import paths to update**. The 12 root files import from
  `./_handlers/*` and `./_shared/*` extensively. Changing all of them
  is mechanical but tedious. A single sed/find-replace across the repo
  handles this.
- **`server.js` imports too** — the Express server (used on Railway)
  imports from `./api/*` which in turn imports from `./_handlers/*`.
  As long as `./api/*` keeps working, `server.js` stays functional.
- **`vercel dev` local environment** — should work unchanged; Vercel
  resolves imports from the moved location.

## Long-term fix — catch-all dispatcher (~1 day, optional)

### What to do

Replace the 12 `api/*.js` files with a single `api/[...path].js` that
dispatches based on the path:

```js
// api/[...path].js
import actionsHandler from '../lib/handlers/actions.js';
import adminHandler   from '../lib/handlers/admin.js';
// ... import all 12

const routes = {
  'actions': actionsHandler,
  'admin': adminHandler,
  // ... all 12
};

export default function handler(req, res) {
  const path = (req.query.path || []).join('/');
  const top = path.split('/')[0];
  const fn = routes[top] || routes['admin']; // fallback to admin's _route dispatcher
  return fn(req, res);
}
```

Move the 12 root files into `lib/handlers/` alongside the others.
Delete the 60+ rewrites from `vercel.json` (the dispatcher handles
routing natively).

### Why this works

Vercel sees exactly **1** function. Internal routing is unconstrained.
Function count is no longer a deployment concern.

### Risks

- **Cold-start latency increases slightly** — every `/api/*` request
  now hits the same function, which imports all 12 handlers. For LCC's
  scale (5 users, bursty BD activity), the cold-start tax is
  ~100–300ms once per ~5 min idle period. Negligible.
- **Larger function bundle** — Vercel's per-function bundle size limit
  is 50 MB unzipped. The 12 handlers + their `_shared/` dependencies
  bundle to roughly 5–10 MB today; well under cap.
- **vercel.json rewrites still useful** for nice URLs, but no longer
  required for routing.

### When to do this

Not today. The immediate fix above unblocks deploys. Schedule the
catch-all dispatcher as a separate refactor (1 day of work) when there's
bandwidth. Add it to the same backlog as the Supabase consolidation.

## Updated `check:functions` script

The current script only counts root-level files. Replace with one that
mirrors what Vercel actually counts (recursively, with underscore
exclusion):

```json
"check:functions": "node -e \"const fs=require('fs');const path=require('path');function walk(d){let n=0;for(const f of fs.readdirSync(d)){if(f.startsWith('_'))continue;const p=path.join(d,f);const s=fs.statSync(p);if(s.isDirectory())n+=walk(p);else if(f.endsWith('.js')||f.endsWith('.ts'))n++;}return n;}const c=walk('api');console.log(c+'/12 serverless functions');if(c>12){console.error('ERROR: exceeds Vercel Hobby 12-function limit');process.exit(1)}else if(c===12){console.warn('WARN: at Vercel Hobby cap; next addition will fail');}\""
```

This:
- Walks recursively through `api/` (matches Vercel's behavior)
- Skips files/folders starting with `_` (matches Vercel convention)
- Errors at >12 (existing behavior)
- **Warns at exactly 12** (new — prevents the zero-headroom situation
  we hit today)

## Updated long-term hosting strategy

The `LONG_TERM_HOSTING_STRATEGY.md` Vercel Hobby option is viable
long-term **if and only if** function count stays ≤ 12. The catch-all
dispatcher pattern makes that constraint disappear entirely.

Updated cost picture (assumes the immediate fix lands):

| End state | Today | After catch-all dispatcher |
|---|---|---|
| Vercel Hobby (LCC frontend + API) | $0 | $0 |
| Railway Hobby (redundant backup) | $5 | $0 (cancel) |
| Supabase Pro × 3 | $75 | $25 (after consolidation) |
| **Total compute + data** | **$80** | **$25** |

Vercel Pro is still **not recommended** — $20/user/month means $100/mo
at 5 users, way more than the catch-all-on-Hobby alternative.

## Action checklist

For user (today):

- [ ] Confirm Vercel build logs to identify which file pushed count past 12
      (likely `api/_handlers/` files being counted; logs will show)
- [ ] Approve the immediate fix (move `_handlers` → `lib/handlers/`)

For me (after sign-off):

- [ ] Move `api/_handlers/` → `lib/handlers/` (mechanical refactor)
- [ ] Move `api/_shared/` → `lib/shared/` (mechanical refactor)
- [ ] Update imports in `api/*.js` (sed-style find-replace)
- [ ] Update imports in `server.js` (Railway path — same import changes)
- [ ] Update `check:functions` to recursive + warn-at-12
- [ ] Push as a new branch; verify Vercel deploys clean
- [ ] Update `LONG_TERM_HOSTING_STRATEGY.md` and `INFRASTRUCTURE.md`
      to reflect the constraint and the cap-fix

Later (separate task, when bandwidth allows):

- [ ] Catch-all dispatcher (`api/[...path].js`) — permanent escape from
      the function-count cap
