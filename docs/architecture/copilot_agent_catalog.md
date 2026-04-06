# Copilot Agent Catalog

## Purpose
Document the initial and future Copilot agents, their responsibilities, boundaries, inputs, outputs, and operational surfaces.

## Related Documents
- [Copilot Operating System Blueprint](./copilot_operating_system_blueprint.md)
- [Copilot Action Registry (JSON)](./copilot_action_registry.json)
- [Copilot Wave 1 Build Plan](./copilot_wave1_build_plan.md)

---

## 1. Agent Naming and Taxonomy

### Naming Convention
`{domain_scope}_{function}_agent`

Examples: `daily_briefing_agent`, `intake_triage_agent`, `prospecting_agent`

### Agent Categories
| Category | Description | Human-in-the-Loop |
|----------|-------------|-------------------|
| **Visibility** | Surfaces information, assembles context, formats for delivery | No — read-only |
| **Drafting** | Generates content for human review before action | Yes — user approves before send/apply |
| **Workflow** | Facilitates operational workflows with guided steps | Yes — confirmation at each mutation |
| **Intelligence** | Synthesizes cross-system signals into recommendations | No — advisory only |

### Agent Maturity Levels
| Level | Behavior | Wave |
|-------|----------|------|
| L0 — Scripted | Calls fixed endpoints, formats response | Wave 1 |
| L1 — Context-Aware | Selects actions based on user context and role | Wave 2 |
| L2 — Guided | Proposes multi-step plans, executes with confirmation per step | Wave 3 |
| L3 — Autonomous | Executes low-risk action chains independently within policy bounds | Wave 4 |

---

## 2. Core Agent Definitions

---

### Agent 1: Daily Briefing Agent

**ID:** `daily_briefing_agent`
**Category:** Visibility
**Maturity:** L0 (Wave 1) -> L1 (Wave 2)
**Wave:** 1

#### Purpose
Tell each user what matters today in a single consolidated view. Replace the current pattern of checking multiple apps and tabs with one morning command surface.

#### Trigger Patterns
| Trigger | Surface | Frequency |
|---------|---------|-----------|
| Scheduled (Power Automate) | Teams channel | Weekday mornings, 7:00 AM CT |
| On-demand ("What's my day look like?") | Copilot Chat | User-initiated |
| Page load | LCC homepage | Every session |

#### Tool/Action Access
| Action | Risk Tier | Purpose |
|--------|-----------|---------|
| `get_daily_briefing_snapshot` | 0 | Primary aggregation endpoint |
| `get_my_execution_queue` | 0 | User's assigned work |
| `get_sync_run_health` | 0 | Operational confidence |
| `list_staged_intake_inbox` | 0 | Intake backlog visibility |
| `get_hot_business_contacts` | 0 | Prospecting fuel |

#### Inputs
- Workspace context (from auth)
- User ID and role (from membership)
- Morning Briefing structured payload (from external URL)
- Optional: domain filter, date override

#### Outputs
- Unified briefing payload per `daily_briefing_payload_contract.md`
- Role-scoped sections (broker: calls + pursuits, analyst: queues + errors, manager: team + bottlenecks)
- Action links into LCC pages (queue, inbox, sync health)

#### Role-Specific Views
| Role | Priority Sections | Suppressed Sections |
|------|-------------------|---------------------|
| Broker | Top calls, pursuit tasks, market talking points, overdue items | Sync errors, queue drift details |
| Analyst/Ops | Intake backlog, triage queue, sync errors, domain review items | Prospecting calls |
| Manager | Team production posture, unassigned work, escalations, bottlenecks | Individual queue items |

#### Human-in-the-Loop Rules
- None — agent is fully read-only
- Action buttons in Teams card navigate to LCC pages where human-in-the-loop actions occur

#### Quality Evaluation
- Delivery rate: 100% weekdays
- Completeness: `status.completeness` should be `full` > 95% of days
- Engagement: > 50% of briefings have at least one action link clicked

---

### Agent 2: Intake & Triage Agent

**ID:** `intake_triage_agent`
**Category:** Workflow
**Maturity:** L0 (Wave 1) -> L2 (Wave 3)
**Wave:** 1

#### Purpose
Turn incoming emails and files into structured operational items. Route to correct domain intake. Surface review-required items for human follow-up.

#### Trigger Patterns
| Trigger | Surface | Frequency |
|---------|---------|-----------|
| Email flagged in Outlook | Power Automate -> LCC | Event-driven |
| "Process my inbox" | Copilot Chat | User-initiated |
| Scheduled batch sync | Power Automate | Every 30 minutes |

#### Tool/Action Access
| Action | Risk Tier | Purpose |
|--------|-----------|---------|
| `ingest_outlook_flagged_emails` | 1 | Bulk email intake |
| `list_staged_intake_inbox` | 0 | View current intake queue |
| `triage_inbox_item` | 2 | Move item to triaged state |
| `promote_intake_to_action` | 2 | Convert to team action |
| `list_government_review_observations` | 0 | Gov domain review items |
| `list_dialysis_review_queue` | 0 | Dia domain review items |

#### Inputs
- Outlook message payload (from Power Automate or batch sync)
- User assignment preferences (from workspace membership)
- Domain classification signals (sender, subject keywords, entity matches)

#### Outputs
- Created inbox_item with correlation_id
- Teams notification card with triage action buttons
- Suggested domain classification and priority
- Assignment recommendation based on domain and workload

#### Human-in-the-Loop Rules
- `ingest_outlook_flagged_emails`: lightweight confirmation ("Ingest now?")
- `triage_inbox_item`: lightweight confirmation (status change shown)
- `promote_intake_to_action`: explicit confirmation (action details shown, assignee confirmed)
- L2 future: agent proposes triage + promote in one step, user confirms bundle

#### Quality Evaluation
- Intake latency: < 60 seconds from email flag to inbox item
- Classification accuracy: > 85% correct domain assignment (manual spot-check weekly)
- Promotion rate: track % of intake items that become actions vs. dismissed

---

### Agent 3: Prospecting Agent

**ID:** `prospecting_agent`
**Category:** Drafting
**Maturity:** L0 (Wave 1) -> L1 (Wave 2)
**Wave:** 1

#### Purpose
Help brokers maintain high-quality outbound activity. Surface who to call, prepare context, and draft personalized outreach.

#### Trigger Patterns
| Trigger | Surface | Frequency |
|---------|---------|-----------|
| "Who should I call today?" | Copilot Chat | User-initiated |
| Daily briefing recommended_calls section | Teams / LCC | Daily |
| "Draft an email to [contact]" | Copilot Chat / Outlook | User-initiated |

#### Tool/Action Access
| Action | Risk Tier | Purpose |
|--------|-----------|---------|
| `get_hot_business_contacts` | 0 | Identify warm contacts |
| `generate_prospecting_brief` | 0 | Call-sheet style context |
| `draft_outreach_email` | 1 | Personalized email draft |
| `search_entity_targets` | 0 | Entity/property context |
| `fetch_listing_activity_context` | 0 | Interaction history |

#### Inputs
- Contact/entity records from LCC
- Touchpoint history and engagement scores
- Domain intelligence (gov ownership, dialysis clinic data)
- User's book/target list preferences
- Market context from Morning Briefing

#### Outputs
- Prioritized call sheet (ranked contacts with call prep notes)
- Personalized email drafts (subject + body, ready for Outlook)
- Follow-up reminders (surface in next daily briefing)
- CRM logging suggestions (what to log after the call)

#### Human-in-the-Loop Rules
- Read/query actions: no confirmation needed
- `draft_outreach_email`: explicit confirmation required; draft is generated but never auto-sent
- Future: `send_teams` message to contact requires explicit confirmation
- User always controls final send in Outlook

#### Quality Evaluation
- Outreach volume: > 5 personalized touches per broker per week via Copilot
- Draft acceptance rate: % of drafts that user sends (with or without edits)
- Contact coverage: % of hot contacts that receive a touchpoint within 7 days

---

### Agent 4: Listing Pursuit Agent

**ID:** `listing_pursuit_agent`
**Category:** Drafting + Workflow
**Maturity:** L0 (Wave 2) -> L2 (Wave 3)
**Wave:** 2

#### Purpose
Help win assignments faster by assembling pursuit dossiers, packaging comps, and creating structured follow-up plans.

#### Trigger Patterns
| Trigger | Surface | Frequency |
|---------|---------|-----------|
| "Prepare a pursuit package for [property/entity]" | Copilot Chat | User-initiated |
| "What comps do we have for [location/type]?" | Copilot Chat | User-initiated |
| Listing pursuit task due | Planner / LCC | Scheduled |

#### Tool/Action Access
| Action | Risk Tier | Purpose |
|--------|-----------|---------|
| `search_entity_targets` | 0 | Find entities/properties |
| `fetch_listing_activity_context` | 0 | Interaction timeline |
| `create_listing_pursuit_followup_task` | 2 | Structured next steps |
| Gov/Dia domain queries (via proxy) | 0 | Property/ownership/sale data |
| `generate_prospecting_brief` | 0 | Owner/target context |

#### Inputs
- Target property/entity from LCC entity graph
- Comp data from Gov and Dia domain queries
- Ownership history and transaction records
- Prior interaction history with owner/principals
- Proposal templates (from SharePoint — Wave 3)

#### Outputs
- Listing pursuit dossier (property summary, comp analysis, ownership context, recommended approach)
- Internal prep summary for pre-meeting/pre-call review
- Draft valuation/proposal language sections
- Checklist of next actions (as LCC action_items)

#### Human-in-the-Loop Rules
- All read/query actions: no confirmation
- `create_listing_pursuit_followup_task`: explicit confirmation (task details shown)
- Document generation (Wave 3): explicit confirmation before creating Word/PowerPoint files
- All outputs are advisory — broker makes final pursuit decisions

#### Quality Evaluation
- Pursuit-to-listing conversion rate (long-term outcome metric)
- Dossier generation time: < 3 minutes from request to complete package
- Follow-up task completion rate: % of pursuit tasks completed on time

---

### Agent 5: Marketing & Seller Reporting Agent

**ID:** `marketing_seller_reporting_agent`
**Category:** Drafting
**Maturity:** L0 (Wave 2) -> L1 (Wave 3)
**Wave:** 2

#### Purpose
Improve listing execution and seller communication by automating reporting drafts and surfacing marketing performance.

#### Trigger Patterns
| Trigger | Surface | Frequency |
|---------|---------|-----------|
| "Draft a seller update for [listing]" | Copilot Chat | User-initiated |
| Weekly seller report schedule | Power Automate | Weekly (Fridays) |
| "How is [listing] performing?" | Copilot Chat | User-initiated |

#### Tool/Action Access
| Action | Risk Tier | Purpose |
|--------|-----------|---------|
| `fetch_listing_activity_context` | 0 | Activity timeline |
| `draft_seller_update_email` | 1 | Weekly report draft |
| `search_entity_targets` | 0 | Listing entity context |
| `get_my_execution_queue` | 0 | Open deal tasks |

#### Inputs
- Listing entity and activity timeline from LCC
- OM download/inquiry activity (from domain data)
- Buyer engagement metrics (from Salesforce activities)
- Communication history with seller
- Pipeline data for the listing

#### Outputs
- Weekly seller report email draft (formatted for Outlook send)
- Marketing performance summary (activity counts, buyer engagement, timeline)
- Recommended next outreach actions
- Excel attachment with activity detail (Wave 3 — via Graph API)

#### Human-in-the-Loop Rules
- All read/query actions: no confirmation
- `draft_seller_update_email`: explicit confirmation; never auto-sent
- Excel/report generation (Wave 3): explicit confirmation before file creation
- Seller-facing content always reviewed by broker before delivery

#### Quality Evaluation
- Seller report turnaround: < 10 minutes from request to ready-to-send draft
- Report frequency: 100% of active listings get weekly updates
- Client satisfaction: fewer "where's my update?" inquiries

---

### Agent 6: Deal Execution Agent

**ID:** `deal_execution_agent`
**Category:** Workflow
**Maturity:** L0 (Wave 2) -> L2 (Wave 3)
**Wave:** 2

#### Purpose
Reduce execution drag and missed details during active transactions by tracking critical dates, surfacing diligence items, and drafting client communications.

#### Trigger Patterns
| Trigger | Surface | Frequency |
|---------|---------|-----------|
| "What's the status of [deal]?" | Copilot Chat | User-initiated |
| Critical date approaching (3 days out) | Teams notification | Scheduled |
| "Draft a client update for [deal]" | Copilot Chat | User-initiated |

#### Tool/Action Access
| Action | Risk Tier | Purpose |
|--------|-----------|---------|
| `get_my_execution_queue` | 0 | Active deal tasks |
| `fetch_listing_activity_context` | 0 | Deal activity timeline |
| `update_execution_task_status` | 2 | Progress tasks |
| `create_listing_pursuit_followup_task` | 2 | Add execution tasks |
| `search_entity_targets` | 0 | Party/entity context |

#### Inputs
- Deal/opportunity records from LCC action_items
- Transaction timelines and critical dates
- Diligence checklist items
- Calendar events related to the deal
- Communication history with parties

#### Outputs
- Deal status summaries (where are we, what's next, what's at risk)
- Critical date reminders (Teams notifications)
- Client update email drafts
- Issue escalation prompts (surface blockers to manager)

#### Human-in-the-Loop Rules
- Read/query actions: no confirmation
- `update_execution_task_status`: explicit confirmation
- Client communication drafts: explicit confirmation, never auto-sent
- Escalation: explicit confirmation before notifying manager

#### Quality Evaluation
- Missed critical dates: target 0 per quarter
- Client update frequency: weekly during active transactions
- Task completion rate: > 90% of execution tasks completed on time

---

## 3. Additional Agents (Wave 3-4)

---

### Agent 7: Relationship Memory Agent

**ID:** `relationship_memory_agent`
**Category:** Intelligence
**Maturity:** L1 (Wave 3)
**Wave:** 3

#### Purpose
Surface relationship context before any touchpoint so brokers never walk into a call or meeting cold. Track interaction patterns and relationship health across all systems.

#### Trigger Patterns
- "Tell me about [contact/entity] before my call"
- Pre-meeting prep (calendar event detected with known contact)
- Contact detail page load in LCC

#### Tool/Action Access
- `search_entity_targets` (0)
- `fetch_listing_activity_context` (0)
- `get_hot_business_contacts` (0)
- Contact history queries via entity-hub
- Salesforce activity queries via sync

#### Outputs
- Relationship summary: last interaction, deal history, personal notes, preferred communication
- Interaction timeline across all systems (email, calls, meetings, deals)
- Relationship health score (frequency, recency, depth of engagement)
- Suggested talking points based on recent activity and market context

#### Listing-Driven Production Support
Compounding: turns execution and market intelligence into stronger future listing wins through relationship memory.

---

### Agent 8: Pipeline Intelligence Agent

**ID:** `pipeline_intelligence_agent`
**Category:** Intelligence
**Maturity:** L1 (Wave 3)
**Wave:** 3

#### Purpose
Track pipeline health across all stages and surface bottleneck alerts, velocity trends, and "what's stuck" diagnostics for managers and team leads.

#### Trigger Patterns
- "How's the pipeline looking?"
- Weekly pipeline review meeting prep
- Manager daily briefing section

#### Tool/Action Access
- `get_my_execution_queue` (0)
- Queue/workflow summary endpoints (0)
- Domain query proxies for deal pipeline data (0)
- `get_sync_run_health` (0)

#### Outputs
- Pipeline stage distribution (prospect -> pursuit -> listed -> marketing -> under contract -> closed)
- Velocity metrics (average days in each stage, trend vs. prior quarter)
- Bottleneck alerts (items stuck > 2x average stage duration)
- Stale opportunity flags (no activity in 14+ days)
- Team workload distribution by stage

#### Listing-Driven Production Support
Visibility into where deals slow down enables targeted intervention and process improvement.

---

### Agent 9: Document Assembly Agent

**ID:** `document_assembly_agent`
**Category:** Drafting
**Maturity:** L1 (Wave 3) -> L2 (Wave 4)
**Wave:** 3

#### Purpose
Generate BOVs, proposals, OMs, and seller reports from templates populated with LCC and domain data. Output to Word, PowerPoint, and Excel via Microsoft Graph API.

#### Trigger Patterns
- "Generate a BOV for [property]"
- "Create a proposal for [prospect]"
- "Build a seller report for [listing]"
- Listing pursuit agent requests document generation

#### Tool/Action Access
- `search_entity_targets` (0)
- `fetch_listing_activity_context` (0)
- Domain query proxies for property/financial data (0)
- Microsoft Graph API: Word/PowerPoint/Excel creation (Tier 3 — requires explicit confirmation)
- SharePoint: template retrieval and output storage (Tier 1)

#### Outputs
- Populated Word document (BOV, proposal, valuation analysis)
- Populated PowerPoint deck (marketing presentation, pitch deck)
- Populated Excel workbook (comp analysis, financial summary, seller report data)
- All outputs saved to designated SharePoint/OneDrive folder

#### Human-in-the-Loop Rules
- Template selection: user confirms which template to use
- Data population: user reviews populated draft before finalization
- File creation: explicit confirmation before writing to SharePoint
- No external distribution without separate user action

#### Listing-Driven Production Support
Directly accelerates proposal turnaround time and improves listing marketing collateral quality.

---

## 4. Ownership Boundaries and System-of-Record Constraints

### What Agents Can Do
- Read from any LCC endpoint (queue, inbox, entities, sync, contacts, domain proxies)
- Call LCC chat endpoint for AI-generated content (briefs, drafts, summaries)
- Create LCC action_items and activity_events
- Generate content for human review (email drafts, documents, summaries)

### What Agents Cannot Do
- Write directly to GovernmentProject or DialysisProject databases
- Send external communications (email, Teams messages, SMS) without explicit user confirmation
- Modify canonical business records (ownership, financial fields) without Tier 3 approval
- Bypass LCC's confirmation policy for any action
- Access systems outside LCC's existing integration paths

### System-of-Record Enforcement
| Data | System of Record | Agent Access |
|------|------------------|--------------|
| Government properties, leases, ownership | GovernmentProject | Read via LCC proxy only |
| Dialysis clinics, CMS, NPI data | DialysisProject | Read via LCC proxy only |
| Queue, inbox, actions, activities | LCC (Ops Supabase) | Read + write via LCC API |
| Entities, contacts, relationships | LCC (Ops Supabase) | Read + write via LCC API |
| Salesforce opportunities, contacts | Salesforce | Read via sync; write via approved SF endpoints |
| Email, calendar, Teams messages | Microsoft 365 | Read via sync/Graph; write only with user confirmation |

---

## 5. Telemetry and Quality Evaluation

### Per-Agent Metrics

Every agent should emit:
1. **Invocation count** — how often the agent is triggered
2. **Completion rate** — % of invocations that produce a useful result
3. **Latency** — time from trigger to response delivery
4. **User action rate** — % of agent outputs that lead to user action (click, send, approve)
5. **Error rate** — % of invocations that fail or produce degraded output

### Storage
- Agent telemetry logged to `activity_events` with `source: 'copilot'` and `agent_id` field
- Aggregated weekly in daily briefing snapshot under ops health section

### Review Cadence
- Weekly: check invocation counts and error rates
- Monthly: review user action rates and qualitative feedback
- Quarterly: evaluate agent ROI against listing-driven production metrics

---

## 6. Expansion Roadmap by Wave

| Wave | Agents Active | Maturity Level | Key Capability Additions |
|------|--------------|----------------|--------------------------|
| **Wave 1** | Daily Briefing, Intake & Triage, Prospecting | L0 (Scripted) | Fixed endpoint calls, formatted responses, Teams delivery |
| **Wave 2** | + Listing Pursuit, Marketing & Seller Reporting, Deal Execution | L1 (Context-Aware) | Role-based behavior, entity context injection, multi-action workflows |
| **Wave 3** | + Relationship Memory, Pipeline Intelligence, Document Assembly | L2 (Guided) | Multi-step plans with per-step confirmation, Graph API document generation |
| **Wave 4** | All agents | L3 (Autonomous for Tier 0-1) | Policy-bounded autonomous execution of low-risk action chains |

### Wave 4 Autonomy Policy
Agents at L3 may execute autonomously only when:
- All actions in the chain are Tier 0 or Tier 1
- The action chain has been pre-approved as a named workflow
- The user has opted in to autonomous execution for that workflow
- All actions are logged and auditable
- Any Tier 2+ action encountered pauses the chain for confirmation
