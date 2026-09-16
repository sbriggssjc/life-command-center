<!-- Converted 2026-09-16 by Cowork from the root file `LCC_Architecture_Gap_Analysis.docx` (pandoc, gfm) so that repo tools and Claude Code can read it. The .docx stays at the repo root (REPO1 decision: cited from audit/); this Markdown is the readable copy, NOT a new source of truth — its claims carry the original's date. -->

**LCC Copilot Architecture**

Gap Analysis & Build Roadmap

April 6, 2026 | v1.1 Amended Blueprint | Prepared for Scott Briggs

**Executive Summary**

This document maps the four new architectural specifications — Context Broker API, Context Packet Schema, Signal Table Schema, and Template Library — against the existing LCC codebase to identify what's built, what's partially built, and what's entirely new work. The analysis is organized by the wave-based rollout plan defined in the amended Copilot Operating System Blueprint (v1.1).

**Key finding:** The LCC codebase has strong foundations (entity model, work queues, domain proxy, intake pipeline, daily briefing v1, AI chat). But the entire intelligence layer — Context Broker, packet assembly, signal capture, template engine, and learning loop — is unbuilt. These four new specs define that layer completely. The critical path runs through deploying the signal and packet tables (Wave 0), then building the Context Broker MVP within the Vercel 12-function constraint (Wave 1).

**Architecture: What Changed in v1.1**

The amended blueprint introduces a new Layer B (Intelligence Layer) between the domain execution engines and the orchestration layer. Four new specs define this layer:

**Context Broker API Spec —** Defines the /api/context microservice with assemble, assemble-multi, invalidate, status, and health endpoints. This is the single gateway for all AI context. No AI surface queries domain databases directly.

**Context Packet Schema —** Defines 7 packet types (Contact, Property, Pursuit, Deal, Daily Briefing, Listing Marketing, Comp Analysis) with full JSON schemas, token budgets, TTLs, invalidation triggers, and compression rules.

**Signal Table Schema —** Defines 6 database tables (signals, scoring\_calibration, contact\_engagement, template\_performance, pipeline\_velocity, outreach\_effectiveness) plus 7 nightly jobs that power the self-learning loop.

**Template Library Spec —** Defines 10 email templates (T-001 through T-010) with explicit packet variable bindings, versioning rules, performance targets, and the template\_sends tracking table.

The key new build rule (§9.5): No AI feature ships without a defined context packet binding and a defined signal for measuring effectiveness.

**What's Already Built**

These components are deployed and operational. They form the foundation the new intelligence layer builds on.

|                                |                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------ |
| **Component**                  | **Status & Notes**                                                             |
| **Canonical Entity Model**     | Contacts, entities, relationships, external identities — 003 migration         |
| **Work Queue + Inbox**         | inbox\_items, action\_items, activity\_events, research\_tasks — 004 migration |
| **Domain Registry**            | domains, domain\_data\_sources, domain\_entity\_mappings — 005 migration       |
| **Multi-Workspace Foundation** | workspaces, users, workspace\_memberships — 001 migration                      |
| **Connector Management**       | connector\_accounts, sync\_jobs, sync\_errors — 002 migration                  |
| **Watchers + Escalation**      | watchers, escalations, manager views — 008 migration                           |
| **Daily Briefing (v1)**        | daily-briefing.js aggregation — needs refactor to packet schema                |
| **AI Copilot Chat (v1)**       | ai.js + /api/chat route — needs packet injection                               |
| **Outlook Intake**             | intake.js + Power Automate webhook — operational                               |
| **Gov/Dia Data Proxy**         | data-proxy.js with allowlist — operational                                     |
| **Action Registry (Spec)**     | copilot\_action\_registry.md + .json — documented, not runtime                 |
| **Agent Catalog (Spec)**       | copilot\_agent\_catalog.md — documented, not runtime                           |
| **RLS Policies**               | 006 migration — deployed but auth not enforced on frontend                     |
| **Frontend PWA**               | app.js, gov.js, dialysis.js, detail.js, ops.js — operational                   |

**Critical Constraint: Vercel 12-Function Ceiling**

The LCC app runs on Vercel Hobby Plan with a hard limit of 12 serverless functions. All 12 slots are currently occupied. **The Context Broker needs API endpoints but cannot add new .js files to /api/.**

Two viable strategies exist:

**Option A — Sub-route consolidation:** Add /api/context routes as sub-routes under an existing function (e.g., operations.js using ?\_route=context-assemble). This keeps everything on Vercel but increases file complexity.

**Option B — Supabase Edge Functions:** Deploy the Context Broker as Supabase Edge Functions co-located with the LCC database. This bypasses the Vercel limit entirely, reduces latency for cache lookups, and aligns with the broker's stateless design. This is the recommended approach.

**Full Gap Matrix by Wave**

Each row represents a component defined in the new specs that does not yet exist (or is only partially built) in the current codebase.

**Wave 0 — Foundations (Deploy Immediately)**

|                                 |               |                                                                                                                                                  |            |          |
| ------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | -------- |
| **Component**                   | **Status**    | **What to Build**                                                                                                                                | **Effort** | **Risk** |
| **Signal Table (signals)**      | **NOT BUILT** | Deploy as migration 019. Seed pipeline\_velocity with historical averages. This is foundational — nothing in the learning loop works without it. | Small      | Low      |
| **Context Packets Cache Table** | **NOT BUILT** | Deploy as migration 020 alongside signals. Required before Context Broker can cache anything.                                                    | Small      | Low      |
| **Template Sends Table**        | **NOT BUILT** | Deploy as migration 021. Needed before any template performance tracking is possible.                                                            | Small      | Low      |

**Wave 1 — Highest ROI**

|                                          |               |                                                                                                                                                                                                                                                     |            |                                                              |
| ---------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------ |
| **Component**                            | **Status**    | **What to Build**                                                                                                                                                                                                                                   | **Effort** | **Risk**                                                     |
| **Context Broker MVP**                   | **NOT BUILT** | Build as sub-routes under a new consolidated /api/context.js (requires retiring or merging one existing function) OR deploy as Supabase Edge Function to avoid Vercel limit. Contact + Daily Briefing packets first.                                | Large      | High — Vercel 12-function ceiling is the critical constraint |
| **Contact Packet Assembly**              | **NOT BUILT** | Implement as \_handlers/context-assemblers/contact.js. Wire to Context Broker assemble endpoint.                                                                                                                                                    | Medium     | Medium — depends on Salesforce + Graph API connectivity      |
| **Daily Briefing Packet Assembly**       | **PARTIAL**   | Refactor daily-briefing.js output to conform to Daily Briefing Packet schema. Add strategic/important/urgent ranking. Wire packet write to context\_packets table. Add carry\_forward logic.                                                        | Medium     | Medium                                                       |
| **Template Library (Initial Templates)** | **NOT BUILT** | Create templates table or JSON config in LCC. Implement draft generation engine that takes a packet + template ID → populated draft. Start with T-001 (First Touch), T-002 (Cadence Follow-Up), T-004 (Listing Announcement), T-006 (OM Follow-Up). | Medium     | Low                                                          |
| **Packet-Bound Email Drafting**          | **NOT BUILT** | Extend ai.js to accept packet payloads and format context injection blocks. Wire to template draft generation. Build Outlook compose integration via Power Automate.                                                                                | Medium     | Medium                                                       |
| **Signal Write on Triage**               | **NOT BUILT** | Add signal write to triage\_inbox\_item action. Capture AI vs. user classification for training data.                                                                                                                                               | Small      | Low                                                          |

**Wave 2 — Human-in-the-Loop Execution**

|                                     |               |                                                                                                                                                  |            |                                                    |
| ----------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | -------------------------------------------------- |
| **Component**                       | **Status**    | **What to Build**                                                                                                                                | **Effort** | **Risk**                                           |
| **Property Packet Assembly**        | **NOT BUILT** | Implement as \_handlers/context-assemblers/property.js. Requires allowlist expansion for comp tables.                                            | Medium     | Medium                                             |
| **Pursuit Packet Assembly**         | **NOT BUILT** | Implement as \_handlers/context-assemblers/pursuit.js. Depends on Property + Contact assemblers being complete.                                  | Medium     | Low                                                |
| **Comp Analysis Packet Assembly**   | **NOT BUILT** | Implement as \_handlers/context-assemblers/comp-analysis.js. Leverage existing BOV skill comp logic.                                             | Medium     | Low                                                |
| **Cache Invalidation Event Wiring** | **NOT BUILT** | Add invalidation hooks to existing action handlers (entity-hub, operations, queue, sync). Start with deal\_stage\_change and touchpoint\_logged. | Medium     | Medium — cross-cutting concern touching many files |
| **Template Performance Tracking**   | **NOT BUILT** | Build as Supabase scheduled function or cron. Wire to template\_performance table.                                                               | Small      | Low                                                |
| **Listing Marketing Packet**        | **NOT BUILT** | Implement assembler. Depends on buyer tracking data existing in LCC DB.                                                                          | Medium     | Medium — buyer tracking tables may not exist yet   |

**Wave 3 — Scale Workflows**

|                                         |               |                                                                                                    |            |          |
| --------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------- | ---------- | -------- |
| **Component**                           | **Status**    | **What to Build**                                                                                  | **Effort** | **Risk** |
| **Deal Packet Assembly**                | **NOT BUILT** | Implement assembler with sub-request pattern for embedded Contact Packets.                         | Large      | Medium   |
| **Nightly Learning Loop Jobs (6 jobs)** | **NOT BUILT** | Implement as Supabase Edge Functions with pg\_cron scheduling.                                     | Large      | Medium   |
| **Full Invalidation Event Wiring**      | **NOT BUILT** | Complete remaining invalidation hooks. Add force\_refresh for critical-date-within-3-days.         | Medium     | Low      |
| **Context Broker Monitoring**           | **NOT BUILT** | Build monitoring queries against signals table. Add health endpoint. Wire alerts to Teams webhook. | Medium     | Low      |

**Critical Path: What to Build Next**

The following sequence represents the dependency-ordered critical path. Each step unlocks the next.

**Step 1 — Deploy Signal + Packet + Template Tables (Week 1)**

Create migrations 019-021 deploying the 8 new tables from signal\_table\_schema.sql, context\_packet\_schema.md §5, and template\_library\_spec.md §4. Seed pipeline\_velocity with the historical averages in the SQL file. This is pure schema work with zero risk to existing functionality.

**Step 2 — Decide Context Broker Deployment Strategy (Week 1)**

Resolve the Vercel 12-function constraint. Recommendation: deploy Context Broker as Supabase Edge Functions. This avoids touching the Vercel function ceiling, co-locates cache lookups with the database, and gives the broker its own scaling profile. Alternative: sub-route under operations.js.

**Step 3 — Build Contact Packet Assembler (Weeks 2-3)**

The Contact Packet is the most-consumed packet type — used by prospecting, email drafting, pre-call briefs, and embedded in nearly every other packet. Build the assembler that queries LCC contacts, touchpoints, Salesforce, domain DBs, and Graph API in parallel. Implement compression rules. Write to context\_packets cache.

**Step 4 — Refactor Daily Briefing to Packet Schema (Weeks 2-3)**

The existing daily-briefing.js is the closest thing to a working packet assembler. Refactor its output to conform to the Daily Briefing Packet schema: add strategic/important/urgent ranking, production\_score computation, overnight\_signals, and carry\_forward. Wire it to write to context\_packets table.

**Step 5 — Build Template Draft Engine (Weeks 3-4)**

Implement 4 initial templates (T-001 First Touch, T-002 Cadence Follow-Up, T-004 Listing Announcement, T-006 OM Follow-Up) with variable binding to Contact Packets. Build the draft generation engine that takes packet + template → populated email. Wire to ai.js for context injection formatting.

**Step 6 — Wire Signal Capture to Existing Actions (Weeks 3-4)**

Add signal writes to: triage\_inbox\_item (triage\_decision signal), promote\_intake\_to\_action, touchpoint logging, and deal stage changes. These are lightweight additions to existing action handlers that begin accumulating training data immediately.

**Dependency Map**

The arrows below show build dependencies. Items at the same level can be built in parallel.

|                         |                            |                              |                             |                           |                           |
| ----------------------- | -------------------------- | ---------------------------- | --------------------------- | ------------------------- | ------------------------- |
| **Week 1**              | **Week 1**                 | **Weeks 2-3**                | **Weeks 2-3**               | **Weeks 3-4**             | **Weeks 3-4**             |
| **Signal Tables (019)** | **Broker Deploy Decision** | **Contact Packet Assembler** | **Daily Briefing Refactor** | **Template Draft Engine** | **Signal Capture Wiring** |
| Packet Cache (020)      |                            | Depends: 019, 020, Broker    | Depends: 019, 020           | Depends: Contact Packet   | Depends: 019              |
| Template Sends (021)    |                            |                              |                             | Depends: 021              |                           |

**Summary**

|                                |                                                               |
| ------------------------------ | ------------------------------------------------------------- |
| **Metric**                     | **Count**                                                     |
| **Components already built**   | 14                                                            |
| **Components NOT BUILT**       | 19                                                            |
| **Components PARTIAL**         | 1 (Daily Briefing)                                            |
| **New database tables needed** | 8                                                             |
| **New nightly jobs needed**    | 7                                                             |
| **Highest-risk item**          | Context Broker deployment (Vercel 12-fn limit)                |
| **Recommended first action**   | Deploy migrations 019-021 (signal + packet + template tables) |

All four new specifications have been saved to docs/architecture/ in the LCC repository. The original Copilot Operating System Blueprint has been preserved and the v1.1 amended version saved alongside it.
