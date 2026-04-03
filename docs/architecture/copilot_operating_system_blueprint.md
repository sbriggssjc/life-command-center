---
title: Copilot Operating System Blueprint
status: draft
owner: Team Briggs / LCC
last_updated: 2026-04-02
---

## Related Documents
- [Copilot Action Registry](./copilot_action_registry.md)
- [Copilot Wave 1 Build Plan](./copilot_wave1_build_plan.md)
- [Copilot Agent Catalog](./copilot_agent_catalog.md)

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

Our mission is to build a market-leading, easier-to-work-with platform and service experience that creates a “Disney” / “Easy Button” outcome for clients while helping the team scale production intelligently. See the mission statement, business plan, and team structure documents for the underlying strategy and activity expectations.

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

The system should be structured in three layers:

#### Layer A — Domain Execution Engines
These are the authoritative backend systems for domain-specific ingestion, queueing, review, matching, promotion, and domain writes.

- **GovernmentProject**
  - authoritative government-domain ingestion and write engine
  - staged intake, evidence/research handling, review queues, canonical writes

- **DialysisProject**
  - authoritative dialysis-domain ingestion and write engine
  - staged intake, review queues, promotions, alerts, clinic history, reporting

#### Layer B — Orchestration and Interaction Layer
- **life-command-center (LCC)**
  - primary Copilot-facing orchestration layer
  - cross-repo router
  - human workflow surface
  - action registry owner
  - queue/review/approval hub
  - daily operations hub

#### Layer C — Microsoft Interaction Layer
The system should surface capabilities into Microsoft tools where work naturally happens:
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

### 4.2 GovernmentProject owns
- government-domain ingestion logic
- government staged intake workflows
- evidence/research artifact logic
- government review and write services
- authoritative government business rules

### 4.3 DialysisProject owns
- dialysis-domain ingestion logic
- dialysis staged intake workflows
- pending review and promotion logic
- dialysis alerts/history/reporting
- authoritative dialysis business rules

### 4.4 Copilot does NOT own
- direct domain write logic
- direct service-role database mutation
- duplicated extraction/matching logic
- business-rule authority

Copilot should orchestrate and facilitate, not replace the systems of record.

---

## 5. Revenue Workflow Map

The Copilot operating system should align to the real production chain.

### 5.1 Source
Goal:
- identify new opportunities
- maintain prospecting cadence
- generate touchpoints
- monitor target categories and ownership opportunities

High-value support:
- target account summaries
- daily call sheets
- owner/developer intelligence
- outreach drafting
- touchpoint reminders
- trigger-based prospecting workflows

### 5.2 Secure
Goal:
- turn opportunities into exclusive listings

High-value support:
- pricing analysis dossier assembly
- BOV / proposal drafting support
- comp and market intelligence packaging
- pre-meeting and pre-call summaries
- assignment workflow tracking

### 5.3 Market
Goal:
- maximize listing velocity and sale proceeds

High-value support:
- launch email drafting
- buyer segmentation and outreach
- OM and activity summary generation
- seller weekly reporting
- OM download follow-up support
- cross-pollination opportunities

### 5.4 Execute
Goal:
- move deals to close with fewer mistakes and better communication

High-value support:
- critical date tracking
- diligence summaries
- client update drafting
- deal task reminders
- internal execution checklists

### 5.5 Repeat / Compound
Goal:
- turn execution and market intelligence into stronger future listing wins

High-value support:
- relationship memory
- CRM notes and touchpoint summaries
- post-close follow-up workflows
- market-share intelligence
- account development plans

---

## 6. Microsoft App Strategy

### Outlook
Use for:
- email ingestion
- prospecting and follow-up drafting
- client communication drafting
- submission into domain intake flows
- seller and buyer communication acceleration

### Teams
Use for:
- daily briefings
- queue triage
- approvals
- war-room collaboration
- command and control for Copilot actions
- ops and alert surfaces

### Power Automate
Use for:
- event-driven glue between Microsoft apps and backend systems
- Outlook → LCC/domain ingestion
- Teams notifications
- Planner task creation
- CRM and file automation
- recurring runbooks

### Planner / To Do
Use for:
- follow-up tasks
- listing pursuit checklists
- transaction execution tasks
- review-required assignments

### Excel
Use for:
- exports
- comp review
- seller reports
- KPI packs
- analyst workflows
- structured data handoff where spreadsheet interaction is still useful

### Word / PowerPoint
Use for:
- valuation analyses
- disposition proposals
- listing collateral support
- client-ready content drafting

### SharePoint / OneDrive
Use for:
- source file storage
- deliverable repositories
- versioned working files
- structured access to shared documents

### Salesforce
Use for:
- relationship and opportunity record
- touchpoint memory
- pipeline visibility
- account and lead tracking

---

## 7. Core Copilot Agents

We should start with a small set of high-leverage agents.

### 7.1 Daily Briefing Agent
Purpose:
- tell each user what matters today

Inputs:
- queue items
- tasks
- recent alerts
- active deal milestones
- due follow-ups
- staged intake review items
- CRM/touchpoint context

Outputs:
- daily priorities
- “who to call”
- “what needs approval”
- “what is late”
- “what changed”

Primary surfaces:
- Teams
- Outlook digest
- LCC dashboard

### 7.2 Intake & Triage Agent
Purpose:
- turn incoming emails/files into structured operational items

Inputs:
- Outlook messages
- attachments
- screenshots
- forwarded research
- Power Automate triggers

Outputs:
- staged intake records
- queue summaries
- suggested next action
- assignment routing

Primary surfaces:
- Outlook
- Power Automate
- LCC
- domain backends

### 7.3 Prospecting Agent
Purpose:
- help brokers maintain high-quality outbound activity

Inputs:
- account/owner records
- touchpoint history
- market/domain intelligence
- recent listings and closes
- books / target lists

Outputs:
- daily call sheet
- personalized draft emails
- call prep summaries
- follow-up reminders
- CRM logging suggestions

Primary surfaces:
- Outlook
- Teams
- Salesforce
- LCC

### 7.4 Listing Pursuit Agent
Purpose:
- help win assignments faster

Inputs:
- target asset context
- comps
- ownership history
- proposal templates
- prior interaction history

Outputs:
- listing pursuit dossier
- internal prep summary
- draft valuation/proposal language
- checklist of next actions

Primary surfaces:
- Teams
- Word
- PowerPoint
- Excel
- LCC

### 7.5 Marketing & Seller Reporting Agent
Purpose:
- improve listing execution and seller communication

Inputs:
- OM/download activity
- buyer engagement
- listing details
- communication history
- pipeline data

Outputs:
- weekly seller reports
- buyer follow-up drafts
- marketing-performance summaries
- recommended next outreach

Primary surfaces:
- Outlook
- Excel
- Teams
- LCC

### 7.6 Deal Execution Agent
Purpose:
- reduce execution drag and missed details

Inputs:
- opportunity/deal records
- transaction timelines
- diligence items
- calendar and tasks

Outputs:
- status summaries
- due-date reminders
- client update drafts
- issue escalation prompts

Primary surfaces:
- Teams
- Outlook
- Planner
- Calendar
- LCC

---

## 8. Action Design Rules

Every Copilot action must have:

1. **Owning system**
   - LCC
   - GovernmentProject
   - DialysisProject

2. **Category**
   - read/query
   - ingest/submit
   - review/resolve
   - notify/communicate
   - export/report
   - schedule/task
   - orchestrate
   - admin/ops

3. **Risk tier**
   - Tier 0: read-only
   - Tier 1: low-risk workflow mutation
   - Tier 2: review/assignment/status changes
   - Tier 3: domain write or approval-required operation
   - Tier 4: high-impact admin or financial / ownership mutation

4. **Confirmation policy**
   - none
   - lightweight confirmation
   - explicit human approval
   - admin-only approval

5. **Idempotency / auditability**
   - Every write-capable action must be retry-safe and traceable

6. **Microsoft surface**
   - where this action belongs operationally

---

## 9. Build Rules

### 9.1 We will not build for novelty
No integration gets built just because Microsoft offers it.

### 9.2 We will not duplicate backend logic
Copilot should call the existing systems of record.

### 9.3 We will not bypass review where judgment matters
Anything affecting:
- ownership
- financial fields
- canonical business records
- approval decisions
must remain governed and auditable.

### 9.4 We will favor leverage over comprehensiveness
Build the highest-ROI workflows first.

### 9.5 We will measure success in production outcomes
Examples:
- more listing opportunities surfaced
- more consistent touchpoints
- faster proposal turnaround
- faster seller reporting
- fewer dropped tasks
- cleaner pipeline visibility
- more closings / fee production leverage

---

## 10. Wave-Based Rollout Plan

### Wave 0 — Foundations
Build:
- LCC action registry
- action schema
- risk tiers
- confirmation policy
- routing map
- Microsoft surface map

### Wave 1 — Highest ROI
Build:
- Outlook ingestion to LCC/domain intake
- Teams daily briefing
- read-only queue / run / alert / status queries
- prospecting and seller-email drafting support
- CRM/touchpoint support workflows

### Wave 2 — Human-in-the-loop execution
Build:
- review and approval flows
- staged item requeue/retry/resolve
- listing pursuit checklist automation
- marketing and seller reporting support
- Planner/To Do task generation

### Wave 3 — Scale workflows
Build:
- broader prospecting cadence support
- automated seller-report packages
- deal execution assistant workflows
- domain-specific action packs
- more controlled, low-risk autonomous actions

### Wave 4 — Expansion
Build:
- additional verticals
- broader intelligence synthesis
- recurring strategic briefings
- more advanced agent behavior where justified

---

## 11. Immediate Deliverables

The next artifacts to create in LCC are:

1. `copilot_action_registry.md`
2. `copilot_action_schema.json` or `.yaml`
3. `copilot_wave1_build_plan.md`
4. `copilot_agent_catalog.md`

---

## 12. Success Metrics

We should evaluate the system by whether it improves:
- touchpoint consistency
- proposal / BOV turnaround time
- seller reporting efficiency
- queue resolution time
- task follow-through
- intake capture from Outlook/files
- CRM update quality
- active listing marketing responsiveness
- broker time spent on high-value activities
- overall listing-driven production

---

## 13. Governing Question For All Future Builds

Before approving any build, ask:

**Does this make the team more capable of sourcing, securing, marketing, executing, and compounding listing-driven production in a more intelligent, connected, and productive way?**

If not, it is not a priority.
