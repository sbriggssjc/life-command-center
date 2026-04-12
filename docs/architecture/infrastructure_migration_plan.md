# LCC Infrastructure Migration Plan

> **Owner:** Team Briggs / NorthMarq
> **Date:** 2026-04-12
> **Status:** Draft
> **Dependencies:** `copilot_operating_system_blueprint.md`, `context_broker_api_spec.md`, `context_packet_schema.md`, `signal_table_schema.sql`

---

## Related Documents
- [Copilot Operating System Blueprint](./copilot_operating_system_blueprint.md)
- [Context Broker API Spec](./context_broker_api_spec.md)
- [Context Packet Schema](./context_packet_schema.md)
- [Signal Table Schema](./signal_table_schema.sql)
- [Copilot Wave 1 Build Plan](./copilot_wave1_build_plan.md)

---

## 1. Problem Statement

The Life Command Center API layer is deployed on Vercel's Hobby plan, which enforces a hard limit of **12 serverless functions** per deployment. LCC is at 12 of 12 — no capacity remains. This constraint has produced architectural distortions that contradict the blueprint's own design principles:

**Mega-functions.** `operations.js` is 166KB with 18+ sub-routes handling bridge actions, workflows, template drafts, Copilot integration, chat, and the Context Broker. `sync.js` is 123KB. These are monolithic application servers disguised as serverless functions.

**Query-param routing hacks.** Every new endpoint requires a `vercel.json` rewrite and a `?_route=` or `?action=` dispatch, creating fragile routing chains.

**Data round-tripping.** `data-proxy.js` proxies Supabase queries through Vercel and back to Supabase — an unnecessary network hop.

**Role confusion.** The blueprint says LCC should be a "Copilot-facing orchestration shell + human review surface." Instead, it has become the entire API backend.

**The Context Broker — the blueprint's most important unbuilt component — had to be crammed into `operations.js` sub-routes** rather than deployed as a proper service.

---

## 2. Governing Principle

From the Copilot Operating System Blueprint, Section 1:

> "Every build request, workflow, integration, automation, and AI feature must answer this question: **How does this get us closer to building a more intelligent, connected, productive, listing-driven brokerage operating system?**"

This migration moves each component to the runtime where it naturally belongs, so the architecture matches the blueprint rather than fighting a hosting constraint.

---

## 3. Current State Audit

### 3.1 Function Inventory

| # | Function | Size | Sub-routes | What It Does |
|---|----------|------|------------|-------------|
| 1 | operations.js | 166 KB | 18+ | Bridge actions, workflows, template drafts, Copilot spec/manifest, chat, Context Broker |
| 2 | sync.js | 123 KB | 5 | Email/calendar/SF sync, connectors, RCM ingest, LoopNet ingest, cross-domain match, listing webhook |
| 3 | daily-briefing.js | 59 KB | 1 | Aggregates queue items, tasks, alerts, deal milestones from Gov + Dia + OPS into briefing snapshot |
| 4 | queue.js | 38 KB | 3 | Queue v1, Queue v2 (paginated), Inbox CRUD with lifecycle transitions |
| 5 | domains.js | 31 KB | 10 | Domain registration, data sources, entity mappings, queue configs, templates |
| 6 | intake.js | 28 KB | 2 | Outlook message intake (from Power Automate), intake summary for Teams |
| 7 | data-proxy.js | 18 KB | 4 | Gov/Dia read proxy, Gov write service, Gov evidence endpoints |
| 8 | admin.js | 16 KB | 5 | Workspaces, members, feature flags, auth config, /me |
| 9 | actions.js | 13 KB | 2 | Action item CRUD + lifecycle transitions + activity logging |
| 10 | apply-change.js | 10 KB | 1 | Audited mutation service for Gov/Dia domain writes |
| 11 | diagnostics.js | 9 KB | 3 | Config status, diagnostics, treasury/fee tracking |
| 12 | entity-hub.js | 3.5 KB | 6 | Thin router to _handlers/ (contacts, entities, property, contact, search, briefing-email) |

**Total: 515 KB of application code in 12 files at a hard limit.**

### 3.2 Existing Infrastructure

| Service | Plan | Already Using |
|---------|------|--------------|
| Vercel | Hobby (free) | Frontend + all 12 API functions |
| Supabase OPS | Pro | OPS database, auth |
| Supabase Gov | Pro | Government domain database |
| Supabase Dia | Pro | Dialysis domain database |
| Supabase Edge Functions | Included in Pro | `ai-copilot` function already deployed on OPS instance |
| Power Automate | Microsoft 365 | Outlook → LCC webhooks, Teams notifications, scheduled sync triggers |

**Key fact:** Supabase Edge Functions are already available and proven. The `ai-copilot` Edge Function is live at `https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/ai-copilot` and is called by `sync.js`, `_shared/ai.js`, and the frontend directly.

---

## 4. Target Architecture

### 4.1 Layer Map

```
┌─────────────────────────────────────────────────────┐
│  Frontend (Vercel)                                   │
│  app.js │ gov.js │ dialysis.js │ ops.js │ detail.js │
└────────────────────────┬────────────────────────────┘
                         │
         ┌───────────────┼──────────────────┐
         │               │                  │
         ▼               ▼                  ▼
┌─────────────┐  ┌──────────────┐  ┌──────────────────┐
│ Vercel API   │  │ Supabase     │  │ Power Automate   │
│ (6-8 fns)    │  │ Edge Fns     │  │ (event mesh)     │
│              │  │              │  │                  │
│ • queue      │  │ • context-   │  │ • Outlook →      │
│ • actions    │  │   broker     │  │   intake-receiver│
│ • entity-hub │  │ • copilot-   │  │ • RCM → lead-   │
│ • operations │  │   chat       │  │   ingest         │
│   (slim)     │  │ • template-  │  │ • LoopNet →      │
│ • admin      │  │   service    │  │   lead-ingest    │
│ • apply-     │  │ • daily-     │  │ • Listing →      │
│   change     │  │   briefing   │  │   lead-ingest    │
│ • domains    │  │ • intake-    │  │ • Scheduled sync │
│ • diagnostics│  │   receiver   │  │ • Daily briefing │
│              │  │ • lead-ingest│  │   delivery       │
│              │  │ • data-query │  │                  │
│              │  │ • sync-orch. │  │                  │
└──────┬───────┘  └──────┬───────┘  └────────┬─────────┘
       │                 │                   │
       └─────────────────┼───────────────────┘
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
   ┌──────────┐   ┌──────────┐   ┌──────────┐
   │  OPS DB  │   │  Gov DB  │   │  Dia DB  │
   │(Supabase)│   │(Supabase)│   │(Supabase)│
   │          │   │          │   │          │
   │ pg_cron: │   └──────────┘   └──────────┘
   │ • engage │
   │ • calibr │
   │ • templ  │
   │ • pipeline│
   │ • outcome│
   │ • x-match│
   └──────────┘
```

### 4.2 Routing After Migration

**Frontend → Vercel:** Browser-initiated CRUD (queue views, action lifecycle, entity search, admin, workflow mutations). Same-origin, no CORS.

**Frontend → Supabase Edge:** Data queries (replaces data-proxy), chat, daily briefing, Context Broker packets. CORS configured on Supabase Edge.

**Power Automate → Supabase Edge:** All webhook receivers (intake, lead ingest, sync). Direct write to Supabase — no Vercel hop.

**pg_cron → Supabase Edge:** Nightly pre-assembly calls the `daily-briefing` Edge Function. All other nightly jobs are pure SQL functions.

---

## 5. Decomposition Plan by Current Function

### 5.1 operations.js (166 KB → ~30 KB)

This is the largest extraction. The file currently contains five unrelated subsystems:

| Subsystem | Lines (approx) | Destination |
|-----------|----------------|-------------|
| Context Broker (handleContextRoute, assembleSinglePacket, assemblePropertyPacket, assembleContactPacket, assembleDailyBriefingPacket, assembleGenericPacket, handlePreassembleNightly, handleWeeklyReport, handleInvalidate) | ~800 lines | **Supabase Edge: `context-broker`** |
| Chat / Copilot (handleChatRoute, copilot action dispatch, follow-up signals, OpenAPI spec, plugin manifest) | ~400 lines | **Supabase Edge: `copilot-chat`** |
| Template Drafts (handleDraftRoute, draft generation, batch, send recording, listing-BD pipeline) | ~300 lines | **Supabase Edge: `template-service`** |
| Bridge Actions (log_activity, complete_research, log_call, save_ownership, dismiss_lead, update_entity) | ~200 lines | **Stays in Vercel** |
| Workflow Actions (promote_to_shared, sf_task_to_action, reassign, escalate, watch, bulk_assign, bulk_triage, oversight, unassigned) | ~200 lines | **Stays in Vercel** |

**What stays:** Bridge + workflow actions (~30KB). These are frontend-triggered mutations that use LCC's auth and lifecycle patterns.

**Code extraction approach:** The Context Broker code (lines ~2811–3650 of current operations.js) is already cleanly isolated behind `handleContextRoute()` and `assembleSinglePacket()`. It imports only `authenticate`, `opsQuery`, `pgFilterVal`, and `writeSignal` — all of which need equivalent Edge Function versions. The chat and template subsystems are similarly self-contained.

### 5.2 sync.js (123 KB → retired from Vercel)

| Subsystem | Destination |
|-----------|-------------|
| RCM ingest (`handleRcmIngest`) | **Supabase Edge: `lead-ingest`** |
| LoopNet ingest (`handleLoopnetIngest`) | **Supabase Edge: `lead-ingest`** |
| Listing webhook (`handleListingWebhook`) | **Supabase Edge: `lead-ingest`** |
| Cross-domain match (`handleCrossDomainMatch`) | **pg_cron SQL function** |
| Email/calendar/SF sync (`handleSyncAction`) | **Supabase Edge: `sync-orchestrator`** |
| Connector management (CRUD) | **Stays in Vercel** (move to admin.js or operations.js) |
| Lead health check | **Supabase Edge: `lead-ingest`** (as /health sub-route) |
| Live ingest | **Supabase Edge: `lead-ingest`** |

**Connector CRUD** (~100 lines) can fold into the slimmed `operations.js` or `admin.js`, keeping sync.js eligible for full retirement.

### 5.3 daily-briefing.js (59 KB → Supabase Edge)

Entire function moves. The briefing aggregator queries all three Supabase databases, assembles a snapshot, and returns it. This is read-heavy orchestration that belongs next to the data.

**Edge Function name:** `daily-briefing`
**Callers:** Frontend (on-demand), pg_cron (6:00 AM pre-assembly), Power Automate (Teams delivery)

### 5.4 data-proxy.js (18 KB → eliminated)

Replace with Supabase Edge Function `data-query` that applies the same table allowlisting logic. The frontend calls `data-query` directly instead of routing through Vercel.

**Gov write service and Gov evidence endpoints** also move to `data-query` (or a separate `gov-write-proxy` Edge Function if separation of concerns warrants it).

### 5.5 intake.js (28 KB → Supabase Edge)

Both routes move:
- `outlook-message` → **Supabase Edge: `intake-receiver`**
- `summary` → **Supabase Edge: `intake-receiver`** (as sub-route)

Power Automate posts directly to the Edge Function.

### 5.6 Functions That Stay in Vercel

| Function | Size | Why It Stays |
|----------|------|-------------|
| queue.js | 38 KB | Primary frontend work surface — same-origin CRUD, lifecycle transitions |
| actions.js | 13 KB | Action item lifecycle — frontend-facing CRUD with lifecycle state machine |
| entity-hub.js | 3.5 KB | Thin router delegating to _handlers/ — frontend-facing entity search and context |
| operations.js (slimmed) | ~30 KB | Bridge actions + workflow mutations — frontend-triggered, uses LCC auth patterns |
| admin.js | 16 KB | Workspace admin, members, feature flags — low-traffic config |
| apply-change.js | 10 KB | Audited domain write service — policy enforcement layer, must stay centralized |
| domains.js | 31 KB | Domain registration and config — admin CRUD, low-traffic |
| diagnostics.js | 9 KB | Config, diag, treasury — lightweight utilities |

**Total: 8 functions using ~152 KB. Headroom for 4 more functions.**

---

## 6. Supabase Edge Function Specifications

### 6.0 Shared Modules

Every Edge Function imports from a shared directory (`supabase/functions/_shared/`):

#### `supabase/functions/_shared/supabase-client.ts`

```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// OPS database (primary)
export const opsClient = createClient(
  Deno.env.get("OPS_SUPABASE_URL")!,
  Deno.env.get("OPS_SUPABASE_SERVICE_KEY")!
);

// Gov database (read + write proxy)
export const govClient = createClient(
  Deno.env.get("GOV_SUPABASE_URL")!,
  Deno.env.get("GOV_SUPABASE_KEY")!
);

// Dia database (read + write proxy)
export const diaClient = createClient(
  Deno.env.get("DIA_SUPABASE_URL")!,
  Deno.env.get("DIA_SUPABASE_KEY")!
);
```

#### `supabase/functions/_shared/auth.ts`

```typescript
const PA_WEBHOOK_SECRET = Deno.env.get("PA_WEBHOOK_SECRET");

/**
 * Validate Power Automate webhook requests.
 * Same constant-time comparison as api/_shared/auth.js.
 */
export function authenticateWebhook(req: Request): boolean {
  if (!PA_WEBHOOK_SECRET) return true; // transitional mode
  const provided = req.headers.get("x-pa-webhook-secret") || "";
  if (provided.length !== PA_WEBHOOK_SECRET.length) return false;
  let mismatch = 0;
  for (let i = 0; i < PA_WEBHOOK_SECRET.length; i++) {
    mismatch |= provided.charCodeAt(i) ^ PA_WEBHOOK_SECRET.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Authenticate user requests via Supabase JWT or transitional mode.
 * Mirrors api/_shared/auth.js authenticate() logic.
 */
export async function authenticateUser(req: Request): Promise<{ id: string; workspaceId: string } | null> {
  // Transitional mode: resolve default owner from OPS database
  // TODO: Implement full JWT validation when frontend auth is ready
  const { opsClient } = await import("./supabase-client.ts");
  const { data } = await opsClient
    .from("workspace_memberships")
    .select("user_id, workspace_id")
    .eq("role", "owner")
    .limit(1)
    .single();
  if (!data) return null;
  return { id: data.user_id, workspaceId: data.workspace_id };
}
```

#### `supabase/functions/_shared/signals.ts`

```typescript
import { opsClient } from "./supabase-client.ts";

/**
 * Fire-and-forget signal write. Mirrors api/_shared/signals.js.
 */
export async function writeSignal(params: {
  signal_type: string;
  signal_category: string;
  entity_type?: string;
  entity_id?: string;
  domain?: string;
  user_id?: string;
  payload?: Record<string, unknown>;
  outcome?: string;
  model_version?: string;
}): Promise<void> {
  try {
    await opsClient.from("signals").insert({
      signal_type: params.signal_type,
      signal_category: params.signal_category || "system",
      entity_type: params.entity_type || null,
      entity_id: params.entity_id || null,
      domain: params.domain || null,
      user_id: params.user_id || null,
      payload: params.payload || {},
      outcome: params.outcome || null,
      model_version: params.model_version || null,
    });
  } catch (err) {
    console.error("[signal write failed]", err);
  }
}
```

#### `supabase/functions/_shared/cors.ts`

```typescript
const ALLOWED_ORIGINS = [
  "https://life-command-center.vercel.app",
  "http://localhost:3000",
  "http://localhost:5500",
];

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-LCC-Workspace, X-PA-Webhook-Secret",
    "Access-Control-Max-Age": "86400",
  };
}

export function handleCors(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }
  return null;
}
```

---

### 6.1 context-broker Edge Function

**Source code location:** `supabase/functions/context-broker/index.ts`
**Migrates from:** `operations.js` lines ~2811–3650 (handleContextRoute + all assembly functions)
**API contract:** Matches [Context Broker API Spec](./context_broker_api_spec.md) exactly

**Routes:**

| Method | Path | Action |
|--------|------|--------|
| POST | `/functions/v1/context-broker?action=assemble` | Assemble single packet |
| POST | `/functions/v1/context-broker?action=assemble-multi` | Batch assembly |
| POST | `/functions/v1/context-broker?action=invalidate` | Invalidate cached packets |
| POST | `/functions/v1/context-broker?action=preassemble-nightly` | Nightly cache warming |
| POST | `/functions/v1/context-broker?action=weekly-intelligence-report` | Weekly signal feedback |
| GET | `/functions/v1/context-broker?action=health` | Health + metrics |
| GET | `/functions/v1/context-broker?action=status&entity_id=X` | Cache status for entity |

**Implementation notes:**
- Port `assembleSinglePacket()`, `assemblePropertyPacket()`, `assembleContactPacket()`, `assembleDailyBriefingPacket()`, `assembleGenericPacket()` directly — these are self-contained functions that query Supabase via REST.
- Replace `opsQuery('GET', ...)` calls with `opsClient.from(...).select(...)` using the Supabase JS client (more natural for Edge Functions and avoids manual URL construction).
- Replace direct `fetch()` calls to Gov/Dia with `govClient` / `diaClient`.
- Packet caching continues to use the `context_packets` table in OPS Supabase (already exists).
- Signal writing uses `_shared/signals.ts`.

**New: packet_quality_score computation**
Add to `assembleSinglePacket()` before returning:

```typescript
function computeQualityScore(payload: any, fieldsMissing: string[], sourcesQueried: string[]): number {
  let score = 100;
  // Coverage: penalize for missing fields
  score -= fieldsMissing.length * 10;
  // Source breadth: reward for multi-source assembly
  if (sourcesQueried.length >= 3) score += 5;
  // Staleness: penalize if any source returned stale data
  // (detected by comparing source timestamps to now)
  // Conflict: penalize if sources disagreed on key fields
  return Math.max(0, Math.min(100, score));
}
```

Store in `context_packets.quality_score` (add column to schema):

```sql
ALTER TABLE context_packets ADD COLUMN IF NOT EXISTS quality_score integer;
```

---

### 6.2 copilot-chat Edge Function

**Source code location:** `supabase/functions/copilot-chat/index.ts`
**Migrates from:** `operations.js` chat routes + `_shared/ai.js` + existing `ai-copilot` Edge Function
**Consolidates:** The current flow is frontend → `operations.js` chat route → `ai-copilot` Edge Function. This collapses to frontend → `copilot-chat` Edge Function.

**Routes:**

| Method | Path | Action |
|--------|------|--------|
| POST | `/functions/v1/copilot-chat` | AI chat with packet injection |
| POST | `/functions/v1/copilot-chat?action=dispatch` | Copilot action dispatch gateway |
| POST | `/functions/v1/copilot-chat?action=followup` | Follow-up signal (learning loop) |
| GET | `/functions/v1/copilot-chat?action=openapi-spec` | OpenAPI 3.0 spec (no auth) |
| GET | `/functions/v1/copilot-chat?action=manifest` | Plugin manifest (no auth) |

**Implementation notes:**
- Before generating a response, call `context-broker` (same Supabase instance, internal call) to assemble the relevant packet based on the user's query intent.
- Inject packet into system prompt using the injection format from `context_broker_api_spec.md` Section 4.
- Action dispatch validates against `ACTION_SCHEMAS` (port from `_shared/action-schemas.js`).
- Follow-up signal writes to signals table for the learning loop.
- OpenAPI spec and plugin manifest are static JSON — serve directly without auth.

---

### 6.3 template-service Edge Function

**Source code location:** `supabase/functions/template-service/index.ts`
**Migrates from:** `operations.js` draft routes + `_shared/templates.js` + `_shared/template-refinement.js` + `_shared/listing-bd.js`

**Routes:**

| Method | Path | Action |
|--------|------|--------|
| GET | `/functions/v1/template-service` | List active templates |
| GET | `/functions/v1/template-service?template_id=X` | Get single template |
| POST | `/functions/v1/template-service?action=generate` | Generate draft (single) |
| POST | `/functions/v1/template-service?action=batch` | Batch draft generation |
| POST | `/functions/v1/template-service?action=record_send` | Record a sent draft + edit distance |
| POST | `/functions/v1/template-service?action=listing_bd` | Run listing-as-BD pipeline |
| POST | `/functions/v1/template-service?action=health` | Template health evaluation |
| POST | `/functions/v1/template-service?action=revision` | Generate revision suggestion |

**Implementation notes:**
- Port `_shared/templates.js` functions: `generateDraft`, `generateBatchDrafts`, `listActiveTemplates`, `loadTemplate`, `recordTemplateSend`, `computeEditDistance`.
- Port `_shared/template-refinement.js`: `evaluateTemplateHealth`, `flagTemplateForRevision`, `generateRevisionSuggestion`.
- Port `_shared/listing-bd.js`: `runListingBdPipeline`.
- Template drafting calls the AI provider — reuse the existing `ai-copilot` Edge Function or call the LLM directly (Azure OpenAI / Anthropic API).
- `record_send` computes edit distance and writes `template_sent` + `template_edited` signals.

---

### 6.4 daily-briefing Edge Function

**Source code location:** `supabase/functions/daily-briefing/index.ts`
**Migrates from:** `api/daily-briefing.js` (entire 59KB file)

**Routes:**

| Method | Path | Action |
|--------|------|--------|
| GET | `/functions/v1/daily-briefing?action=snapshot` | On-demand briefing |
| POST | `/functions/v1/daily-briefing?action=preassemble` | Nightly pre-assembly (called by pg_cron) |
| GET | `/functions/v1/daily-briefing?action=structured` | Structured data for Teams adaptive card |

**Implementation notes:**
- Port the entire `daily-briefing.js` handler, replacing `opsQuery()` with Supabase client calls.
- Gov and Dia queries use `govClient` and `diaClient` directly — no round-trip through Vercel.
- The `deriveItemTitle()` utility is reusable and should go in `_shared/utils.ts`.
- Morning structured/HTML URLs (`MORNING_STRUCTURED_URL`, `MORNING_HTML_URL`) continue to work as-is.
- Power Automate delivery flow calls the new Edge Function URL instead of Vercel.

---

### 6.5 intake-receiver Edge Function

**Source code location:** `supabase/functions/intake-receiver/index.ts`
**Migrates from:** `api/intake.js` (28KB)

**Routes:**

| Method | Path | Action |
|--------|------|--------|
| POST | `/functions/v1/intake-receiver?action=outlook-message` | Single Outlook message intake |
| GET | `/functions/v1/intake-receiver?action=summary` | Intake summary for Teams/PA |

**Implementation notes:**
- Port `handleOutlookMessage()` and `handleIntakeSummary()` from intake.js.
- Authentication uses `authenticateWebhook()` from `_shared/auth.ts` (Power Automate webhook secret).
- Entity linking uses ported logic from `_shared/entity-link.js` — `ensureEntityLink()` and `normalizeCanonicalName()`.
- Deduplication via `deterministicCorrelationId()` (sha1 hash of workspace + external ID + timestamp).
- AI classification (if enabled) calls the LLM for intake categorization.
- Writes directly to OPS `inbox_items` table via `opsClient`.

---

### 6.6 lead-ingest Edge Function

**Source code location:** `supabase/functions/lead-ingest/index.ts`
**Migrates from:** `sync.js` ingest sub-routes (RCM, LoopNet, listing webhook, live-ingest)

**Routes:**

| Method | Path | Action |
|--------|------|--------|
| POST | `/functions/v1/lead-ingest?source=rcm` | RCM email notification → marketing_leads |
| POST | `/functions/v1/lead-ingest?source=loopnet` | LoopNet inquiry → marketing_leads |
| POST | `/functions/v1/lead-ingest?source=listing` | SF deal webhook → entity + listing-BD |
| POST | `/functions/v1/lead-ingest?source=live` | Live ingest (Dialysis Flask proxy) |
| GET | `/functions/v1/lead-ingest?action=health` | Lead health check |

**Implementation notes:**
- All ingest sources write to OPS or Dia Supabase directly — no Vercel proxy.
- Webhook authentication via `PA_WEBHOOK_SECRET` header (same as today).
- RCM/LoopNet parsers are self-contained: extract sender, property, intent from email body, write to `marketing_leads`.
- Listing webhook calls `runListingBdPipeline()` after entity creation — this function can be imported from the `template-service` shared module or duplicated locally.
- `live-ingest` proxies to the Dialysis Flask pipeline endpoint (same pattern as today, just hosted on Supabase Edge).

---

### 6.7 data-query Edge Function

**Source code location:** `supabase/functions/data-query/index.ts`
**Migrates from:** `api/data-proxy.js` (18KB)

**Routes:**

| Method | Path | Action |
|--------|------|--------|
| GET | `/functions/v1/data-query?source=gov&table=X` | Gov database read |
| GET | `/functions/v1/data-query?source=dia&table=X` | Dia database read |
| POST | `/functions/v1/data-query?source=gov&action=write&endpoint=X` | Gov write service proxy |
| POST | `/functions/v1/data-query?source=gov&action=evidence&endpoint=X` | Gov evidence endpoints |

**Implementation notes:**
- Table allowlisting from `_shared/allowlist.js` is ported to `_shared/allowlist.ts`.
- The same `GOV_READ_TABLES`, `GOV_WRITE_TABLES`, `DIA_READ_TABLES`, `DIA_WRITE_TABLES` arrays are enforced.
- `safeLimit()`, `safeSelect()`, `safeColumn()` utilities prevent injection.
- Gov write service and evidence endpoints proxy to `GOV_API_URL` (same pattern as today).
- User authentication uses `authenticateUser()` from shared auth module.

---

### 6.8 sync-orchestrator Edge Function

**Source code location:** `supabase/functions/sync-orchestrator/index.ts`
**Migrates from:** `sync.js` sync action routes (email, calendar, SF activities)

**Routes:**

| Method | Path | Action |
|--------|------|--------|
| POST | `/functions/v1/sync-orchestrator?action=ingest_emails` | Email sync |
| POST | `/functions/v1/sync-orchestrator?action=ingest_calendar` | Calendar sync |
| POST | `/functions/v1/sync-orchestrator?action=ingest_sf_activities` | Salesforce activity sync |
| POST | `/functions/v1/sync-orchestrator?action=outbound` | Outbound sync |
| POST | `/functions/v1/sync-orchestrator?action=retry` | Retry failed sync |
| GET | `/functions/v1/sync-orchestrator?action=health` | Sync health |
| GET | `/functions/v1/sync-orchestrator?action=jobs` | Recent sync jobs |

**Implementation notes:**
- Per-connector sync uses connector records from OPS `connectors` table.
- `connectorHeaders()` pattern is preserved for per-user scoping.
- Power Automate sends scheduled sync triggers here instead of to Vercel.
- The existing `EDGE_FN_URL` reference to `ai-copilot` is replaced with direct `opsClient` calls where possible.

---

## 7. pg_cron Scheduled Jobs

All nightly analytics jobs move from "serverless function invoked by external scheduler" to "SQL function invoked by pg_cron inside OPS Supabase."

### 7.1 Schema Changes

```sql
-- Enable pg_cron extension (Supabase Pro includes this)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Grant cron access to run functions
GRANT USAGE ON SCHEMA cron TO postgres;
```

### 7.2 Job Definitions

#### Engagement Scoring (2:00 AM daily)

```sql
CREATE OR REPLACE FUNCTION refresh_engagement_scores()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  -- Update contact_engagement table based on recent signals
  INSERT INTO contact_engagement (entity_id, engagement_score, last_touchpoint_at, touchpoint_count_30d, cadence_status, updated_at)
  SELECT
    s.entity_id,
    LEAST(100, GREATEST(0,
      50
      + COUNT(*) FILTER (WHERE s.signal_type = 'touchpoint_logged' AND s.created_at > NOW() - INTERVAL '30 days') * 5
      + COUNT(*) FILTER (WHERE s.signal_type = 'contact_response') * 10
      - EXTRACT(DAY FROM NOW() - MAX(s.created_at))::int
    ))::int AS engagement_score,
    MAX(s.created_at) FILTER (WHERE s.signal_type = 'touchpoint_logged') AS last_touchpoint_at,
    COUNT(*) FILTER (WHERE s.signal_type = 'touchpoint_logged' AND s.created_at > NOW() - INTERVAL '30 days') AS touchpoint_count_30d,
    CASE
      WHEN MAX(s.created_at) FILTER (WHERE s.signal_type = 'touchpoint_logged') > NOW() - INTERVAL '14 days' THEN 'on_track'
      WHEN MAX(s.created_at) FILTER (WHERE s.signal_type = 'touchpoint_logged') > NOW() - INTERVAL '30 days' THEN 'due'
      ELSE 'overdue'
    END AS cadence_status,
    NOW() AS updated_at
  FROM signals s
  WHERE s.entity_type = 'contact' AND s.entity_id IS NOT NULL
  GROUP BY s.entity_id
  ON CONFLICT (entity_id) DO UPDATE SET
    engagement_score = EXCLUDED.engagement_score,
    last_touchpoint_at = EXCLUDED.last_touchpoint_at,
    touchpoint_count_30d = EXCLUDED.touchpoint_count_30d,
    cadence_status = EXCLUDED.cadence_status,
    updated_at = EXCLUDED.updated_at;
END;
$$;

SELECT cron.schedule('refresh-engagement', '0 2 * * *', 'SELECT refresh_engagement_scores()');
```

#### Scoring Calibration (3:00 AM daily)

```sql
CREATE OR REPLACE FUNCTION refresh_scoring_calibration()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO scoring_calibration (computed_at, total_recommendations, acted_on_count, ignored_count, precision_by_tier, overall_precision)
  SELECT
    NOW(),
    COUNT(*) FILTER (WHERE signal_type IN ('recommendation_acted_on', 'recommendation_ignored', 'recommendation_deferred')),
    COUNT(*) FILTER (WHERE signal_type = 'recommendation_acted_on'),
    COUNT(*) FILTER (WHERE signal_type = 'recommendation_ignored'),
    jsonb_build_object(
      'high', ROUND(
        COUNT(*) FILTER (WHERE signal_type = 'recommendation_acted_on' AND payload->>'priority' = 'high')::numeric /
        NULLIF(COUNT(*) FILTER (WHERE payload->>'priority' = 'high'), 0), 2
      ),
      'medium', ROUND(
        COUNT(*) FILTER (WHERE signal_type = 'recommendation_acted_on' AND payload->>'priority' = 'medium')::numeric /
        NULLIF(COUNT(*) FILTER (WHERE payload->>'priority' = 'medium'), 0), 2
      ),
      'low', ROUND(
        COUNT(*) FILTER (WHERE signal_type = 'recommendation_acted_on' AND payload->>'priority' = 'low')::numeric /
        NULLIF(COUNT(*) FILTER (WHERE payload->>'priority' = 'low'), 0), 2
      )
    ),
    ROUND(
      COUNT(*) FILTER (WHERE signal_type = 'recommendation_acted_on')::numeric /
      NULLIF(COUNT(*) FILTER (WHERE signal_type IN ('recommendation_acted_on', 'recommendation_ignored', 'recommendation_deferred')), 0), 2
    )
  FROM signals
  WHERE created_at > NOW() - INTERVAL '30 days';
END;
$$;

SELECT cron.schedule('refresh-calibration', '0 3 * * *', 'SELECT refresh_scoring_calibration()');
```

#### Template Performance (3:30 AM daily)

```sql
CREATE OR REPLACE FUNCTION refresh_template_performance()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO template_performance (template_id, template_version, sent_count, open_count, reply_count, avg_edit_distance, response_rate, updated_at)
  SELECT
    payload->>'template_id',
    payload->>'template_version',
    COUNT(*) FILTER (WHERE signal_type = 'template_sent'),
    COUNT(*) FILTER (WHERE signal_type = 'template_sent' AND (payload->>'opened')::boolean = true),
    COUNT(*) FILTER (WHERE signal_type = 'template_response'),
    AVG((payload->>'edit_distance')::float) FILTER (WHERE signal_type = 'template_edited'),
    ROUND(
      COUNT(*) FILTER (WHERE signal_type = 'template_response')::numeric /
      NULLIF(COUNT(*) FILTER (WHERE signal_type = 'template_sent'), 0), 3
    ),
    NOW()
  FROM signals
  WHERE signal_type IN ('template_sent', 'template_edited', 'template_response')
    AND payload->>'template_id' IS NOT NULL
    AND created_at > NOW() - INTERVAL '90 days'
  GROUP BY payload->>'template_id', payload->>'template_version'
  ON CONFLICT (template_id, template_version) DO UPDATE SET
    sent_count = EXCLUDED.sent_count,
    open_count = EXCLUDED.open_count,
    reply_count = EXCLUDED.reply_count,
    avg_edit_distance = EXCLUDED.avg_edit_distance,
    response_rate = EXCLUDED.response_rate,
    updated_at = EXCLUDED.updated_at;
END;
$$;

SELECT cron.schedule('refresh-template-perf', '30 3 * * *', 'SELECT refresh_template_performance()');
```

#### Pipeline Velocity (4:00 AM Sundays)

```sql
CREATE OR REPLACE FUNCTION refresh_pipeline_velocity()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO pipeline_velocity (domain, from_stage, to_stage, median_days, p75_days, p90_days, conversion_rate, sample_size, updated_at)
  SELECT
    s.domain,
    s.payload->>'from_stage' AS from_stage,
    s.payload->>'to_stage' AS to_stage,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (s.payload->>'days_in_stage')::float) AS median_days,
    PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY (s.payload->>'days_in_stage')::float) AS p75_days,
    PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY (s.payload->>'days_in_stage')::float) AS p90_days,
    1.0 AS conversion_rate,  -- TODO: compute from stage pair counts
    COUNT(*) AS sample_size,
    NOW() AS updated_at
  FROM signals s
  WHERE s.signal_type = 'deal_stage_change'
    AND s.payload->>'from_stage' IS NOT NULL
    AND s.payload->>'days_in_stage' IS NOT NULL
    AND s.created_at > NOW() - INTERVAL '365 days'
  GROUP BY s.domain, s.payload->>'from_stage', s.payload->>'to_stage'
  ON CONFLICT (domain, from_stage, to_stage) DO UPDATE SET
    median_days = EXCLUDED.median_days,
    p75_days = EXCLUDED.p75_days,
    p90_days = EXCLUDED.p90_days,
    conversion_rate = EXCLUDED.conversion_rate,
    sample_size = EXCLUDED.sample_size,
    updated_at = EXCLUDED.updated_at;
END;
$$;

SELECT cron.schedule('refresh-pipeline-velocity', '0 4 * * 0', 'SELECT refresh_pipeline_velocity()');
```

#### Outcome Resolution (4:00 AM daily)

```sql
CREATE OR REPLACE FUNCTION resolve_pending_outcomes()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  -- OM follow-up: mark missed if no follow-up signal within 48h
  UPDATE signals SET
    outcome = 'negative',
    outcome_detail = 'om_follow_up_missed',
    outcome_at = NOW(),
    outcome_latency_days = EXTRACT(DAY FROM NOW() - created_at)
  WHERE signal_type = 'om_download'
    AND outcome = 'pending'
    AND created_at < NOW() - INTERVAL '48 hours'
    AND NOT EXISTS (
      SELECT 1 FROM signals s2
      WHERE s2.signal_type = 'om_follow_up_completed'
        AND s2.entity_id = signals.entity_id
        AND s2.created_at > signals.created_at
    );

  -- Template response: mark no_response if no reply within 7 days
  UPDATE signals SET
    outcome = 'negative',
    outcome_detail = 'no_response',
    outcome_at = NOW(),
    outcome_latency_days = EXTRACT(DAY FROM NOW() - created_at)
  WHERE signal_type = 'template_sent'
    AND outcome = 'pending'
    AND created_at < NOW() - INTERVAL '7 days'
    AND NOT EXISTS (
      SELECT 1 FROM signals s2
      WHERE s2.signal_type = 'template_response'
        AND s2.entity_id = signals.entity_id
        AND s2.created_at > signals.created_at
    );
END;
$$;

SELECT cron.schedule('resolve-outcomes', '0 4 * * *', 'SELECT resolve_pending_outcomes()');
```

#### Cross-Domain Match (1:00 AM daily)

```sql
-- This job runs inside OPS and queries Gov/Dia via foreign data wrappers
-- or via Edge Function call. Since pg_cron can't directly query external
-- Supabase instances, this calls the context-broker Edge Function.

SELECT cron.schedule(
  'cross-domain-match',
  '0 1 * * *',
  $$SELECT net.http_post(
    url := current_setting('app.edge_function_url') || '/context-broker?action=cross-domain-match',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_key')),
    body := '{}'::jsonb
  )$$
);
```

#### Briefing Pre-Assembly (6:00 AM daily)

```sql
SELECT cron.schedule(
  'preassemble-briefing',
  '0 6 * * *',
  $$SELECT net.http_post(
    url := current_setting('app.edge_function_url') || '/context-broker?action=preassemble-nightly',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_key')),
    body := '{}'::jsonb
  )$$
);
```

#### Overdue OM Follow-Up Flagging (every 4 hours)

```sql
CREATE OR REPLACE FUNCTION flag_overdue_om_followups()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO signals (signal_type, signal_category, entity_id, entity_type, payload)
  SELECT
    'om_follow_up_missed',
    'marketing',
    s.entity_id,
    'contact',
    jsonb_build_object(
      'original_download_signal_id', s.id,
      'hours_overdue', EXTRACT(HOURS FROM NOW() - s.created_at)
    )
  FROM signals s
  WHERE s.signal_type = 'om_download'
    AND s.outcome = 'pending'
    AND s.created_at < NOW() - INTERVAL '48 hours'
    AND NOT EXISTS (
      SELECT 1 FROM signals s2
      WHERE s2.signal_type = 'om_follow_up_missed'
        AND s2.payload->>'original_download_signal_id' = s.id::text
    );
END;
$$;

SELECT cron.schedule('flag-overdue-om', '0 */4 * * *', 'SELECT flag_overdue_om_followups()');
```

---

## 8. Power Automate Routing Changes

| Flow | Current Target | New Target | Auth |
|------|---------------|------------|------|
| Outlook message intake | `https://life-command-center.vercel.app/api/intake-outlook-message` | `https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/intake-receiver?action=outlook-message` | `X-PA-Webhook-Secret` (same) |
| RCM email notifications | `https://life-command-center.vercel.app/api/rcm-ingest` | `https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/lead-ingest?source=rcm` | `X-PA-Webhook-Secret` (same) |
| LoopNet inquiry emails | `https://life-command-center.vercel.app/api/loopnet-ingest` | `https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/lead-ingest?source=loopnet` | `X-PA-Webhook-Secret` (same) |
| SF deal listing webhook | `https://life-command-center.vercel.app/api/listing-webhook` | `https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/lead-ingest?source=listing` | `X-PA-Webhook-Secret` (same) |
| Daily briefing delivery | `https://life-command-center.vercel.app/api/daily-briefing` | `https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/daily-briefing?action=snapshot` | `X-PA-Webhook-Secret` (same) |
| Email/Calendar/SF sync | `https://life-command-center.vercel.app/api/sync` | `https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1/sync-orchestrator` | `X-PA-Webhook-Secret` (same) |

**Payload format:** Unchanged. Same JSON schema, same headers. Only the URL changes.

---

## 9. Frontend Routing Changes

### 9.1 New API Base URLs

Add to frontend config (app.js or a shared config):

```javascript
const SUPABASE_EDGE_URL = 'https://zqzrriwuavgrquhisnoa.supabase.co/functions/v1';

const API_ROUTES = {
  // Stays on Vercel (same-origin)
  queue:       '/api/queue',
  queueV2:     '/api/queue-v2',
  inbox:       '/api/inbox',
  actions:     '/api/actions',
  activities:  '/api/activities',
  entities:    '/api/entities',
  contacts:    '/api/unified-contacts',
  search:      '/api/search',
  property:    '/api/property',
  contact:     '/api/contact',
  operations:  '/api/operations',
  admin:       '/api/admin',
  flags:       '/api/flags',
  applyChange: '/api/apply-change',
  domains:     '/api/domains',
  config:      '/api/config',

  // Moves to Supabase Edge
  chat:           `${SUPABASE_EDGE_URL}/copilot-chat`,
  context:        `${SUPABASE_EDGE_URL}/context-broker`,
  draft:          `${SUPABASE_EDGE_URL}/template-service`,
  dailyBriefing:  `${SUPABASE_EDGE_URL}/daily-briefing`,
  govQuery:       `${SUPABASE_EDGE_URL}/data-query?source=gov`,
  diaQuery:       `${SUPABASE_EDGE_URL}/data-query?source=dia`,
  govWrite:       `${SUPABASE_EDGE_URL}/data-query?source=gov&action=write`,
  govEvidence:    `${SUPABASE_EDGE_URL}/data-query?source=gov&action=evidence`,
};
```

### 9.2 Feature Flag Gating

During migration, use the existing feature flag system to gate which backend each endpoint calls:

```javascript
// In app.js or shared fetch wrapper
function apiUrl(route) {
  const flags = window.__LCC_FLAGS || {};

  // Phase 1: Context Broker migration
  if (route === 'context' && flags.edge_context_broker) {
    return `${SUPABASE_EDGE_URL}/context-broker`;
  }

  // Phase 3: Chat migration
  if (route === 'chat' && flags.edge_copilot_chat) {
    return `${SUPABASE_EDGE_URL}/copilot-chat`;
  }

  // Phase 4: Data query migration
  if (route === 'govQuery' && flags.edge_data_query) {
    return `${SUPABASE_EDGE_URL}/data-query?source=gov`;
  }

  // Default: use Vercel
  return API_ROUTES[route];
}
```

**New feature flags to add:**

```javascript
// Add to admin.js DEFAULT_FLAGS
edge_context_broker: false,      // Phase 1
edge_copilot_chat: false,        // Phase 3
edge_template_service: false,    // Phase 3
edge_daily_briefing: false,      // Phase 4
edge_data_query: false,          // Phase 4
```

---

## 10. vercel.json Changes by Phase

### After Phase 1 (Context Broker moves)

Remove:
```json
{ "source": "/api/context", "destination": "/api/operations?_route=context" },
{ "source": "/api/preassemble", "destination": "/api/operations?_route=context&action=preassemble-nightly" },
{ "source": "/api/weekly-report", "destination": "/api/operations?_route=context&action=weekly-intelligence-report" }
```

### After Phase 2 (Ingestion moves)

Remove:
```json
{ "source": "/api/rcm-ingest", "destination": "/api/sync?_route=rcm-ingest" },
{ "source": "/api/rcm-backfill", "destination": "/api/sync?_route=rcm-backfill" },
{ "source": "/api/loopnet-ingest", "destination": "/api/sync?_route=loopnet-ingest" },
{ "source": "/api/lead-health", "destination": "/api/sync?_route=lead-health" },
{ "source": "/api/listing-webhook", "destination": "/api/sync?_route=listing-webhook" },
{ "source": "/api/live-ingest", "destination": "/api/sync?_route=live-ingest" },
{ "source": "/api/cross-domain-match", "destination": "/api/sync?_route=cross-domain-match" },
{ "source": "/api/intake-outlook-message", "destination": "/api/intake?_route=outlook-message" },
{ "source": "/api/intake-summary", "destination": "/api/intake?_route=summary" }
```

Delete: `api/intake.js`

### After Phase 3 (Chat + templates move)

Remove:
```json
{ "source": "/api/chat", "destination": "/api/operations?_route=chat" },
{ "source": "/api/copilot-spec", "destination": "/api/operations?_route=chat&copilot_spec=openapi" },
{ "source": "/api/copilot-manifest", "destination": "/api/operations?_route=chat&copilot_spec=manifest" },
{ "source": "/api/draft", "destination": "/api/operations?_route=draft" }
```

Remove chat and draft route handlers from `operations.js`.

### After Phase 4 (Data layer moves)

Remove:
```json
{ "source": "/api/gov-query", "destination": "/api/data-proxy?_source=gov" },
{ "source": "/api/gov-write", "destination": "/api/data-proxy?_route=gov-write" },
{ "source": "/api/gov-evidence", "destination": "/api/data-proxy?_route=gov-evidence" },
{ "source": "/api/dia-query", "destination": "/api/data-proxy?_source=dia" }
```

Delete: `api/data-proxy.js`, `api/daily-briefing.js`

Move connector CRUD from sync.js into admin.js or operations.js, then delete: `api/sync.js`

---

## 11. Migration Sequence

### Phase 0: Foundation (Week 1)

**Goal:** Establish Supabase Edge Function infrastructure and shared modules.

| Step | Action | Validation |
|------|--------|-----------|
| 0.1 | Create `supabase/functions/_shared/` directory with `supabase-client.ts`, `auth.ts`, `signals.ts`, `cors.ts` | TypeScript compiles |
| 0.2 | Deploy a `health-check` Edge Function that verifies OPS/Gov/Dia connectivity | Returns 200 with source status from all 3 DBs |
| 0.3 | Set environment variables in Supabase Edge: `OPS_SUPABASE_URL`, `OPS_SUPABASE_SERVICE_KEY`, `GOV_SUPABASE_URL`, `GOV_SUPABASE_KEY`, `DIA_SUPABASE_URL`, `DIA_SUPABASE_KEY`, `PA_WEBHOOK_SECRET` | Health check accesses all DBs |
| 0.4 | Add `quality_score` column to `context_packets` table | Column exists |
| 0.5 | Add new feature flags to `admin.js` DEFAULT_FLAGS | Flags appear in /api/flags response |

**Risk:** Zero. No production changes.

### Phase 1: Context Broker (Weeks 2–3)

**Goal:** Move the highest-value intelligence layer to Supabase Edge.

| Step | Action | Validation |
|------|--------|-----------|
| 1.1 | Port Context Broker code from operations.js to `context-broker` Edge Function | All routes return expected responses |
| 1.2 | Implement `packet_quality_score` computation | Quality scores appear in packet responses and `context_packets` table |
| 1.3 | Deploy `context-broker` Edge Function | Health endpoint returns 200 |
| 1.4 | Add `edge_context_broker` feature flag, test with flag enabled | Packets assemble correctly from Edge Function |
| 1.5 | Enable flag in production, monitor for 1 week | Cache hit rates > 60%, assembly p95 < 2s |
| 1.6 | Remove Context Broker code from `operations.js` | operations.js drops from 166KB to ~120KB |
| 1.7 | Remove context-related rewrites from `vercel.json` | No 404s on remaining routes |

**Rollback:** Disable feature flag → instant fallback to Vercel.

### Phase 2: Ingestion Layer (Weeks 3–4)

**Goal:** Move all webhook receivers out of Vercel.

| Step | Action | Validation |
|------|--------|-----------|
| 2.1 | Port `intake-receiver` Edge Function from intake.js | POST with test payload creates inbox item |
| 2.2 | Port `lead-ingest` Edge Function from sync.js ingest routes | RCM/LoopNet test payloads create marketing_leads |
| 2.3 | Deploy both Edge Functions | Health endpoints return 200 |
| 2.4 | Update Power Automate flows to send to new URLs (keep Vercel endpoints alive) | New endpoints receive PA traffic |
| 2.5 | Monitor for 1 week: verify Vercel ingest endpoints show zero traffic | Zero hits on old endpoints |
| 2.6 | Delete `api/intake.js`, remove ingest routes from `sync.js` and `vercel.json` | `ls api/*.js | wc -l` drops to 11 |

**Rollback:** Revert Power Automate flow URLs to Vercel endpoints.

### Phase 3: Intelligence Services (Weeks 4–5)

**Goal:** Move AI chat and template services to Supabase Edge.

| Step | Action | Validation |
|------|--------|-----------|
| 3.1 | Port `copilot-chat` Edge Function (merge ai-copilot + operations.js chat) | Chat returns packet-grounded responses |
| 3.2 | Port `template-service` Edge Function | Draft generation returns correct templates |
| 3.3 | Deploy both Edge Functions | Health endpoints return 200 |
| 3.4 | Enable `edge_copilot_chat` and `edge_template_service` flags | Frontend uses Edge Functions |
| 3.5 | Remove chat and draft route handlers from `operations.js` | operations.js drops to ~30KB |
| 3.6 | Remove chat/draft rewrites from `vercel.json` | Clean routing |

**Rollback:** Disable feature flags.

### Phase 4: Data Layer Cleanup (Weeks 5–6)

**Goal:** Eliminate data-proxy and move briefing/sync to Supabase.

| Step | Action | Validation |
|------|--------|-----------|
| 4.1 | Port `data-query` Edge Function from data-proxy.js | Gov/Dia queries return same data |
| 4.2 | Port `daily-briefing` Edge Function | Briefing snapshot matches Vercel version |
| 4.3 | Port `sync-orchestrator` Edge Function | Sync runs complete successfully |
| 4.4 | Deploy all three Edge Functions | Health endpoints return 200 |
| 4.5 | Enable `edge_data_query` and `edge_daily_briefing` flags | Frontend uses Edge Functions |
| 4.6 | Update PA flows for daily briefing and sync | New endpoints receive traffic |
| 4.7 | Move connector CRUD from sync.js into operations.js or admin.js | Connector management still works |
| 4.8 | Delete `api/data-proxy.js`, `api/daily-briefing.js`, `api/sync.js` | `ls api/*.js | wc -l` = 8 |

**Rollback:** Disable feature flags, revert PA flow URLs.

### Phase 5: Scheduled Jobs (Weeks 6–7)

**Goal:** Move nightly analytics to pg_cron.

| Step | Action | Validation |
|------|--------|-----------|
| 5.1 | Enable pg_cron extension in OPS Supabase | Extension active |
| 5.2 | Deploy `refresh_engagement_scores()` function + cron | `contact_engagement` table updates nightly |
| 5.3 | Deploy `refresh_scoring_calibration()` function + cron | `scoring_calibration` table updates nightly |
| 5.4 | Deploy `refresh_template_performance()` function + cron | `template_performance` table updates nightly |
| 5.5 | Deploy `refresh_pipeline_velocity()` function + cron | `pipeline_velocity` table updates weekly |
| 5.6 | Deploy `resolve_pending_outcomes()` function + cron | Pending signals resolve correctly |
| 5.7 | Deploy `flag_overdue_om_followups()` function + cron | Overdue flags appear every 4h |
| 5.8 | Configure pg_cron → Edge Function calls for briefing pre-assembly and cross-domain match | Jobs execute on schedule |

**Rollback:** Disable cron jobs via `cron.unschedule()`.

---

## 12. Supabase Edge Function Environment Variables

Set these in the Supabase Dashboard under Edge Functions → Secrets:

| Variable | Source | Used By |
|----------|--------|---------|
| `OPS_SUPABASE_URL` | OPS project URL | All Edge Functions |
| `OPS_SUPABASE_SERVICE_KEY` | OPS service role key | All Edge Functions |
| `GOV_SUPABASE_URL` | Gov project URL | context-broker, data-query, daily-briefing |
| `GOV_SUPABASE_KEY` | Gov anon/service key | context-broker, data-query, daily-briefing |
| `GOV_API_URL` | Gov write service URL | data-query |
| `DIA_SUPABASE_URL` | Dia project URL | context-broker, data-query, daily-briefing, lead-ingest |
| `DIA_SUPABASE_KEY` | Dia anon/service key | context-broker, data-query, daily-briefing, lead-ingest |
| `PA_WEBHOOK_SECRET` | Power Automate shared secret | intake-receiver, lead-ingest, sync-orchestrator |
| `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` | LLM provider | copilot-chat, template-service |
| `PA_COMPLETE_TASK_URL` | Power Automate flow URL | sync-orchestrator |

---

## 13. Risk Mitigation

**Parallel running.** Each phase keeps Vercel endpoints alive as fallbacks for at least one week. Traffic is logged; endpoints are retired only after confirming zero hits.

**Feature flags.** The frontend's existing flag system gates which backend each endpoint calls. Flipping a flag rolls back to Vercel instantly.

**No big bang.** Each phase is independently deployable. Phase 2 can run while Phase 1 stabilizes. The system is always in a working state.

**Shared auth.** The same `PA_WEBHOOK_SECRET` pattern works identically on both Vercel and Supabase Edge.

**Monitoring.** Each Edge Function logs response times and errors. The signals table captures performance data for both runtimes during transition.

**Cost safety.** No new services are introduced. Supabase Edge Functions are included in the Pro plan. Additional invocations are $2/million — negligible at current scale.

---

## 14. Post-Migration State

### Vercel (8 functions, ~152 KB)

| Function | Role |
|----------|------|
| queue.js | Queue views + inbox CRUD |
| actions.js | Action lifecycle + activities |
| entity-hub.js | Entity/contact/property/search routing |
| operations.js (slim) | Bridge actions + workflow mutations + connector CRUD |
| admin.js | Workspace admin, members, flags |
| apply-change.js | Audited domain write service |
| domains.js | Domain registration and config |
| diagnostics.js | Config, diag, treasury |

### Supabase Edge Functions (8 functions)

| Function | Role |
|----------|------|
| context-broker | Packet assembly, cache, quality scoring, invalidation |
| copilot-chat | AI chat with packet injection, action dispatch |
| template-service | Draft generation, batch, send recording, listing-BD |
| daily-briefing | Briefing snapshot assembly |
| intake-receiver | Outlook message intake |
| lead-ingest | RCM, LoopNet, listing, live ingest |
| data-query | Gov/Dia read/write proxy |
| sync-orchestrator | Email/calendar/SF sync |

### pg_cron (8 jobs)

| Job | Schedule |
|-----|----------|
| Engagement scoring | 2:00 AM daily |
| Scoring calibration | 3:00 AM daily |
| Template performance | 3:30 AM daily |
| Pipeline velocity | 4:00 AM Sundays |
| Outcome resolution | 4:00 AM daily |
| Cross-domain match | 1:00 AM daily |
| Briefing pre-assembly | 6:00 AM daily |
| Overdue OM flagging | Every 4 hours |

---

## 15. Blueprint Alignment

| Blueprint Principle | How Migration Achieves It |
|---|---|
| LCC = orchestration shell | Vercel hosts only frontend-serving CRUD and workflow orchestration |
| Context Broker as sacred boundary | Runs as dedicated Edge Function with caching, quality scoring, invalidation |
| Copilot is stateless per interaction | copilot-chat receives packets from broker, reasons, returns. No state |
| Every AI output emits a signal | Signal writing happens in same Supabase instance — no cross-service loss |
| Domain backends own domain logic | Gov and Dia remain authoritative. apply-change.js enforces policy. No change |
| Microsoft is a surface, not the brain | Power Automate remains thin plumbing. Intelligence stays in Supabase Edge + LCC |
| We will not build for novelty | No new services, no Azure, no Redis. Uses infrastructure already paid for |

---

## 16. What This Unlocks

**Context Broker goes live.** Proper home with sub-2s packet assembly, caching, quality scoring — not crammed into a mega-function.

**Copilot agent readiness.** With the broker on Supabase Edge, Copilot Studio agents (or any AI surface) can request packets via a clean API. Wave 1–2 agents become deployable.

**Write Proposal Contract.** With orchestration cleaned up, implementing Copilot's recommended Write Proposal Contract is straightforward — proposals flow through lean operations.js + apply-change.js.

**Headroom for growth.** Vercel has room for 4 more functions. Supabase Edge has no count limit. No routing hacks needed.

**Lower latency.** Data queries, packet assembly, and ingestion skip the Vercel → Supabase round trip.

**Cleaner Microsoft integration.** Power Automate writes directly to Supabase Edge — one hop instead of two. This is the "Microsoft Boundary Layer" implemented simply.
