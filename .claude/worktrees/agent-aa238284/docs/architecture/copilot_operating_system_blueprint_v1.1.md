---
title: Copilot Operating System Blueprint
status: v1.1 — amended
owner: Team Briggs / LCC
last_updated: 2026-04-06
amendments: Added Context Broker to architecture, updated agent specs to include packet bindings, added cold-start instructions for pipeline velocity, updated wave plan.
---

## Related Documents
- [Copilot Action Registry](./copilot_action_registry.md)
- [Copilot Wave 1 Build Plan](./copilot_wave1_build_plan.md)
- [Copilot Agent Catalog](./copilot_agent_catalog.md)
- [Context Packet Schema](./context_packet_schema.md) ← NEW
- [Template Library Spec](./template_library_spec.md) ← NEW
- [Signal Table Schema](./signal_table_schema.sql) ← NEW
- [Context Broker API Spec](./context_broker_api_spec.md) ← NEW

---

# Copilot Operating System Blueprint

## Document Purpose

This document defines the operating blueprint for how Microsoft Copilot, Microsoft 365 apps, life-command-center (LCC), GovernmentProject, and DialysisProject should work together as one intelligent brokerage operating system.

It is the governing strategy document for all future AI, Copilot, workflow, app, and automation build decisions.

---

## 1. Single Unifying Principle

Every build request, workflow, integration, automation, and AI feature must answer this question:

**How does this get us closer to building a more intelligent, connected, productive, listing-driven brokerage operating system that helps us win more exclusive sell-side assignments, market listings better, execute more efficiently, and close more deals?**

We do not connect Copilot or build apps for novelty.
We build only what creates leverage.

That leverage should improve one or more of the following:
- sourcing more listing opportunities
- increasing business development consistency and quality
- accelerating pricing analysis / BOV / proposal output
- improving listing marketing and seller reporting
- reducing manual process drag
- improving transaction execution and communication
- making knowledge, deal context, research, and workflows available at the point of action
- helping each broker, analyst, and operations team member produce more with less friction

---

## 2. Business Context

We are a net lease real estate brokerage team focused on commissioned real estate sales and closings.
Our engine is **sell-side, listing-driven production** in targeted categories, especially:
- government-leased assets
- dialysis / kidney care assets

Our mission is to build a market-leading, easier-to-work-with platform and service experience that creates a "Disney" / "Easy Button" outcome for clients while helping the team scale production intelligently.

Core revenue logic:
1. Source listing opportunities
2. Secure exclusive assignments
3. Market listings effectively
4. Execute transactions smoothly
5. Turn expertise and service into repeat and referral business

The operating system must support that full loop.

---

## 3. Architectural Thesis

### 3.1 High-level design

The system is structured in four layers:

#### Layer A — Domain Execution Engines
These are the authoritative backend systems for domain-specific ingestion, queueing, review, matching, promotion, and domain writes.

- **GovernmentProject**
  - authoritative government-domain ingestion and write engine
  - staged intake, evidence/research handling, review queues, canonical writes

- **DialysisProject**
  - authoritative dialysis-domain ingestion and write engine
  - staged intake, review queues, promotions, alerts, clinic history, reporting

#### Layer B — Intelligence Layer ← NEW
- **Context Broker**
  - assembles, caches, and serves context packets to all AI surfaces
  - the single source of structured intelligence for every AI-generated output
  - no AI surface queries domain databases directly — all context flows through the broker
  - see `context_broker_api_spec.md` for full specification

#### Layer C — Orchestration and Interaction Layer
- **life-command-center (LCC)**
  - primary Copilot-facing orchestration layer
  - cross-repo router
  - human workflow surface
  - action registry owner
  - queue/review/approval hub
  - daily operations hub
  - template library and draft engine
  - signal capture and learning loop owner

#### Layer D — Microsoft Interaction Layer
The system surfaces capabilities into Microsoft tools where work naturally happens:
- Outlook
- Teams
- Power Automate
- Planner / To Do
- Excel
- Word / PowerPoint
- SharePoint / OneDrive
- Salesforce-connected workflows where appropriate

---

## 4. System Ownership Boundaries

### 4.1 LCC owns
- Copilot entry point
- conversational orchestration
- action registry
- action risk tiers and confirmation rules
- cross-repo routing
- queue/review UX
- daily briefing UX
- human-in-the-loop approvals
- Microsoft app integration policy
- Context Broker (hosts and maintains)
- Template Library (owns schemas, versions, and performance tracking)
- Signal table (owns learning loop data)

### 4.2 Context Broker owns ← NEW
- packet assembly logic for all packet types
- cache management (TTL, invalidation, rebuild)
- token budget enforcement
- context injection formatting for AI surfaces
- assembly monitoring and observability

### 4.3 GovernmentProject owns
- government-domain ingestion logic
- government staged intake workflows
- evidence/research artifact logic
- government review and write services
- authoritative government business rules

### 4.4 DialysisProject owns
- dialysis-domain ingestion logic
- dialysis staged intake workflows
- pending review and promotion logic
- dialysis alerts/history/reporting
- authoritative dialysis business rules

### 4.5 Copilot does NOT own
- direct domain write logic
- direct service-role database mutation
- duplicated extraction/matching logic
- business-rule authority
- direct database queries for AI context (must flow through Context Broker)

---

## 5. Revenue Workflow Map

(Unchanged — see original document. Agents below have been updated to include packet bindings.)

---

## 6. Microsoft App Strategy

(Unchanged from original.)

---

## 7. Core Copilot Agents

Each agent now specifies its context packet binding. No agent constructs its own context — all context is requested from the Context Broker.

### 7.1 Daily Briefing Agent

**Context packet binding:** Daily Briefing Packet (assembled by 6:00 AM nightly job)

**Outputs:** daily priorities, call sheet, approvals needed, what's late, what changed

**Copilot system prompt receives:** Full Daily Briefing Packet injected at session start. On-demand entity queries trigger Context Broker calls mid-session.

### 7.2 Intake & Triage Agent

**Context packet binding:** Contact Packet for sender (if known), Deal Packet if deal-linked

**Key addition:** Every triaged item writes a `triage_decision` signal to the signal table, including `ai_classification`, `ai_confidence`, and `user_classification`. This is the primary training signal for the classification model.

### 7.3 Prospecting Agent

**Context packet binding:** Contact Packet + Pursuit Packet (if active pursuit) + Template Library

**Key addition:** All drafted outreach is bound to a specific template version. Edit distance is tracked on every send. Template performance feeds back to Template Library performance table.

**Cold start note:** On system launch, manually tag the last 6 months of sent prospecting emails with their approximate template category so the performance baseline is seeded before the automated tracking begins.

### 7.4 Listing Pursuit Agent

**Context packet binding:** Pursuit Packet + Comp Analysis Packet + Property Packet

**Key addition:** All BOV and proposal drafts are assembled using the Pursuit Packet + Comp Analysis Packet injected to the model. The comp selection logic (which comps to include, which to weight) is governed by the Comp Analysis Packet's `similarity_score` field, not manual selection.

### 7.5 Marketing & Seller Reporting Agent

**Context packet binding:** Listing Marketing Packet + Deal Packet

**Key addition:** Seller reports are auto-assembled from the `seller_report_data` block of the Listing Marketing Packet. The agent does not query deal data independently.

### 7.6 Deal Execution Agent

**Context packet binding:** Deal Packet

**Key addition:** Critical date alerts are driven by the Deal Packet's `critical_dates` block. Any date with `days_until < 7` and `status != completed` generates an automatic escalation to the daily briefing strategic queue.

---

## 8. Action Design Rules

(Unchanged from original — risk tiers, confirmation policy, idempotency rules all apply.)

---

## 9. Build Rules

### 9.1 We will not build for novelty
(Unchanged.)

### 9.2 We will not duplicate backend logic
(Unchanged. Added: We will not duplicate context assembly logic. All context flows through the Context Broker.)

### 9.3 We will not bypass review where judgment matters
(Unchanged.)

### 9.4 We will favor leverage over comprehensiveness
(Unchanged.)

### 9.5 We will not ship AI features without packet bindings ← NEW
No AI-generated output (email draft, summary, recommendation, report) is built without a defined context packet binding. If the packet for a feature doesn't exist, define the packet schema first.

### 9.6 We will measure success in production outcomes
(Unchanged.)

---

## 10. Wave-Based Rollout Plan

### Wave 0 — Foundations
Build:
- LCC action registry
- action schema, risk tiers, confirmation policy
- routing map, Microsoft surface map
- **Signal table schema** ← NEW: deploy immediately so signals begin accumulating
- **Pipeline velocity seed data** ← NEW: manually enter historical deal averages before Wave 1

### Wave 1 — Highest ROI
Build:
- Outlook ingestion to LCC/domain intake
- Teams daily briefing
- Read-only queue / run / alert / status queries
- **Context Broker MVP** ← NEW: Contact Packet and Daily Briefing Packet only
- Prospecting and seller-email drafting support (bound to Contact Packet + Template Library)
- CRM/touchpoint support workflows

### Wave 2 — Human-in-the-loop execution
Build:
- Review and approval flows
- Staged item requeue/retry/resolve
- Listing pursuit checklist automation
- **Context Broker: Property, Pursuit, and Comp Analysis Packets** ← NEW
- Marketing and seller reporting support (bound to Listing Marketing Packet)
- Planner/To Do task generation
- Template performance tracking (first 30-day performance review)

### Wave 3 — Scale workflows
Build:
- Broader prospecting cadence support
- Automated seller-report packages (bound to Deal + Listing Marketing Packets)
- Deal execution assistant workflows (bound to Deal Packet)
- **Context Broker: Deal Packet and full invalidation event wiring** ← NEW
- Domain-specific action packs
- Scoring calibration review and first model adjustment

### Wave 4 — Expansion
Build:
- Additional verticals
- Broader intelligence synthesis
- Recurring strategic briefings
- More advanced agent behavior where justified
- **Learning loop maturity: outreach effectiveness table populated, template A/B testing active** ← NEW

---

## 11. Immediate Deliverables

The next artifacts to create in LCC are:

1. `copilot_action_registry.md`
2. `copilot_action_schema.json` or `.yaml`
3. `copilot_wave1_build_plan.md`
4. `copilot_agent_catalog.md`
5. `context_packet_schema.md` ← COMPLETE
6. `template_library_spec.md` ← COMPLETE
7. `signal_table_schema.sql` ← COMPLETE
8. `context_broker_api_spec.md` ← COMPLETE

---

## 12. Success Metrics

(Unchanged from original — metrics remain the correct production-outcome measures.)

---

## 13. Governing Question For All Future Builds

Before approving any build, ask:

**Does this make the team more capable of sourcing, securing, marketing, executing, and compounding listing-driven production in a more intelligent, connected, and productive way?**

If not, it is not a priority.

**Secondary governing question (added):**

**Does this AI feature have a defined context packet binding and a defined signal for measuring its effectiveness?**

If not, define both before building.
