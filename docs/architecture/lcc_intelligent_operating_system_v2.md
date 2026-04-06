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

---

## 1.1 Business Model: How Revenue Is Produced

All system design must be grounded in how this brokerage actually generates revenue. The production engine has two sides:

### Seller Side (Primary Revenue Driver)

The core business is **sell-side, listing-driven production** — winning exclusive assignments to sell net lease properties in government-leased and dialysis/kidney care categories.

**Lead-to-Revenue Timeline:**
- Average **38 months** from first email/touchpoint to first BOV or buy-need response
- Business development is a **long-cycle nurture game** — years of consistent touchpoints that build familiarity and trust
- Revenue events are triggered by the **client's inbound action** after receiving months/years of outbound BD — they call back with a problem, a disposition need, a request for a BOV or comps
- The team does not cold-call aggressively — they build market authority through consistent presence and expertise delivery

**Seller Touchpoint Cadence:**
- **New leads (first 6 months):** 7 touchpoints minimum
- **Active accounts (ongoing):** ~4 touchpoints per year average
- **Top repeat developers/owners:** Monthly or bi-weekly touches
- **One-off owners / prior owners:** Lower frequency, but still in the rotation

**Touchpoint Types (Outbound BD):**
- Capital markets update emails (personalized or segment-targeted)
- Voicemails ("checking in" — designed to prompt inbound response)
- Listing announcement emails (new assignments)
- Closing announcement emails (proof of execution)
- Quarterly capital markets update reports (by sector: government, dialysis)
- Direct outreach when ownership research reveals an opportunity
- BOV/valuation delivery when requested

**Conversion Trigger:** The seller eventually responds — they have a problem, a portfolio rebalancing need, a 1031 deadline, a capital event, or they're simply ready. When they call back, the team must be ready to deliver a BOV within days, not weeks.

### Buyer Side (Deal Velocity Driver)

Buyers are cultivated by **showing them early looks at new listings** before or at market launch. This serves two purposes:
1. Accelerates deal velocity on active listings (faster buyer, faster close, faster fee)
2. Builds buyer relationships that generate repeat deal flow and market intelligence

**Buyer BD Model:**
- Active buyer list segmented by property type, geography, and cap rate tolerance
- New listing announcements sent to targeted buyer segments
- OM (Offering Memorandum) distribution to qualified buyers
- Follow-up on OM downloads and inquiry responses
- Showing coordination and offer management

### What This Means for LCC

**Strategic actions** = Anything that advances a BOV opportunity, secures a listing, or closes a deal. These are the revenue events.

**Important actions** = Business development touchpoints that maintain the 38-month pipeline. Every skipped touchpoint is a future listing opportunity that goes to a competitor.

**Urgent actions** = Day-to-day email responses, ad hoc deal requests, answering inbound questions on active listings, pipeline management. These feel urgent but are operational — they happen in response to work already in motion.

**The fundamental design principle:** LCC must ensure the team is executing BD touchpoints and research pipeline work EVERY DAY — not just when the inbox is empty. The inbox will never be empty. The system must carve out time for strategic and important work by surfacing it above the reactive flow.

---

## 1.2 The Problem: 10+ Disconnected Windows

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

**STRATEGIC — Do First (Securing & Executing Revenue)**
These are active deal and listing pursuit actions. BOV delivery, listing commencement, offer response, closing execution. Revenue is on the line.

- "DaVita Palmdale: Craig Tomlinson responded to your offer counter. 4 attachments. [View email] [Draft response] [Call Craig]"
- "BOV Request: Boyd Watterson needs a valuation on the GSA Federal Building, Dallas by Friday. [Start BOV] [Pull comps] [View ownership research]"
- "New listing assignment: Fresenius Dallas signed. Commence marketing. [Create listing launch sequence] [Generate buyer list] [Draft announcement]"

**IMPORTANT — Do Second (Business Development & Pipeline Building)**
These are the touchpoints and research that feed the 38-month pipeline. Skipping these means future listings go to competitors.

- "Seller BD: 4 top-tier accounts due for monthly touchpoint. [View list] [Draft capital markets updates] [Generate call sheet]"
- "New leads: 3 new owners identified from research pipeline. 0 touchpoints. [Draft first-touch emails] [Create pursuit records]"
- "Buyer outreach: 7 OM downloaders not yet called across 2 active listings. [Call list] [Draft follow-ups]"
- "Research pipeline: 5 ownership research items older than 7 days. Completing these unlocks 3 pursuit candidates. [Review queue]"
- "3 dialysis clinics in target market gained 10%+ patients MoM. [View growth report] [Research ownership]"

**URGENT — Do Third (Respond & Process)**
These are inbound responses, ad hoc requests, and operational items. They feel urgent but they're reactive — the system handles them AFTER strategic and important work is addressed.

- "5 inbox items need triage — 2 are deal-related (flagged by scoring engine)"
- "Farhan Kabani (CBRE Debt) followed up on Fresenius debt questions. [View email] [Draft reply]"
- "Salesforce: 3 open tasks due this week. [View tasks]"
- "Seller report for DaVita Palmdale due Friday. [Generate report]"

Each item has **one-click actions** — not a chat prompt, but direct buttons that execute work.

### Proactive Business Development Cadence

The command queue is not just reactive (respond to emails, clear tasks). It **proactively structures the day** around production cadence targets — even when nothing is overdue and the inbox is empty. Every day, LCC ensures you are advancing these production engines:

#### 1. New Lead Generation
LCC monitors all research pipelines (Gov ownership, Dia clinic, RCM leads, LoopNet) and surfaces **new leads that need human review and outreach initiation:**

- "3 new government properties identified with lease expirations in 12-18 months. Ownership research pending. [Start research] [View properties]"
- "RCM pipeline: 5 new LoopNet saves matched to target criteria. 2 have owners in your contact database. [Review leads] [Generate call list]"
- "CMS data refresh: 4 dialysis clinics in TX/OK added patients this quarter. Not in your pipeline yet. [Create pursuits] [Research ownership]"

**Daily target surfaced:** "Lead generation: 2 new leads researched today (target: 3/day, 15/week)"

#### 2. Seller BD Touchpoints (The 38-Month Pipeline)
LCC manages the long-cycle seller nurture engine. Every owner/seller contact has a touchpoint cadence target, and LCC ensures you never fall behind:

**New Leads (first 6 months — 7 touch target):**
- "3 new seller leads added in last 30 days have 0 touchpoints. First touch overdue. [View leads] [Draft capital markets email] [Generate call list]"
- "2 leads at touch 3 of 7 — next touch due this week. [View contacts] [Draft personalized email]"

**Active Accounts (~4/year cadence):**
- "12 accounts due for quarterly touchpoint. Last touch > 90 days. Sorted by engagement score:"
  1. "Boyd Watterson Asset Mgmt — 3 government assets, last touch 95 days. [Draft capital markets update] [Call] [Send quarterly report]"
  2. "American Realty Capital — prior buyer, 2 assets in target market, last touch 110 days. [Draft email] [Call]"

**Top Repeat Developers (monthly/bi-weekly):**
- "4 top-tier accounts due for monthly touch:"
  1. "DaVita Corporate RE — active relationship, last touch 18 days. [Draft listing update] [Call]"
  2. "Fresenius Medical — 12 clinics in pipeline, last touch 22 days. [Draft market update] [Call]"

**Mass Marketing Queue:**
- "Quarterly capital markets report (Government) ready to send. 145 contacts in segment. [Preview] [Send] [Schedule]"
- "New listing announcement: [Property] — buyer list: 230 contacts. Seller list: 85 contacts. [Preview buyer blast] [Preview seller announcement] [Send both]"
- "Closing announcement: [Property] — 310 contacts. [Preview] [Send]"

**Cadence Dashboard:** "This week: 8/15 BD touchpoints completed. New leads: 2/3 daily target. Accounts overdue for touch: 12. Mass sends: quarterly report pending."

#### 3. Research Pipeline Closure
LCC tracks every research item from creation to completion to outreach, surfacing bottlenecks:

- "Research pipeline: 14 ownership items open. 3 are older than 14 days. [View backlog] [Assign oldest 3]"
- "Gov evidence review: 5 observations awaiting promotion. 2 have high-value ownership matches. [Review queue] [Prioritize by value]"
- "Dialysis property-clinic linking: 8 pending reviews. Completing these unlocks 3 new pursuit candidates. [Review links]"

**Goal:** Zero research items older than 7 days. Every completed research item auto-generates a pursuit recommendation.

#### 4. Listing Marketing & Buyer Outreach
For active listings, LCC drives **outbound buyer/broker outreach** to maximize deal velocity. Buyers are cultivated by showing them early looks at new listings — this is the primary buyer BD mechanism.

**Listing Launch Sequence (automated by LCC):**
1. Pre-market: Identify targeted buyer segment (by property type, geography, cap rate)
2. Early look: Send preview to top 20 buyers before full market launch
3. Full launch: OM distribution to full buyer list + broker community
4. Follow-up: Track OM downloads → call downloaders within 48 hours
5. Weekly: Follow up on non-responsive downloaders, report activity to seller

**Active Listings Dashboard:**
- "DaVita Palmdale: 12 OM downloads, 3 showings, 1 offer. 8 downloaders not yet called. [Call list] [Draft follow-up batch] [Seller report due Friday]"
- "Fresenius Dallas: Listed 5 days ago. 4 OM downloads, 0 showings. Below pace — only 35 of 150 target buyers contacted. [Send next batch] [Review targeting] [Draft broker blast]"

**OM Downloader Follow-Up:**
- "7 OM downloaders across 2 listings haven't been called. Sorted by buyer quality:"
  1. "Marcus & Millichap (Investor) — downloaded DaVita Palmdale OM 3 days ago. [Call] [Draft email]"
  2. "VEREIT (REIT) — downloaded both OMs, no response. [Call] [Draft email]"

**Seller Communication:**
- "Weekly seller report for DaVita Palmdale due Friday. Activity data ready. [Generate report] [Draft email to seller]"
- "Closing announcement ready for [completed deal]. 310 contacts in distribution. [Preview] [Send]"

**Target:** Every active listing gets 20+ targeted buyer/broker outreach contacts per week. Every OM download gets a follow-up call within 48 hours. Every seller gets a weekly report.

#### 5. Deal Execution & Close Management
For deals under contract, LCC tracks critical dates and ensures nothing falls through:

- "Deals in execution:"
  - "DaVita Palmdale: PSA signed. Due diligence expires in 12 days. 4 open diligence items. [View checklist] [Draft buyer update]"
  - "GSA Portland: Financing contingency expires in 5 days. Lender has not confirmed commitment. [Draft lender follow-up] [Escalate to manager]"

**Goal:** Zero missed critical dates. Every deal has a weekly client/buyer update sent.

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
