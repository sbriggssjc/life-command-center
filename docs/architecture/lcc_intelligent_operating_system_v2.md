# LCC Intelligent Operating System — Design Vision v2

> **Owner:** Team Briggs / NorthMarq Net Lease Investment Sales
> **Date:** 2026-04-06
> **Status:** Draft — alignment document for all future build decisions
> **Governing Principle:** Every feature must make the team faster at sourcing, securing, marketing, executing, and compounding listing-driven production.

---

## 1. What LCC Must Become

LCC is the **operating cockpit** for a net lease investment sales brokerage. It is not a dashboard. It is not a chat panel. It is the single interface where:

- Every data source the team touches converges into one view
- The system tells you what to do next, ranked by strategic value
- Every action you take feeds back into the system and makes it smarter
- Microsoft 365 apps (Outlook, Teams, To Do, Calendar) become extensions of LCC — not separate tools you switch to

The team currently works across **10+ disconnected windows** every day:

| Window | What You Do There | Time Spent |
|--------|-------------------|------------|
| CoStar | Research comps, ownership, lease data, market intel | High |
| County Records | Verify ownership, deed history, tax records | Medium |
| LoopNet | Monitor listings, track buyer inquiries, comp research | Medium |
| CREXi | Additional listing exposure, buyer activity | Low-Medium |
| Secretary of State | Entity lookups, LLC ownership tracing | Medium |
| CMS (Medicare) | Dialysis clinic data, patient counts, quality scores | Medium |
| Salesforce | CRM — contacts, opportunities, tasks, pipeline | High |
| Outlook | Email — client communication, deal correspondence, prospecting | High |
| Teams | Internal communication, notifications | Medium |
| Excel/Word | Analysis, proposals, BOVs, seller reports | Medium |

**LCC should eliminate or reduce the need to context-switch between these.** Not by replacing each tool, but by:
1. Ingesting the intelligence from each source automatically
2. Routing that intelligence to the right place in the workflow
3. Surfacing the combined picture as actionable daily priorities
4. Enabling one-click action from the LCC interface (draft, call, task, assign)

---

## 2. The Daily Experience

### Morning (7:00 - 8:00 AM)

You open LCC. The homepage doesn't show you stats. It shows you **your day, structured by strategic value:**

**STRATEGIC — Do First (Revenue Actions)**
- "DaVita Palmdale: Craig Tomlinson responded to your offer. His counter questions the 10yr BTS metrics. [View email] [Draft response] [Call Craig]"
- "GSA Federal Building, Dallas: Ownership research complete. Owner is Boyd Watterson Asset Mgmt (LLC). Engagement score: 72. Last call: 18 days ago. [View dossier] [Draft outreach] [Create pursuit]"

**IMPORTANT — Do Second (Pipeline & Relationships)**
- "Farhan Kabani (CBRE Debt) followed up on Fresenius debt questions. Last touch: 2 days ago. [View email] [Draft reply]"
- "3 dialysis clinics in your target market gained 10%+ patients month-over-month. [View growth report] [Generate pursuit list]"
- "Contact touchpoint overdue: Mike Reynolds (American Realty Capital) — 22 days since last call, engagement score 68. [Call] [Draft email]"

**URGENT — Do Third (Operational)**
- "5 inbox items need triage (2 flagged today)"
- "Salesforce: 3 open tasks due this week"

Each item has **one-click actions** — not a chat prompt, but direct buttons that execute work.

### During the Day

As you work, LCC stays ahead of you:
- You finish a call → LCC prompts: "Log this call? [Quick log] Who did you speak with? What's the next step? [Create follow-up task]"
- You receive a new email about an active deal → LCC flags it in the command queue immediately, not buried in Outlook
- You complete a pursuit dossier → LCC suggests: "Send this to [contact]? [Draft cover email] [Save to deal folder] [Create To Do: follow up in 3 days]"
- A new property listing appears on LoopNet matching your target criteria → LCC surfaces it: "New listing match: [Property] in [Market]. [View details] [Compare to pipeline] [Send to buyer list]"

### End of Day

LCC summarizes what got done and what carries forward:
- "Today: 3 strategic items completed, 2 carried forward. 5 calls logged, 8 emails sent. Pipeline: 2 deals advanced."
- Tomorrow's preview: "GSA Building follow-up due. Seller report for [listing] due Friday."

---

## 3. Data Flow Architecture

### Principle: Data Enters Once, Routes Everywhere

Every piece of intelligence should flow through LCC exactly once and automatically reach every place it needs to be:

```
External Source → Ingestion → Classification → Entity Resolution → Routing → Surface
```

### Ingestion Layer (Automatic)

| Source | Method | Frequency | What Gets Ingested |
|--------|--------|-----------|-------------------|
| Outlook | Power Automate trigger | Real-time (on flag/receive) | Flagged emails, deal correspondence, client communications |
| Salesforce | Scheduled sync + webhook | Every 30 min + event-driven | Activities, tasks, opportunities, contacts, pipeline changes |
| Calendar | Power Automate | Hourly | Meetings, calls, events with attendee context |
| CoStar | Manual paste + future API | On-demand → future: daily scan | Comps, ownership data, market intel |
| County Records | Manual paste + future scrape | On-demand | Deed transfers, ownership changes, tax assessments |
| LoopNet/CREXi | RCM pipeline + future API | Batch (existing) → future: daily | New listings, buyer inquiries, comp data |
| Secretary of State | Manual paste + future API | On-demand | Entity filings, LLC ownership chains |
| CMS (Medicare) | Existing pipeline | Weekly batch | Clinic patient counts, quality scores, cost reports, payer mix |
| Gov Domain DB | Direct query | Real-time | Properties, leases, ownership, pipeline, sales history |
| Dia Domain DB | Direct query | Real-time | Clinics, financial estimates, research outcomes, movers |

### Classification Layer (Automatic)

When data enters, LCC classifies it:

1. **Domain classification** — Is this government, dialysis, or other?
2. **Entity resolution** — Which property/contact/company does this relate to?
3. **Deal linkage** — Is this connected to an active deal or pursuit?
4. **Strategic scoring** — How does this impact revenue production? (deal > pursuit > relationship > operational)
5. **Contact matching** — Who is this from/about? What's their engagement history?

### Routing Layer (Automatic)

After classification, data routes to all relevant destinations:

| If classified as... | Route to... |
|---------------------|-------------|
| Active deal correspondence | Command queue (strategic), entity timeline, contact history, Salesforce activity |
| New prospect/ownership intel | Entity record, pursuit pipeline, recommended outreach queue |
| Client follow-up needed | Command queue (important), To Do task, calendar reminder |
| Market data/comp | Entity context, domain research, pursuit dossier enrichment |
| Operational (sync error, admin) | Ops queue (urgent), Teams notification if critical |
| Clinic growth signal | Domain alerts, pursuit pipeline, recommended outreach |

### Learning Layer (Continuous)

As you work, LCC learns:

| Action You Take | What LCC Learns |
|-----------------|-----------------|
| Triage email as strategic | "Emails from this sender about this deal are strategic" |
| Complete a deal | Average deal cycle time, which pursuit patterns worked |
| Ignore a recommendation | Lower priority for similar recommendations |
| Call a contact and log outcome | Update engagement score, relationship health, adjust call frequency |
| Dismiss a listing match | Refine matching criteria for future alerts |
| Promote an inbox item to action | "This type of inbound signal converts to action" |

This learning feeds back into the scoring engine, making priorities more accurate over time.

---

## 4. The LCC Interface

### Homepage: The Command Queue

The homepage is **not a dashboard with stat cards.** It is a prioritized list of things to do, each with context and one-click actions.

```
┌─────────────────────────────────────────────────────────┐
│ Monday, April 7, 2026                    Scott Briggs   │
│                                                         │
│ ── STRATEGIC ──────────────────────────────────────────  │
│                                                         │
│ ▸ DaVita Palmdale — Offer Response Needed               │
│   Craig Tomlinson countered on metrics. 4 attachments.  │
│   [View Email] [Draft Response] [Call] [Defer to PM]    │
│                                                         │
│ ▸ GSA Federal Building Dallas — Pursuit Ready            │
│   Owner: Boyd Watterson. Score: 72. No call in 18 days. │
│   [View Dossier] [Draft Outreach] [Create Pursuit]      │
│                                                         │
│ ── IMPORTANT ─────────────────────────────────────────── │
│                                                         │
│ ▸ Fresenius Debt Questions — CBRE Follow-up             │
│   Farhan Kabani waiting on response. 2 days.            │
│   [View Thread] [Draft Reply] [Assign to Toby]          │
│                                                         │
│ ▸ 3 Dialysis Clinics Showing Growth                     │
│   +15% patients MoM in target markets.                  │
│   [View Clinics] [Generate Pursuit List] [Research]     │
│                                                         │
│ ▸ Touchpoint Overdue: Mike Reynolds                     │
│   American Realty Capital. Score: 68. 22 days cold.     │
│   [Call] [Draft Email] [Defer 1 Week]                   │
│                                                         │
│ ── URGENT ────────────────────────────────────────────── │
│                                                         │
│ ▸ 5 inbox items need triage                             │
│   [Open Inbox] [Auto-classify]                          │
│                                                         │
│ ▸ 3 SF tasks due this week                              │
│   [View Tasks] [Sync Now]                               │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Business Tabs: Intelligence, Not Just Data

The Government and Dialysis tabs should shift from "show me all properties" to "show me what I should do":

**Government Tab:**
- **Pursuits** — Properties we're actively pursuing, ranked by likelihood to convert
- **Opportunities** — Ownership changes, lease expirations, and triggers that signal a potential listing
- **Pipeline** — Active deals by stage (pursuit → proposal → marketing → under contract → closed)
- **Research** — Pending ownership research, evidence review, with priority ranking

**Dialysis Tab:**
- **Growth Signals** — Clinics with patient count increases, new openings, market expansion
- **Pursuits** — Active dialysis property pursuits
- **Pipeline** — Dialysis deals by stage
- **Market Intel** — CMS quality scores, payer mix shifts, cost report changes that signal opportunity

### Contacts: Relationship Intelligence

The contacts view should not be an address book. It should be a **relationship management engine:**
- Top contacts ranked by engagement × deal potential
- Stale relationships flagged with suggested re-engagement
- Contact timeline showing every touchpoint across all systems
- One-click: call, email, draft, log, create follow-up

### Copilot: Conversational Command Layer

The Copilot panel becomes the **natural language interface** to the command queue:
- "What's the status of the DaVita deal?" → pulls entity timeline, latest emails, and deal stage
- "Draft a response to Craig about the BTS metrics" → uses email context + property data
- "Who in my pipeline hasn't been touched in 2 weeks?" → queries contact engagement across all sources
- "Show me government properties with leases expiring in 12 months" → queries Gov DB, links to ownership research

---

## 5. Microsoft 365 Integration Model

LCC is the brain. Microsoft is where work gets delivered.

### Outlook
- LCC drafts emails → user reviews in Outlook → sends
- Incoming flagged emails → auto-ingested, classified, entity-linked
- Deal correspondence auto-tagged and linked to entity timelines

### Teams
- Morning briefing card arrives with strategic priorities
- Deal alerts surface as actionable cards (not just notifications)
- Escalation and approval flows happen inline
- Team channel shows pipeline health and deal activity

### To Do / Planner
- Follow-up tasks auto-created from deal actions
- Pursuit checklists generated from LCC
- Calendar-synced reminders for touchpoints

### Calendar
- Pre-meeting prep cards 15 minutes before meetings with known contacts
- Call scheduling suggestions based on contact timezone and availability
- Post-meeting prompts to log outcomes

### OneDrive / SharePoint
- Generated documents (BOVs, proposals, seller reports) auto-saved
- Deal folders organized by entity
- Templates pulled for document assembly

### Excel
- Comp analysis exports populated with real data
- Pipeline reports generated on schedule
- Seller report data packs auto-assembled

---

## 6. Self-Learning Architecture

### What the System Tracks

| Signal | Source | Feeds Into |
|--------|--------|------------|
| Email triage decisions | User classifying inbox items | Strategic scoring weights |
| Deal cycle times | Completed deals (creation → close) | Pipeline velocity estimates |
| Contact response patterns | Email/call outcomes | Engagement scoring model |
| Pursuit conversion rates | Pursuit → listing → sale | Pursuit prioritization |
| Outreach effectiveness | Draft sent → response received → deal advanced | Prospecting recommendations |
| Classification accuracy | User overriding auto-classification | Domain classifier tuning |
| Recommendation quality | User acting on vs. ignoring suggestions | Priority ranking model |

### Feedback Loops

1. **Scoring calibration** — Track which scored items users act on first. If users consistently pick "important" items over "strategic" ones, the scoring weights are wrong. Adjust.

2. **Entity enrichment** — Every interaction adds data to the entity graph. A call logged today enriches the contact profile that drives tomorrow's call sheet.

3. **Pattern recognition** — If emails from CBRE about debt always relate to active deals, auto-classify future CBRE debt emails as strategic without waiting for manual triage.

4. **Pipeline learning** — As deals complete, the system learns: "Government deals average 87 days from pursuit to close. Dialysis averages 62 days. This pursuit has been open 95 days — flag for review."

5. **Outreach optimization** — Track which contacts respond to email vs. phone. Track which time of day gets responses. Adjust recommended outreach method and timing.

---

## 7. Implementation Roadmap

### Phase 1: Command Queue Homepage (Next Sprint)
- Replace stat-card homepage with strategic/important/urgent command queue
- Each item has one-click action buttons
- Items pulled from: inbox (scored), my work (scored), SF pipeline, contact touchpoints
- This is the single highest-impact change to daily experience

### Phase 2: Automatic Ingestion & Routing (Following Sprint)
- Outlook emails auto-classified on ingestion (deal/prospect/operational)
- Auto-entity linking on inbox items (match sender to contact, subject to deal)
- SF sync on shorter cadence (30 min → 15 min) with opportunity stage tracking
- Calendar event → pre-meeting prep card generation

### Phase 3: Domain Intelligence Surfaces (2 Sprints Out)
- Gov tab restructured: Pursuits → Opportunities → Pipeline → Research
- Dia tab restructured: Growth Signals → Pursuits → Pipeline → Market Intel
- Contact view restructured: relationship engine with engagement ranking
- One-click actions on every surface (not just Copilot panel)

### Phase 4: Continuous Learning (Ongoing)
- Track triage decisions and scoring accuracy
- Build classification patterns from user behavior
- Pipeline velocity tracking and anomaly detection
- Outreach effectiveness measurement

### Phase 5: External Source Expansion (Future)
- CoStar API integration (when available) for automated comp feeds
- County record monitoring for ownership changes
- Secretary of State entity filing alerts
- LoopNet/CREXi buyer activity feeds

---

## 8. What This Means for Current Code

### Keep and Build On
- Action dispatcher (29 actions) — solid foundation
- Strategic scoring engine — correct concept, needs real data to prove out
- Entity graph and contact engagement — the backbone of intelligence
- Power Automate flows — the bridge to Microsoft
- Domain databases (Gov, Dia) — the proprietary intelligence

### Restructure
- **Homepage** — from stat dashboard to command queue
- **Data flow** — from manual sync triggers to automatic routing
- **Tab layout** — from data display to action-oriented intelligence
- **Copilot** — from primary interface to conversational complement to the command queue

### Add
- Auto-classification on ingestion
- Entity linking on every inbox item
- Salesforce opportunity stage tracking
- Calendar-triggered prep flows
- Learning/feedback tracking tables
- One-click action buttons throughout the app (not just in Copilot panel)

---

## 9. Success Criteria

The system is working when:

1. **You open LCC in the morning and know exactly what to do** — without checking Outlook, Salesforce, or any other app first
2. **Every email, call, and task is connected to the right entity and deal** — no orphaned data
3. **The priorities reflect actual business value** — deals first, then relationships, then operations
4. **One click gets you from "see the problem" to "take the action"** — draft, call, assign, defer
5. **The system gets smarter over time** — recommendations improve as you use it
6. **You spend more time on revenue-producing activity** — less time on admin, switching, and searching

---

## 10. Governing Question

Before building anything, ask:

**Does this reduce the time between recognizing an opportunity and taking action on it?**

If the answer is no, it's not a priority.
