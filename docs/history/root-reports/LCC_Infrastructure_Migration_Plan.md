<!-- Converted 2026-09-16 by Cowork from the root file `LCC_Infrastructure_Migration_Plan.docx` (pandoc, gfm) so that repo tools and Claude Code can read it. The .docx stays at the repo root (REPO1 decision: cited from audit/); this Markdown is the readable copy, NOT a new source of truth — its claims carry the original's date. -->

**LCC Infrastructure Migration Plan**

From Vercel Monolith to Purpose-Fit Architecture

Briggs CRE | Life Command Center

April 2026

**STRATEGIC ARCHITECTURE DOCUMENT**

1\. The Problem

The Life Command Center API layer is deployed on **Vercel’s Hobby plan**, which enforces a hard limit of **12 serverless functions** per deployment. LCC is currently at 12 of 12 — no room to add anything. The Context Broker, which the Copilot Operating System Blueprint identifies as the critical intelligence layer, had to be crammed into operations.js as sub-routes rather than deployed as a proper service.

This constraint has produced a set of architectural distortions that work against the blueprint’s own design principles:

  - **Mega-functions instead of clean services.** operations.js is 166KB with 18+ sub-routes handling bridge actions, workflows, template drafts, Copilot integration, chat, and the Context Broker. sync.js is 123KB. These are monolithic application servers disguised as serverless functions.

  - **Query-param routing hacks.** Every new endpoint requires a vercel.json rewrite and a ?\_route= or ?action= dispatch pattern, creating cognitive overhead and fragile routing chains.

  - **Data round-tripping.** data-proxy.js proxies Supabase queries through Vercel and back to Supabase — an unnecessary network hop that adds latency and exists only because the frontend needs a single API origin.

  - **Architectural role confusion.** The blueprint says LCC should be a “Copilot-facing orchestration shell + human review surface.” Instead, it has become the entire API backend: data proxy, ingestion pipeline, sync engine, AI chat provider, and domain write coordinator — all in 12 files.

*The 12-function limit is no longer a constraint we’re working within — it’s a constraint that’s shaping the architecture in ways that contradict the blueprint.*

2\. Governing Principle

From the Copilot Operating System Blueprint, Section 1:

> *“Every build request, workflow, integration, automation, and AI feature must answer this question: How does this get us closer to building a more intelligent, connected, productive, listing-driven brokerage operating system?”*

The migration proposed here is not about adopting new technology. It’s about moving each piece of the system to the runtime where it naturally belongs, so the architecture matches the blueprint rather than fighting it.

3\. Current State: The 12-Function Audit

Every function was audited for what it actually does, how large it is, what it depends on, and where the work naturally belongs.

|                   |          |                                                                                                     |                                                 |                                                                                                              |
| ----------------- | -------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Function**      | **Size** | **What It Does**                                                                                    | **Pattern**                                     | **Natural Home**                                                                                             |
| operations.js     | 166 KB   | Bridge actions, workflows, template drafts, Copilot spec/manifest, chat, Context Broker             | 18+ sub-routes via ?action= and ?\_route=       | **Split: Context Broker → Supabase Edge; Chat → Supabase Edge; Orchestration stays Vercel**                  |
| sync.js           | 123 KB   | Email/calendar/SF sync, connectors, RCM ingest, LoopNet ingest, cross-domain match, listing webhook | 5 sub-routes, webhook auth, edge function calls | **Ingestion → Power Automate direct-to-Supabase; Cross-domain match → pg\_cron; Connectors → Supabase Edge** |
| daily-briefing.js | 59 KB    | Aggregates queue items, tasks, alerts, deal milestones, domain data into briefing snapshot          | Read-only orchestrator, calls Gov + Dia + OPS   | **Supabase Edge Function (runs next to data, called by pg\_cron nightly + on-demand)**                       |
| queue.js          | 38 KB    | Queue v1, Queue v2 (paginated), Inbox CRUD with lifecycle transitions                               | Frontend-facing CRUD + views                    | **Stays Vercel (frontend-serving API)**                                                                      |
| entity-hub.js     | 3.5 KB   | Thin router to 6 handlers: contacts, entities, property, contact, search, briefing-email            | Pure delegation to \_handlers/                  | **Stays Vercel (frontend-serving) or move handlers to Supabase Edge**                                        |
| data-proxy.js     | 18 KB    | Proxies Gov/Dia Supabase reads + Gov write service + Gov evidence endpoints                         | Pass-through with auth + allowlisting           | **Eliminate: frontend calls Supabase Edge directly (with RLS or service-key proxy)**                         |
| intake.js         | 28 KB    | Outlook message ingestion, intake summary for Teams/PA                                              | Power Automate webhook target                   | **Supabase Edge Function (webhook receiver, writes direct to OPS)**                                          |
| actions.js        | 13 KB    | Action item CRUD + lifecycle transitions + activity logging                                         | Frontend-facing CRUD                            | **Stays Vercel (frontend-serving API)**                                                                      |
| domains.js        | 31 KB    | Domain registration, data sources, entity mappings, queue configs, templates                        | Admin/config CRUD                               | **Stays Vercel (admin API, low traffic)**                                                                    |
| admin.js          | 16 KB    | Workspaces, members, feature flags, auth config                                                     | Admin CRUD                                      | **Stays Vercel (admin API)**                                                                                 |
| apply-change.js   | 10 KB    | Audited mutation service for Gov/Dia domain writes                                                  | Single POST endpoint, audit trail               | **Stays Vercel (policy enforcement, audit trail)**                                                           |
| diagnostics.js    | 9 KB     | Config status, diagnostics, treasury/fee tracking                                                   | Simple read endpoints                           | **Stays Vercel (lightweight utility)**                                                                       |

4\. Target Architecture

The migration moves each component to the runtime where it naturally performs best, producing four clear layers:

4.1 Layer Map

|                        |                                          |                                                                                                                                                           |
| ---------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Layer**              | **Runtime**                              | **What Lives Here**                                                                                                                                       |
| **Frontend API**       | Vercel (5–6 functions)                   | Queue/inbox CRUD, actions CRUD, entity-hub, admin, domains, apply-change, diagnostics — the endpoints the browser calls directly                          |
| **Intelligence Layer** | Supabase Edge Functions                  | Context Broker (packet assembly, cache, quality scoring), AI chat, template drafting, daily briefing assembly                                             |
| **Ingestion Layer**    | Supabase Edge Functions + Power Automate | Outlook intake, RCM ingest, LoopNet ingest, listing webhooks, email/calendar sync — everything that receives external events and writes to Supabase       |
| **Scheduled Jobs**     | Supabase pg\_cron + Edge Functions       | Nightly briefing pre-assembly, cross-domain matching, engagement scoring, template performance, pipeline velocity, signal calibration, outcome resolution |

4.2 What Changes for Each Current Function

operations.js — The Big Split

This 166KB file gets decomposed into its natural components:

  - **Context Broker routes** (/api/context) → Supabase Edge Function: context-broker. Packet assembly, cache management, invalidation, nightly pre-assembly, weekly intelligence report. This is the highest-value move — the broker queries Supabase tables and should live next to them.

  - **Chat / Copilot routes** (/api/chat, /api/copilot-spec, /api/copilot-manifest) → Supabase Edge Function: copilot-chat. AI reasoning with packet injection. Already calls a Supabase Edge Function (ai-copilot) today — this collapses the indirection.

  - **Template draft routes** (/api/draft) → Supabase Edge Function: template-service. Draft generation, batch drafts, send recording, listing-BD pipeline, template health evaluation.

  - **Bridge + workflow orchestration** (remaining ?action= routes) → Stays in Vercel as a leaner operations.js (\~30KB). These are frontend-triggered workflow mutations that benefit from Vercel’s auth patterns.

sync.js — Ingestion Unbundling

This 123KB file handles too many unrelated concerns:

  - **RCM ingest, LoopNet ingest, listing webhook** → Supabase Edge Functions (one per ingest type). Power Automate posts directly to these endpoints. No Vercel hop needed.

  - **Cross-domain match** → Supabase pg\_cron job + database function. This is a batch SQL operation that matches contacts across Gov and Dia databases. It should never have been a serverless function.

  - **Connector management** → Stays in Vercel (admin/config CRUD).

  - **Email/calendar/SF sync** → Supabase Edge Function: sync-orchestrator. Called by Power Automate on schedule or by manual trigger.

data-proxy.js — Elimination

This function exists because the frontend needs a single API origin to query Gov and Dia Supabase instances with server-side keys. The fix is Supabase Edge Functions with proper RLS policies or a thin service-key proxy Edge Function. The frontend calls Supabase Edge Functions directly; data-proxy.js is retired entirely.

daily-briefing.js — Move to Supabase

The briefing aggregator queries all three Supabase databases, assembles a snapshot, and returns it. This is a read-heavy orchestration that belongs next to the data. It becomes a Supabase Edge Function called on-demand by the frontend and pre-assembled nightly by pg\_cron.

intake.js — Move to Supabase

Outlook message intake receives Power Automate webhooks and writes to OPS Supabase. This round-trips through Vercel for no reason. The Edge Function receives the webhook directly and writes to Supabase locally.

5\. What Stays in Vercel

After migration, Vercel serves the frontend and hosts 5–6 lean API functions that the browser calls directly:

|                 |          |                                                                                    |
| --------------- | -------- | ---------------------------------------------------------------------------------- |
| **Function**    | **Size** | **Role**                                                                           |
| queue.js        | \~38 KB  | Queue views + inbox CRUD — the primary frontend work surface                       |
| actions.js      | \~13 KB  | Action item lifecycle — create, update, transition, activity log                   |
| entity-hub.js   | \~3.5 KB | Thin router to entity handlers (contacts, search, property context)                |
| operations.js   | \~30 KB  | Slimmed: bridge actions + workflow mutations only (no chat, no context, no drafts) |
| admin.js        | \~16 KB  | Workspace admin, members, feature flags                                            |
| apply-change.js | \~10 KB  | Audited domain write service — policy enforcement stays in LCC                     |

Total: **6 functions**, with headroom for 6 more. domains.js and diagnostics.js can also remain if convenient, bringing the total to 8 of 12 — well under the limit, with no routing hacks needed.

6\. What Moves to Supabase Edge Functions

You already have a Supabase Edge Function running (ai-copilot). These new Edge Functions follow the same pattern:

|                       |                                                                                                                                       |                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Edge Function**     | **Responsibility**                                                                                                                    | **Called By**                                                |
| **context-broker**    | Packet assembly, cache (in-memory or Supabase table), quality scoring, invalidation, nightly pre-assembly, weekly intelligence report | Frontend, Copilot chat, pg\_cron, Power Automate             |
| **copilot-chat**      | AI chat with packet injection, Copilot action dispatch, follow-up signals. Merges current ai-copilot + chat routes                    | Frontend, Teams, Copilot Studio (future)                     |
| **template-service**  | Draft generation, batch drafts, send recording, listing-BD pipeline, template health, revision suggestions                            | Frontend, Copilot chat                                       |
| **daily-briefing**    | Briefing snapshot assembly across all three databases. Replaces the 59KB Vercel function                                              | Frontend, pg\_cron (pre-assembly), Power Automate (delivery) |
| **intake-receiver**   | Outlook message intake, entity linking, signal writing. Replaces intake.js                                                            | Power Automate                                               |
| **lead-ingest**       | RCM ingest, LoopNet ingest, listing webhooks. Replaces sync.js ingest sub-routes                                                      | Power Automate                                               |
| **data-query**        | Gov/Dia read proxy with allowlisting. Replaces data-proxy.js. Frontend calls this directly                                            | Frontend                                                     |
| **sync-orchestrator** | Email/calendar/SF sync coordination, connector-scoped sync runs                                                                       | Power Automate, manual trigger                               |

7\. Scheduled Jobs (pg\_cron)

These are pure database operations or nightly aggregations that should run inside Postgres:

|                               |              |                                                                                   |
| ----------------------------- | ------------ | --------------------------------------------------------------------------------- |
| **Job**                       | **Schedule** | **Implementation**                                                                |
| Engagement scoring refresh    | 2:00 AM      | SQL function in OPS database — aggregates signals into contact\_engagement scores |
| Scoring calibration           | 3:00 AM      | SQL function — compares AI predictions to actual user actions                     |
| Template performance          | 3:30 AM      | SQL function — open rates, reply rates, edit distances per template               |
| Pipeline velocity (weekly)    | 4:00 AM Sun  | SQL function — stage conversion rates, days-per-stage metrics                     |
| Outcome resolution            | 4:00 AM      | SQL function — resolves pending signal outcomes                                   |
| Briefing pre-assembly         | 6:00 AM      | pg\_cron calls daily-briefing Edge Function to cache fresh briefing packet        |
| Cross-domain match            | 1:00 AM      | SQL function — matches contacts across Gov + Dia databases by name/email          |
| Overdue OM follow-up flagging | Every 4h     | SQL function — flags deals needing follow-up                                      |

8\. Power Automate Routing Changes

Power Automate currently sends all webhooks to Vercel endpoints. After migration, it sends them directly to Supabase Edge Functions:

|                         |                                    |                                               |
| ----------------------- | ---------------------------------- | --------------------------------------------- |
| **Flow**                | **Current Target**                 | **New Target**                                |
| Outlook message intake  | Vercel /api/intake-outlook-message | **Supabase Edge: intake-receiver**            |
| RCM email notifications | Vercel /api/rcm-ingest             | **Supabase Edge: lead-ingest?source=rcm**     |
| LoopNet inquiry emails  | Vercel /api/loopnet-ingest         | **Supabase Edge: lead-ingest?source=loopnet** |
| SF deal listing webhook | Vercel /api/listing-webhook        | **Supabase Edge: lead-ingest?source=listing** |
| Daily briefing delivery | Vercel /api/daily-briefing         | **Supabase Edge: daily-briefing**             |
| Email/Calendar/SF sync  | Vercel /api/sync                   | **Supabase Edge: sync-orchestrator**          |

*Authentication: Power Automate flows continue using the PA\_WEBHOOK\_SECRET header pattern. Supabase Edge Functions validate the same secret.*

9\. Migration Sequence

The migration is sequenced to minimize risk. Each phase is independently deployable and reversible. At no point does the frontend break.

Phase 0: Foundation (Week 1)

**Goal:** Establish the Supabase Edge Function infrastructure and shared modules.

  - Deploy a shared auth module for Edge Functions that validates PA\_WEBHOOK\_SECRET and (future) Supabase JWT tokens

  - Deploy a shared Supabase client module (equivalent to ops-db.js) for Edge Functions

  - Deploy a shared signals module for Edge Functions (equivalent to \_shared/signals.js)

  - Deploy a health-check Edge Function and verify the infrastructure works end-to-end

  - **Validation:** Health check returns 200 from Supabase Edge. No production changes.

Phase 1: Context Broker (Week 2–3)

**Goal:** Move the highest-value intelligence layer to Supabase Edge.

  - Port Context Broker routes from operations.js to context-broker Edge Function

  - Implement packet caching in a Supabase table (context\_packet\_cache) with TTLs

  - Add packet\_quality\_score computation (coverage, staleness, conflict resolution metrics)

  - Update vercel.json: /api/context rewrites to Supabase Edge URL instead of operations.js

  - Remove Context Broker code from operations.js

  - **Validation:** Packet assembly latency \< 2s. Cache hit rates \> 60% after warm-up. operations.js drops from 166KB to \~120KB.

Phase 2: Ingestion Layer (Week 3–4)

**Goal:** Move all webhook receivers out of Vercel.

  - Deploy intake-receiver Edge Function (Outlook message intake)

  - Deploy lead-ingest Edge Function (RCM, LoopNet, listing webhook)

  - Update Power Automate flows to point to new Supabase Edge endpoints

  - Keep Vercel endpoints alive as fallbacks for 1 week, logging hits to verify zero traffic

  - Remove intake.js and sync.js ingest routes from Vercel after verification

  - **Validation:** Intake records appear in OPS with correct entity links. No duplicate ingestion. Vercel fallback endpoints show zero traffic.

Phase 3: Intelligence Services (Week 4–5)

**Goal:** Move AI chat and template services to Supabase Edge.

  - Deploy copilot-chat Edge Function (merges ai-copilot + operations.js chat routes)

  - Deploy template-service Edge Function (draft generation, batch, send recording, listing-BD)

  - Update frontend chat endpoint to call Supabase Edge directly

  - Remove chat and draft routes from operations.js

  - **Validation:** Chat responses include packet-grounded context. Template drafts generate correctly. operations.js drops to \~30KB (bridge + workflow actions only).

Phase 4: Data Layer Cleanup (Week 5–6)

**Goal:** Eliminate unnecessary proxying and move briefing/sync to Supabase.

  - Deploy data-query Edge Function (Gov/Dia read proxy with allowlisting)

  - Deploy daily-briefing Edge Function

  - Deploy sync-orchestrator Edge Function

  - Update frontend to call Supabase Edge for data queries and briefing

  - Update Power Automate to call daily-briefing and sync-orchestrator on Supabase Edge

  - Retire data-proxy.js, daily-briefing.js, and sync.js ingestion/sync routes from Vercel

  - **Validation:** Frontend loads Gov/Dia data with equal or lower latency. Daily briefing assembles correctly. Vercel function count drops to 6–8.

Phase 5: Scheduled Jobs (Week 6–7)

**Goal:** Move nightly analytics to pg\_cron where they belong.

  - Write SQL functions for engagement scoring, calibration, template performance, pipeline velocity, outcome resolution

  - Configure pg\_cron schedules in OPS Supabase

  - Add briefing pre-assembly cron job (calls daily-briefing Edge Function at 6 AM)

  - Add cross-domain match SQL function + cron job

  - **Validation:** Nightly jobs complete within their windows. Signal tables populate correctly. Briefing cache is fresh by 6:30 AM.

10\. Risk Mitigation

  - **Parallel running.** Each phase keeps the Vercel endpoint alive as a fallback for at least one week after the Supabase Edge equivalent is deployed. Traffic is monitored; the Vercel endpoint is only retired after confirming zero hits.

  - **Feature flags.** The frontend’s existing feature flag system (admin.js flags) gates which backend each endpoint calls. Flipping a flag rolls back to Vercel instantly.

  - **No big bang.** Each phase is independently deployable. If Phase 2 hits a problem, Phase 1 is already live and stable. The system is always in a working state.

  - **Shared auth module.** The same PA\_WEBHOOK\_SECRET validation pattern is used in both Vercel and Supabase Edge, so Power Automate flows work identically against either.

  - **Monitoring.** Each Supabase Edge Function logs response times and error rates. The existing signals.js pattern captures performance signals for both runtimes during the transition.

11\. What This Unlocks

Beyond cleaning up the architecture, this migration creates concrete new capabilities:

  - **Context Broker goes live.** The most important unbuilt component in the blueprint gets a proper home with sub-2-second packet assembly, caching, and quality scoring.

  - **Copilot agent readiness.** With the Context Broker running on Supabase Edge, Copilot Studio agents (or any AI surface) can request packets via a clean API. The blueprint’s Wave 1–2 agents become deployable.

  - **Write Proposal Contract.** With the orchestration layer cleaned up, implementing Copilot’s recommended Write Proposal Contract becomes straightforward — proposals flow through the lean operations.js and apply-change.js on Vercel.

  - **Headroom for growth.** Vercel drops to 6–8 functions with room for 4–6 more. Supabase Edge Functions have no count limit. New capabilities no longer require routing hacks.

  - **Lower latency.** Data queries, packet assembly, and ingestion all skip the Vercel→Supabase round trip. Briefing assembly runs next to the data.

  - **Cleaner Microsoft integration.** Power Automate flows write directly to Supabase Edge — one hop instead of two. This is the “Microsoft Boundary Layer” that Copilot’s review recommended, implemented simply.

12\. Cost Impact

This migration has minimal cost impact:

  - **Vercel:** Stays on Hobby plan (free). Fewer functions means lower compute usage.

  - **Supabase:** Edge Functions are included in the Pro plan you’re already on. Additional Edge Function invocations are $2/million. At your current scale, this is negligible.

  - **Power Automate:** No change — same flows, different webhook URLs.

  - **No new services.** No Azure, no Redis, no new infrastructure. The entire migration uses services you’re already paying for.

13\. Blueprint Alignment Check

After migration, each layer matches the blueprint’s design:

|                                           |                                                                                                                                        |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Blueprint Principle**                   | **How Migration Achieves It**                                                                                                          |
| **LCC = orchestration shell**             | Vercel hosts only frontend-serving CRUD and workflow orchestration. No data proxying, no AI reasoning, no ingestion.                   |
| **Context Broker as sacred boundary**     | Runs as a dedicated Supabase Edge Function with its own caching, quality scoring, and invalidation — not crammed into a mega-function. |
| **Copilot is stateless per interaction**  | copilot-chat Edge Function receives packets from Context Broker, reasons, and returns. No state retained.                              |
| **Every AI output emits a signal**        | Signal writing happens in the same Supabase instance — no cross-service signal loss.                                                   |
| **Domain backends own domain logic**      | Gov and Dia Supabase instances remain authoritative. apply-change.js on Vercel enforces policy. No change.                             |
| **Microsoft is a surface, not the brain** | Power Automate remains thin plumbing — webhooks in, notifications out. Intelligence stays in Supabase Edge + LCC.                      |

*End of Document*
