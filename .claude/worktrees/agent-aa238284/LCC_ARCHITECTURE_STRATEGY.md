# LCC Architecture Strategy & Vercel Function Consolidation

**Date:** April 3, 2026
**Context:** Vercel Hobby plan 12-function limit repeatedly broken by commits; need sustainable path forward

---

## Current State

The LCC app has **15 serverless function files** in `/api/`, exceeding the Hobby plan's 12-function limit. The latest deployment (`339fed7`, "GPT changes") failed with: *"No more than 12 Serverless Functions can be added to a Deployment on the Hobby plan."*

The last working deployment was **Round 31** (`dcea63b`), which is still serving traffic. This is a recurring pattern — at least 8 of the last 20 deployments failed with this same error, all from "GPT changes" commits.

### Current API Functions (15 files, ~9,932 lines)

| File | Lines | What It Does | Already Consolidating? |
|------|-------|-------------|----------------------|
| actions.js | 286 | Action lifecycle + activity logging | Yes — `/api/activities` rewrites here |
| admin.js | 338 | Workspace, members, feature flags | Yes — 3 routes consolidated |
| apply-change.js | 244 | Audited mutation service | No — standalone |
| bridge.js | 549 | 6 cross-domain bridge actions + chat | Yes — `/api/chat` rewrites here |
| contacts.js | 2,323 | 12+ contact management operations | Yes — `/api/unified-contacts` rewrites here |
| daily-briefing.js | 423 | Daily snapshot aggregation | No — standalone |
| data-proxy.js | 444 | Gov/Dia query proxy + write service | Yes — 4 routes consolidated |
| diagnostics.js | 229 | Config, diagnostics, treasury | Yes — 3 routes consolidated |
| domains.js | 783 | Domain CRUD + templates + validation | No — standalone |
| entities.js | 515 | Entity CRUD + search + merge | No — standalone |
| intake-outlook-message.js | 127 | Single Outlook message event intake | No — standalone |
| intake-summary.js | 113 | Formatted intake summary for Teams | No — standalone |
| queue.js | 855 | Queue (v1 & v2) + inbox CRUD | Yes — 2 routes consolidated |
| sync.js | 2,087 | Sync + connectors + RCM/LoopNet ingest | Yes — 5 routes consolidated |
| workflows.js | 616 | 12 workflow actions (promote, escalate, etc.) | No — standalone |

---

## Part 1: Immediate Fix — Consolidate to 12 Functions

Three merges, low-to-medium risk, gets us from 15 → 12.

### Merge 1: intake-outlook-message.js + intake-summary.js → intake.js

**Risk: Low** — Both are thin wrappers (~240 lines combined), no shared state, no overlapping logic.

Route via `_route` parameter:
- `/api/intake?_route=outlook-message` (was intake-outlook-message.js)
- `/api/intake?_route=summary` (was intake-summary.js)

Update `vercel.json`:
```json
{ "source": "/api/intake-outlook-message", "destination": "/api/intake?_route=outlook-message" },
{ "source": "/api/intake-summary", "destination": "/api/intake?_route=summary" }
```

**Savings: 2 files → 1 file (net -1)**

### Merge 2: bridge.js + workflows.js → operations.js

**Risk: Medium** — Both handle cross-domain state transitions and share dependencies (auth, ops-db, lifecycle, research-loop). Combined ~1,165 lines.

Both already use action-based routing. Unified dispatcher:
```javascript
const operation = req.query.action || req.query._route;
// bridge actions: log_activity, complete_research, log_call, save_ownership, dismiss_lead, update_entity, chat
// workflow actions: promote_to_shared, sf_task_to_action, research_followup, reassign, escalate, watch, unwatch, bulk_assign, bulk_triage, oversight, unassigned, watchers
```

Update `vercel.json`:
```json
{ "source": "/api/chat", "destination": "/api/operations?_route=chat" }
```

**Savings: 2 files → 1 file (net -1)**

### Merge 3: contacts.js + entities.js → entity-hub.js

**Risk: Medium-High** — contacts.js is the largest file (2,323 lines). Combined ~2,838 lines. But contacts are fundamentally a type of entity, and both share lifecycle, entity-link, and ops-db dependencies.

Keep separate internal handler groups:
```javascript
const { action } = req.query;
// Contact actions: search, create, update, merge, classify, dedupe, ...
// Entity actions: search, create, update, merge, quality, link, ...
```

Update `vercel.json`:
```json
{ "source": "/api/unified-contacts", "destination": "/api/entity-hub?_domain=contacts" },
{ "source": "/api/entities", "destination": "/api/entity-hub?_domain=entities" }
```

**Savings: 2 files → 1 file (net -1)**

### Result: 15 → 12 functions

```
api/
  _shared/              (not counted)
  actions.js            (286 lines)
  admin.js              (338 lines)
  apply-change.js       (244 lines)
  daily-briefing.js     (423 lines)
  data-proxy.js         (444 lines)
  diagnostics.js        (229 lines)
  domains.js            (783 lines)
  entity-hub.js         (NEW: ~2,838 lines — contacts + entities)
  intake.js             (NEW: ~240 lines — outlook-message + summary)
  operations.js         (NEW: ~1,165 lines — bridge + workflows)
  queue.js              (855 lines)
  sync.js               (2,087 lines)
```

This gives exactly 12 files with zero headroom. If GPT or any other tool adds a single file, we break again.

---

## Part 2: Multi-Project Split Strategy

### Can We Split LCC Into Multiple Vercel Projects?

**Yes, but with caveats on the Hobby plan.**

Vercel supports monorepo-style deployments where multiple projects point to the same GitHub repo with different Root Directory settings. However:

- **Hobby plan limit: 3 projects per repository** (Pro allows more)
- Each project gets its own 12-function limit
- Projects can be stitched together under one domain using rewrites

### Proposed Split: 3 Vercel Projects

```
GitHub: sbriggssjc/life-command-center
├── /                   → Project 1: "lcc-hub" (main app + shared API)
├── /api-gov/           → Project 2: "lcc-gov" (government-specific serverless)
├── /api-dia/           → Project 3: "lcc-dia" (dialysis-specific serverless)
```

**Project 1: lcc-hub** (the main deployment)
- Serves index.html, app.js, all static frontend files
- Houses shared API functions: actions, admin, apply-change, diagnostics, entity-hub, intake, operations, queue
- Rewrites `/api/gov-*` and `/api/dia-*` to the other projects
- **Function count: 8**

**Project 2: lcc-gov** (government domain)
- Contains: data-proxy (gov routes), gov-specific sync, daily-briefing (if gov-focused)
- Own environment variables for GOV_SUPABASE_URL, GOV_SUPABASE_KEY
- **Function count: 2-4**

**Project 3: lcc-dia** (dialysis domain)
- Contains: data-proxy (dia routes), dia-specific sync, domains
- Own environment variables for DIA_SUPABASE_URL, DIA_SUPABASE_KEY
- **Function count: 2-4**

### How The Routing Would Work

In lcc-hub's `vercel.json`:
```json
{
  "rewrites": [
    { "source": "/api/gov-query", "destination": "https://lcc-gov.vercel.app/api/gov-query" },
    { "source": "/api/gov-write", "destination": "https://lcc-gov.vercel.app/api/gov-write" },
    { "source": "/api/dia-query", "destination": "https://lcc-dia.vercel.app/api/dia-query" },
    ...existing rewrites for shared functions...
  ]
}
```

### Assessment: Not Recommended Right Now

This adds significant operational complexity for marginal benefit:
- Three projects to manage environment variables across
- Three deployments to monitor for every push
- Cross-project rewrites add latency (~50-100ms per hop)
- Still limited to 3 projects on Hobby
- Debugging becomes harder (which project's logs?)

**This approach makes more sense if/when you upgrade to Pro**, where you'd get unlimited functions per project anyway, making the split unnecessary for the function limit — though it could still be valuable for deployment isolation (gov changes don't risk breaking dialysis).

---

## Part 3: Microsoft 365 / Copilot Offloading

### What Currently Lives in LCC That Could Move to Copilot

Your architecture plan already defines this well — LCC as the orchestration shell, Copilot as the entry point. Here's what's actionable:

### Functions That Should Stay in LCC
These require server-side secrets, database writes, or cross-domain orchestration:
- `apply-change.js` — audited mutations with loop-closure
- `data-proxy.js` — credential-proxied Supabase queries
- `sync.js` — ingest pipelines, connector management
- `queue.js` — work queue state machine
- `entity-hub.js` — canonical entity resolution

### Functions That Could Move to Copilot / Power Automate

**daily-briefing.js → Power Automate + Copilot Agent**
- Currently: LCC serverless function aggregates data, Power Automate delivers to Teams
- Better: Copilot "Ops Health Agent" queries LCC read-only endpoints directly, formats and delivers via Teams adaptive card
- This eliminates one serverless function entirely
- Aligns with your Wave 1 rollout (read-only actions)

**intake-outlook-message.js + intake-summary.js → Power Automate only**
- Currently: Outlook → Power Automate → LCC serverless → Supabase
- Better: Power Automate → Supabase Edge Function directly (you already have the Supabase infrastructure)
- Or: Power Automate → Copilot action that calls a single LCC ingest endpoint
- After consolidation these are already merged into `intake.js`, but they could be eliminated entirely

**diagnostics.js (config + diag + treasury) → Static config + Copilot**
- `config` endpoint just returns environment flags — could be a static JSON file or edge config
- `diag` is a health check — useful but could be a Supabase Edge Function
- `treasury` is a data display — could query Supabase directly from frontend

### The Copilot Agent Architecture (From Your Existing Plan)

Your `copilot_capability_map_lcc.md` defines the right tiered model. Here's what to prioritize:

**Wave 1 (Now — Offload Read-Only):**
- Move daily briefing generation to Copilot + Teams adaptive cards
- Move intake formatting to Power Automate direct-to-Supabase
- Move config/diagnostics to edge config or Supabase Edge Functions
- **Net savings: 2-3 serverless functions eliminated**

**Wave 2 (Next Quarter — Guided Review):**
- Copilot handles queue triage recommendations, LCC confirms
- Research assistant queries via Copilot, writes via LCC
- Teams approval cards for Tier 2 actions

**Wave 3 (Later — Controlled Execution):**
- Copilot agents handle intake triage end-to-end
- Review queue agent with human-in-loop confirmation
- Cross-system intelligence (morning briefing agent)

### Practical Integration Points

| Current LCC Function | Move To | How |
|----------------------|---------|-----|
| daily-briefing.js | Copilot Ops Health Agent | Agent queries LCC read endpoints, formats in Teams |
| intake-*.js | Power Automate → Supabase Edge Function | Cut out the LCC middleman |
| diagnostics.js (config) | Vercel Edge Config or static file | No serverless function needed |
| diagnostics.js (treasury) | Supabase Edge Function | Direct data query |
| bridge.js (chat route) | Copilot native | Chat is literally what Copilot does |

---

## Part 4: Recommendation — Stay on Hobby or Upgrade?

### The Math

| Approach | Functions Available | Monthly Cost | Complexity |
|----------|-------------------|-------------|------------|
| Hobby + consolidation (today's fix) | 12 (tight) | $0 | Low |
| Hobby + Copilot offloading (Wave 1) | 12 with 2-3 to spare | $0 | Medium |
| Hobby + multi-project split | 36 (3×12) | $0 | High |
| **Pro plan** | **Unlimited** | **$20/mo** | **Low** |

### My Recommendation

**Short term (this week):** Do the 3 merges from Part 1 to get back to 12 functions and unbreak the deployment. This is a 2-3 hour task.

**Medium term (next 2-4 weeks):** Execute Wave 1 Copilot offloading to move daily-briefing and intake functions out of LCC serverless. This gets you to 9-10 functions with room to grow. This also advances your stated architectural vision of Copilot-as-entry-point.

**Long term decision point:** If you're going to keep adding features at this pace — and looking at Rounds 26-31, you clearly are — **the $20/month Pro plan is worth it**. Here's why:

1. **Every "GPT changes" commit risks breaking production** because GPT doesn't know about the 12-function limit. Pro eliminates this entire class of failure.
2. **Commercial use requires Pro** — Hobby is technically personal-use only. If LCC touches any Briggs CRE business operations, you should be on Pro for compliance.
3. **Log retention goes from 1 hour to 1 day** — invaluable for debugging the kind of issues you're hitting.
4. **You stop spending engineering time on consolidation** and instead spend it on features.

The multi-project split (Part 2) is clever but adds operational overhead that isn't worth it when $20/month solves the problem cleanly. Save the multi-project architecture for when you genuinely need deployment isolation (e.g., gov changes can't break dialysis), not just to work around function limits.

---

## Guiding Principles Alignment

Your existing architecture docs establish these principles:
1. **LCC orchestrates, domain repos execute** — consolidation preserves this
2. **Copilot never duplicates backend rules** — offloading read-only functions aligns perfectly
3. **Human approval for canonical mutations** — the functions that stay in LCC are exactly the write-path functions
4. **Tiered action model** — Wave 1 offloading moves Tier 1 (read-only) to Copilot where it belongs

The current architecture is sound. The 12-function limit is a platform constraint, not an architectural problem. The right fix is either to outgrow the constraint ($20/mo) or to move read-only functions to where they architecturally belong (Copilot/Power Automate/Edge Functions).

---

## Action Items

1. **Immediate:** Merge intake files, bridge+workflows, contacts+entities → get to 12 functions
2. **This week:** Add a pre-commit check or CI step that counts `/api/*.js` files and fails if >12
3. **Next sprint:** Move daily-briefing to Copilot agent + Teams adaptive card
4. **Next sprint:** Move intake to Power Automate → Supabase Edge Function
5. **Decision:** Evaluate Pro plan ($20/mo) vs. continued consolidation effort
