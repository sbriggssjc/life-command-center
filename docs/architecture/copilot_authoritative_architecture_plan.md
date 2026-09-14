# Authoritative Copilot Architecture & Rollout Plan

Date: 2026-04-02
Owner repo: life-command-center (LCC)
Purpose: Consolidated Copilot architecture across GovernmentProject, DialysisProject, and LCC.

## Executive decision

Microsoft Copilot should be added as the **entry point and orchestration layer**, not as a replacement for the existing backend logic.

- **LCC** should be the primary Copilot-facing layer for conversation, workflow routing, approvals, and Microsoft 365 integration.
- **GovernmentProject** should remain the authoritative backend for government-domain ingestion, staged intake, review queues, evidence workflows, and canonical write services.
- **DialysisProject** should remain the authoritative backend for dialysis-domain ingestion, staged intake, pending review, promotion, alerts, clinic history, and reporting.

## System roles

### life-command-center (LCC)
Primary responsibilities:
- Copilot chat entry point
- Cross-repo action router
- Human review and approval surface
- Daily operations hub across queues, inboxes, research, sync health, and tasks
- Microsoft 365-facing integration host

### GovernmentProject
Primary responsibilities:
- Government-domain staged intake and intake ops
- Evidence extraction/research artifact workflows
- Pending update resolution
- Canonical write services with provenance and propagation
- Pipeline orchestration and lifecycle maintenance

### DialysisProject
Primary responsibilities:
- Dialysis-domain ingestion and staged intake
- Pending review queue and research outcomes
- Promotion flows into alerts/history targets
- Ingestion tracking, run errors, critical alerts, and source health
- Operator dashboard and reporting surfaces

## Architecture pattern

### Control flow
1. User interacts through Copilot in Microsoft 365.
2. Copilot calls LCC action endpoints.
3. LCC validates permissions, policy, and confirmation requirements.
4. LCC routes the request to the appropriate repo/service:
   - GovernmentProject for government-domain execution
   - DialysisProject for dialysis-domain execution
5. Domain repo performs the authoritative action.
6. LCC records orchestration context, activity, and user-facing result.

### Boundary rule
- LCC orchestrates.
- GovernmentProject and DialysisProject execute domain logic.
- Copilot never duplicates backend matching, promotion, or canonical write rules.

## Recommended Microsoft surfaces

### Copilot Chat
Use for:
- portfolio and queue questions
- status summaries
- recent alerts and promoted changes
- “what needs review”
- guided operational actions with confirmation

### Outlook + Power Automate
Use for:
- email ingestion submission
- forwarding messages and attachments into staged intake
- drafting follow-up emails from review exceptions
- scheduling digest delivery

### Teams
Use for:
- review/approval cards
- queue triage
- retry/requeue/escalation actions
- operational notifications and intake health alerts

### Planner / To Do
Use for:
- follow-up tasks from pending reviews
- research closure follow-ups
- escalation tasks
- work assignment from queue items

### Excel
Use for:
- read-only exports
- digest summaries
- operational snapshots
- analyst review tables where needed

## Copilot action model

### Tier 1: Read-only actions
Safe for autonomous execution.
Examples:
- staged intake summaries
- pending queue health
- recent promoted items
- alerts and clinic history summaries
- ingestion run history
- source health
- leads/pipeline summaries

### Tier 2: Low-risk workflow actions
Allowed with lightweight confirmation or policy gating.
Examples:
- requeue intake item
- retry sync error
- mark pending item ignored/skipped/retry
- run bounded worker batch
- create follow-up task
- verify connector health

### Tier 3: Human-in-the-loop approval actions
Always require explicit confirmation.
Examples:
- resolve pending update into canonical tables
- ownership / financial / lead research writes
- promote evidence/observation to canonical state
- merge entities
- escalation/reassignment with operational effect
- CMBS/propagation actions

## Highest-ROI rollout

### Wave 1 — Copilot as operational front door
Goal: immediate daily productivity gain with minimal risk.

Implement in LCC:
- cross-repo read/query action catalog
- queue summaries
- staged intake backlog summaries
- recent alerts and promoted changes
- sync health / ingestion health summaries
- “my work” / “team queue” / “research queue” summaries

Wire first:
- LCC Copilot chat -> GovernmentProject read actions
- LCC Copilot chat -> DialysisProject read actions
- Teams digest cards using existing health/summary endpoints
- Outlook/Power Automate -> existing Government/Dialysis intake submission endpoints

### Wave 2 — Guided review and approvals
Goal: reduce manual switching and make human-in-the-loop work faster.

Implement in LCC:
- approval cards for pending updates
- approval cards for intake resolve/requeue/suppress
- guided evidence/research review flows
- Planner / To Do task creation from review items
- Teams escalation/reassignment flows

### Wave 3 — Controlled execution and agents
Goal: make Copilot an active workflow facilitator.

Implement in LCC:
- policy-based routing by action risk
- agent flows for:
  - intake triage assistant
  - review queue assistant
  - research follow-up assistant
  - daily ops briefing assistant
- controlled runbook actions for workers/promotions/retries

### Wave 4 — Cross-system intelligence
Goal: unify context across work, data, and communications.

Implement in LCC:
- portfolio morning briefing
- “what changed since yesterday” agent
- “which issues need my attention now” agent
- cross-domain owner/property/clinic timeline assistant
- export/report agent for Excel/PDF deliverables

## Recommended agent set

### 1. Intake Triage Agent
Surfaces:
- Outlook
- Teams
- Copilot chat

Responsibilities:
- accept incoming messages/files
- route to correct intake endpoint
- report accepted/duplicate/rejected outcome
- surface review_required items for human follow-up

Primary backends:
- GovernmentProject staged intake
- DialysisProject staged intake

### 2. Review Queue Agent
Surfaces:
- Teams
- Copilot chat
- LCC review surfaces

Responsibilities:
- summarize pending updates
- propose likely next action
- launch approval flow
- create follow-up task when unresolved

Primary backends:
- GovernmentProject pending updates / evidence workflows
- DialysisProject pending updates / research outcomes

### 3. Ops Health Agent
Surfaces:
- Teams channel
- Copilot chat
- Outlook digest

Responsibilities:
- summarize queue health
- summarize ingestion run failures
- summarize staged backlog thresholds
- summarize sync health and stale sources

Primary backends:
- LCC queue/workflow/sync surfaces
- GovernmentProject intake ops + pipeline status
- DialysisProject health/tracker/critical alerts/source health

### 4. Research & Evidence Agent
Surfaces:
- Copilot chat
- Teams
- Outlook attachment flows

Responsibilities:
- extract screenshot/doc payloads
- persist research artifacts
- create observations or follow-up tasks
- prepare promotion candidates for human review

Primary backends:
- GovernmentProject artifact/evidence endpoints
- DialysisProject scrub/intake/research outcome flows

### 5. Executive Briefing Agent
Surfaces:
- Copilot chat
- Outlook daily summary
- Teams leadership channel

Responsibilities:
- summarize new opportunities
- summarize items needing approval
- summarize promotions and exceptions
- summarize workload by team member

Primary backends:
- LCC work/queue models
- GovernmentProject summaries
- DialysisProject tracker/health/alerts/history

## App and connector design

### LCC should host the authoritative Copilot action contract
Store in LCC:
- action registry
- input/output schemas
- policy tier
- required confirmation level
- source repo ownership
- Microsoft surface mapping

### Recommended connector pattern
- Copilot / Teams / Outlook / Power Automate call LCC endpoints
- LCC adapters call GovernmentProject and DialysisProject
- No client-side direct calls to domain repos with service-role credentials

## Governance rules

1. No Copilot direct database writes.
2. All domain writes must go through existing domain write services or approved workers.
3. Human approval is mandatory for canonical record mutations unless explicitly allowlisted.
4. LCC owns orchestration audit and user-facing workflow state.
5. Domain repos own canonical business rules and idempotency rules.

## Immediate build plan

### Build Step 1 — Consolidated action registry in LCC
Create a single markdown + JSON/YAML action registry listing:
- action name
- owning repo
- endpoint/function
- category
- risk tier
- confirmation rule
- Microsoft surface

### Build Step 2 — Wave 1 read/query adapters in LCC
Implement first adapters for:
- Government intake summary/status/activity
- Government pending updates summary
- Dialysis staged intake summary/status
- Dialysis queue/run/health summaries
- LCC work counts / my work / team queue / sync health

### Build Step 3 — Outlook and Teams entry points
- Outlook / Power Automate ingestion buttons
- Teams operational Copilot cards
- Teams queue/review cards

### Build Step 4 — Approval routing
- LCC approval wrappers for risky Government actions
- LCC approval wrappers for risky Dialysis actions
- Planner/To Do task creation from review queues

## Specific performance wins expected

### Highest immediate performance enhancement
- reduce repo/app switching for daily ops
- reduce manual queue polling
- reduce time to identify what needs review
- reduce manual email/task follow-up creation

### Highest intelligence enhancement
- unified Copilot context across government + dialysis + ops layers
- guided recommendations for next-best action
- daily summarization of exceptions, promotions, and workload

### Highest connected-structure enhancement
- Outlook -> ingestion
- Teams -> review/approval
- Planner/To Do -> task follow-up
- Excel -> export/reporting
- LCC -> authoritative orchestration shell

## Final recommendation

The right architecture is:
- **LCC as the Copilot front door and orchestration shell**
- **GovernmentProject and DialysisProject as authoritative execution engines**
- **Microsoft 365 surfaces as task-specific interaction layers**

This gives you the most leverage with the least backend disruption.
