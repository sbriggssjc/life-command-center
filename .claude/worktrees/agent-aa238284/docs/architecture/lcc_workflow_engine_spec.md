# LCC Workflow Engine — Design Specification

> **Owner:** Team Briggs / NorthMarq
> **Date:** 2026-04-06
> **Status:** Draft — next build sprint blueprint
> **Prerequisite:** Read `lcc_intelligent_operating_system_v2.md` for business model context

---

## 1. What This Document Specifies

The v2 design document captures the vision. This document specifies the **workflow engine** — the system that guides users through every stage of business development, research, and marketing execution.

This is not a homepage redesign. This is a redesign of **how every tab and page in the app functions** to drive production cadence.

---

## 2. The Core Concept: Guided Workflow Engine

LCC should function like a **guided checklist system** that:

1. **Knows what needs to be done** — from lead pipelines, Salesforce tasks, research queues, marketing calendars, and touchpoint schedules
2. **Creates the work plan** — designs the daily/weekly checklist automatically based on what's due, what's overdue, and what the cadence targets require
3. **Walks the user through each step** — guides them from research to outreach to call logging to follow-up scheduling, completing each step before moving to the next
4. **Helps complete the work** — surfaces the right data, drafts the email, provides the comp, pre-fills the Salesforce log
5. **Tracks completion** — shows planned vs. completed for each major area, highlights gaps, adjusts tomorrow's plan

The system is the gap-closer between:
- **What needs to be done** (pipeline, cadence targets, due dates)
- **What is planned to be done** (today's checklist, this week's targets)
- **What is actually done** (logged calls, sent emails, completed tasks, closed research)

---

## 3. Homepage: Scoreboard, Not Task List

### What the homepage should show

The homepage is a **scoreboard** — a snapshot of where you stand today against your plan. It does NOT list individual tasks (that's what the other tabs do).

**Today's Production Score:**

| Area | Planned | Completed | Status |
|------|---------|-----------|--------|
| BD Touchpoints (calls + emails) | 8 | 3 | Behind |
| Research Items to Close | 3 | 1 | Behind |
| Listing Marketing Actions | 4 | 4 | On Track |
| Deal Execution Items | 2 | 2 | Complete |
| Inbox Triage | 12 | 7 | In Progress |

**Weekly Cadence:**

| Metric | This Week | Target | Trend |
|--------|-----------|--------|-------|
| Seller Touchpoints | 12 | 30 | ↓ Behind |
| New Leads Researched | 4 | 15 | ↓ Behind |
| Calls Logged | 8 | 15 | → On Pace |
| Listings Active | 2 | — | — |
| Deals in Execution | 1 | — | — |

**Overdue Alerts:**
- "3 Salesforce tasks overdue"
- "5 research items older than 7 days"
- "8 contacts past touchpoint cadence"

Each alert links to the relevant tab where the user can work through the items.

### What the homepage should NOT show
- Individual email subjects (that's the Inbox/Messages tab)
- Duplicate lists ("My Work" and "Inbox" showing the same emails)
- Weather, market data, or activity breakdowns as primary content (collapse or move to secondary)

---

## 4. Tab Redesign: Where the Work Happens

### Tab: My Work (Guided Daily Checklist)

This tab becomes the **primary execution surface** — a guided checklist that walks the user through their day.

**Structure:**
```
TODAY'S WORK PLAN
Generated at 7:00 AM | 12 items planned | 3 completed

── BD TOUCHPOINTS (3/8 done) ──────────────────────────

☑ Call Boyd Watterson (GSA Federal Bldg owner)
  Logged: 2 min call, left voicemail. Follow-up: 2 weeks.
  
☑ Email Mike Reynolds (ARC) — capital markets update
  Sent via Outlook at 9:42 AM
  
☐ Call Dr. James Chen (Fresenius regional)
  3 clinics in growth markets. No prior contact.
  [Call Now] [Draft Intro Email] [Skip → Reschedule]
  → Pre-call brief: 3 clinics gained 15%+ patients...
  
☐ Email quarterly report to government segment (85 contacts)
  [Preview Report] [Send to Segment] [Schedule for Tomorrow]

☐ Follow up: OM downloaders on DaVita Palmdale (3 uncalled)
  [View List] [Generate Call Sheet] [Draft Batch Email]

── RESEARCH PIPELINE (1/3 done) ────────────────────────

☑ Ownership research: 1200 Main St, Dallas
  Owner identified: Boyd Watterson Asset Mgmt (LLC)
  → Auto-created: pursuit recommendation + outreach task
  
☐ Ownership research: 500 Commerce, Fort Worth
  County records pulled. Entity: "FW Medical Holdings LLC"
  [Search Secretary of State] [Match to Contacts] [Complete]
  
☐ Evidence review: Gov property lease observation
  [Review Evidence] [Promote to Canonical] [Dismiss]

── DEAL EXECUTION (2/2 done) ───────────────────────────

☑ DaVita Palmdale: Responded to Craig Tomlinson counter
☑ Fresenius Dallas: Sent debt team answers to Farhan Kabani

── LISTING MARKETING (0/4 done) ────────────────────────

☐ DaVita Palmdale: Call 3 OM downloaders
  Marcus & Millichap, VEREIT, Inland Real Estate
  [View OM Download List] [Generate Call Sheet]

☐ DaVita Palmdale: Weekly seller report
  Due Friday. Activity data ready.
  [Generate Report] [Draft Email to Seller]

☐ Fresenius Dallas: Send next buyer outreach batch
  35 of 150 target buyers contacted. Below pace.
  [View Remaining Buyers] [Generate Batch] [Send]

☐ Fresenius Dallas: Follow up with early-look buyers
  3 buyers received pre-market preview, no response.
  [Draft Follow-Up Emails]
```

**Key behaviors:**
- Checklist items are generated automatically from: Salesforce tasks, touchpoint cadence engine, research pipeline, listing marketing plan, deal execution tracker
- Each item has **guided actions** — not just "do this" but "here's how, click here to do it"
- Completing an item triggers the next logical step: log the call → schedule follow-up → move to next contact
- Items carry forward to the next day if not completed
- The user can add manual items, skip items (with reason), or reschedule

### Tab: Inbox (Triage-First, Deduplicated)

The current Inbox shows duplicate email lists under "My Work" and "Inbox." Fix:

- **Single inbox** — deduplicated, sorted by strategic scoring
- **Quick triage actions**: Classify (deal/BD/operational), Link to entity, Promote to action, Dismiss
- **AI classification suggestion** on each item: "This looks like a deal response (DaVita Palmdale). Classify as Strategic?"

### Tab: Business (Domain Intelligence → Action)

The Gov and Dia tabs should shift from "show me data" to "what should I do with this data":

**Government:**
- **Pursuits** — Active listing pursuits with stage, next action, days in stage
- **Lead Pipeline** — New ownership research → completed research → outreach initiated → response → BOV request
- **Active Listings** — Marketing status, buyer outreach progress, seller reporting
- **Research Queue** — Pending items sorted by strategic value, with guided completion flow

**Dialysis:**
- **Growth Signals** — Clinics with patient growth, new openings (auto-surfaced from CMS data)
- **Lead Pipeline** — Same pipeline stages as government
- **Active Listings** — Same marketing structure
- **Research Queue** — Same guided flow

### Tab: Contacts (Relationship Engine)

Contacts should not be an address book. They should be a **touchpoint management surface**:

- Contacts grouped by: Sellers (owners) | Buyers | Brokers/Partners
- Each contact shows: engagement score, touchpoint cadence status, next touch due, deal linkage
- Filter by: overdue for touch, new leads (< 6 months, < 7 touches), top-tier accounts
- One-click: call, email, log, schedule next touch

---

## 5. The Lead-to-Close Pipeline Engine

The most critical missing piece. LCC needs a **pipeline view** that tracks every lead from first identification through to deal close:

```
LEAD PIPELINE

Discovery → Research → Outreach → Engaged → BOV/Proposal → Listed → Marketing → Under Contract → Closed

Stage                Count    Avg Days    Stuck (>2x avg)
─────────────────────────────────────────────────────────
Discovery              12        3 days      0
Research               14        8 days      3 (>14 days)
Outreach Initiated      8       12 days      1
Engaged (responding)    4       45 days      0
BOV/Proposal            2       14 days      0
Listed                  2         —          —
Marketing               1       30 days      —
Under Contract          1       45 days      —
Closed (YTD)            3         —          —
```

Each stage has:
- **Entry criteria** — what moves an item into this stage
- **Guided work** — what the user needs to do at this stage
- **Exit criteria** — what moves it to the next stage (or marks it dead)
- **Stuck detection** — items that have been in a stage longer than 2x the average

**Stage transitions drive the checklist.** When a research item completes, the system automatically creates the outreach task. When the outreach gets a response, the system prompts for a BOV.

---

## 6. Salesforce Integration: Two-Way Pipeline Sync

The pipeline engine must stay in sync with Salesforce:

| LCC Pipeline Stage | Salesforce Equivalent | Sync Direction |
|--------------------|-----------------------|----------------|
| Discovery | Lead (new) | LCC → SF |
| Research | Lead (researching) | LCC → SF |
| Outreach Initiated | Task (outreach) | LCC → SF |
| Engaged | Opportunity (qualifying) | Bidirectional |
| BOV/Proposal | Opportunity (proposal) | Bidirectional |
| Listed | Opportunity (listed) | Bidirectional |
| Marketing | Opportunity (marketing) | Bidirectional |
| Under Contract | Opportunity (under contract) | Bidirectional |
| Closed | Opportunity (closed won/lost) | SF → LCC |

**Call logging flow:**
1. User clicks "Call" on a contact in LCC
2. Makes the call
3. LCC prompts: "Log this call?" with pre-filled fields (contact, topic, outcome)
4. User logs outcome and sets next action
5. LCC creates Salesforce Task (call log) and schedules follow-up
6. Contact engagement score updates automatically

---

## 7. Marketing Execution Engine

For each active listing, LCC maintains a **marketing execution plan** with guided steps:

**Listing Launch Checklist:**
- [ ] OM prepared and uploaded to deal folder
- [ ] Buyer list generated (target: 150+ for core markets)
- [ ] Pre-market early looks sent to top 20 buyers
- [ ] Full market launch: OM distribution to buyer list
- [ ] Broker community blast sent
- [ ] Listing announcement sent to seller contact list (85+)
- [ ] CoStar/LoopNet listing confirmed active
- [ ] First week follow-up: call all OM downloaders
- [ ] Week 2: second outreach to non-responsive downloaders
- [ ] Weekly seller report (recurring)
- [ ] Closing announcement prepared (when deal closes)

Each checklist item has guided actions and tracks completion. The system generates the next item when the previous one is done.

**Buyer outreach tracking per listing:**
- Total buyer list: 150
- Contacted: 35 (23%)
- OM Downloaded: 12 (8%)
- Showings: 3
- Offers: 1
- Follow-ups needed: 8 downloaders not called

---

## 8. Implementation Approach

This is not a single sprint. This is a multi-sprint product rebuild that should be sequenced:

### Sprint 1: Fix the Homepage + Deduplicate Inbox
- Homepage becomes scoreboard (planned vs. completed by category)
- Merge duplicate "My Work" and "Inbox" email lists into single deduplicated view
- Add overdue alert links to relevant tabs

### Sprint 2: Build the Lead Pipeline Engine
- Define pipeline stages in the database (schema migration)
- Build pipeline view with stage counts, velocity, and stuck detection
- Wire Salesforce opportunity stages to LCC pipeline stages
- Auto-transition: completed research → outreach task created

### Sprint 3: Guided Daily Checklist (My Work Tab)
- Auto-generate daily work plan from: SF tasks, touchpoint cadence, research queue, marketing plan
- Guided action buttons on each checklist item
- Completion tracking with carry-forward
- Call logging flow: click → call → log → schedule follow-up

### Sprint 4: Marketing Execution Engine
- Per-listing marketing checklist
- Buyer outreach tracking (contacted, downloaded, shown, offered)
- Automated seller report generation on schedule
- OM downloader follow-up queue

### Sprint 5: Touchpoint Cadence Engine
- Contact-level touchpoint scheduling (7 in 6 months, 4/year, monthly for top-tier)
- Automatic touch due date calculation based on contact tier
- Cadence tracking dashboard
- Mass marketing integration (quarterly reports, listing/closing announcements count as touches)

---

## 9. What Exists Today vs. What Needs to Be Built

### Exists (keep and build on)
- 29 Copilot actions with strategic scoring engine
- Domain databases (Gov, Dia) with property, ownership, clinic data
- Salesforce sync (activities, tasks, contacts)
- Contact engagement scoring
- Entity graph with external identity linking
- Research task workflow (queued → in_progress → completed)
- Action item lifecycle (open → in_progress → completed)
- Power Automate flows for Outlook/Calendar/To Do
- Copilot chat with action-aware system prompt

### Needs to be built
- Lead-to-close pipeline stages (schema + UI)
- Guided daily checklist generator
- Touchpoint cadence engine with contact-tier scheduling
- Marketing execution checklists per listing
- Salesforce bidirectional pipeline sync
- Homepage scoreboard (planned vs. completed)
- Inbox deduplication
- Call logging → SF task creation → follow-up scheduling flow
- Stage transition automation (research complete → outreach created)

### Needs to be redesigned
- My Work tab → guided checklist
- Business tabs → action-oriented (pursuits, pipeline, marketing, research)
- Contacts → touchpoint management engine
- Homepage → scoreboard with overdue alerts
