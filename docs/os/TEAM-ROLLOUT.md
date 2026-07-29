# LCC Team Rollout — Per-Member Flows & Authorizations

_Living document. How we bring each Team Briggs member into the LCC. Rollout order: **Kelly Largent** →
**Nate Berwaldt** → **Sarah Martin**. Last updated 2026-07-28._

> ## 🚦 STATUS: PACKAGE READY — DO NOT EXECUTE YET
> Per Scott's directive, **no member is onboarded until the full LCC design is worked end-to-end, errors are
> triaged, and the system is verified working as intended.** This document is the ready-to-run package we hold
> until that gate clears; it is kept current as the design evolves. Go-live checklist for lifting the hold is at
> the bottom.
>
> **Engine readiness (good news):** cadence accuracy for a new broker comes from *ingesting their mailbox*
> (their deals then get activity → last-touch → accurate cadence), and the matcher/cadence already handle any
> Team-Briggs-scoped deal — so **no LCC engine change is required to onboard Kelly**; it's his flows + connections.
> (Per-broker *attribution* — who-touched-it — is a separate provenance task tracked under "Known gaps.")

## The model — three tiers of flow
The ~50 Power Automate flows fall into three buckets. Onboarding a person is really about tiers 2 and 3.

1. **Shared / org-level (already built by Scott — NOT replicated).** These operate on shared data (the SF
   pipeline, the property DB, the LCC engine) regardless of who's on the team, so they run once for everyone:
   `SF Deal → LCC Opportunity Sync`, `SF Deal Team → LCC Roster`, `SF Deal Contacts → LCC Roster`,
   `LCC → SF Queue Drainer`, the `SF → LCC` sync family (Object/Event/Activity/Record/Bulk File Backfill),
   `SF Listing Activity → LCC engagement`, `Google News Alert → LCC Lead Ingest`, `LoopNet Feeder/Backfill`,
   the `Http → Put/Get/List/Create file` artifact plumbing, `Team Briggs Weekly Pipeline`. **A new member needs
   none of these built** — they already benefit (e.g. their SF deals already sync, because the Opportunity Sync
   pulls all Team Briggs record types).
2. **Per-person "broker core" (each member replicates with THEIR OWN connections).** These read/write an
   individual's mailbox, calendar, tasks, and deal folders — so each person needs their own copy, authorized as
   themselves. This is the heart of onboarding (detailed below).
3. **Role-specific additions.** Extra flows or a whole database build-out depending on what the person does.

## The connections each per-person member authorizes (once)
Every member, when they set up their per-person flows, signs into these connections **as themselves** (this is
the same mechanism Scott's email already uses — a per-mailbox Power Automate connection, not an app login):

| Connection | Used for |
|---|---|
| **Office 365 Outlook** | Mailbox intake (correspondence → cadence), send, drafts, calendar |
| **Microsoft To Do** | Task sync (flagged email → task, completion poll) |
| **Microsoft Teams** | Briefing + intake delivery to the person |
| **SharePoint / OneDrive** | Deal-folder watch, OM/document ingestion |
| **Salesforce** | Only if they run any SF-touching per-person flow (most are shared — usually not needed per person) |

## Per-person "broker core" bundle (the replicable set)
For each member, create a copy of each flow below (Save As / export-import), then repoint every connection to
that member's account. Source flow names in your environment shown in `code`.

| # | Per-person flow | Purpose | Connection |
|---|---|---|---|
| 1 | `LCC - Outlook Intake to Teams (Hardened)` | **The key one** — their mailbox → `activity_events`, stamped with THEIR identity so cadence/last-touch is accurate for their deals | Outlook |
| 2 | `To Do - Life Command Center Sync` + `LCC To Do Completion Poll` + `Flagged Email to To Do` | Their task loop (flag mail → task → completion writes back) | Outlook + To Do |
| 3 | `LCC Outlook Calendar Write` + `Outlook Calendar - Life Command Center Sync` | Their calendar ↔ LCC | Outlook |
| 4 | `LCC Create Outlook Draft` | LCC drafts replies in their mailbox | Outlook |
| 5 | `Inbox Janitor` + `LCC Flagged Email Cleanup Sweep` | Their mailbox hygiene | Outlook |
| 6 | `Email Discovery - Auto Drain` / `by Contact` | Contact/relationship discovery from their sent/received mail | Outlook |
| 7 | `LCC - Daily Briefing to Teams` / `LCC Morning Briefing v2` | Their personal briefing delivered to them | Teams |
| 8 | `LCC — Phase 1 Deal Dossier Folder Watch` | Their deal folders → dossier/OM ingestion | SharePoint |

> **Engine prerequisite (Scott/Claude, one-time):** the intake promoter must stamp `activity_events.actor_id`
> with the owning broker instead of `SYSTEM_ACTOR` (today all mail is system-attributed). This is B2 Phase 1 —
> small, no mailbox changes — and it's what makes per-broker cadence real. Do this before/with Kelly's mailbox.

---

## Member 1 — Kelly Largent  (rolling out now)
**Role in LCC:** Broker, functions like Scott. Works heavily in the **dialysis + medical** portions of the
database. Owns the majority of the current open pipeline (17 of the open deals).

**What Kelly builds:** the full **broker-core bundle (1–8 above)** with his Outlook/To-Do/Teams/SharePoint
connections. That's the whole onboarding — no new database.

**Data/specialty:** Kelly works *inside the existing* dialysis (`Dialysis_DB`) and medical/net-lease data —
which is already built and shared. So **no new database build-out for Kelly**; he inherits the dialysis/medical
DB and its comps/BOV skills immediately.

**Kelly's checklist:**
- [ ] Engine: per-broker `actor_id` attribution live (B2 Phase 1).
- [ ] Kelly authorizes: Office 365 Outlook, Microsoft To Do, Teams, SharePoint.
- [ ] Replicate broker-core flows 1–8, connections repointed to Kelly.
- [ ] Verify: Kelly's mailbox produces `activity_events` attributed to Kelly; his cadence-scan / owner-scoped
      digest goes from empty to real (un-parks B1 per-broker delivery for him).
- [ ] Confirm dialysis/medical comps + BOV skills resolve for Kelly's deals (already shared — spot-check).

---

## Member 2 — Nate Berwaldt  (after Kelly)
**Role in LCC:** Financial analyst *transitioning to full broker*. Two-phase onboarding.

- **Phase A (analyst):** financial-analysis support — no deal cadence yet. Needs the mailbox/to-do/calendar
  core (flows 1–5) so his correspondence and tasks flow, but not the full broker deal-cadence surface.
- **Phase B (broker):** the complete broker-core bundle (1–8), functioning like Kelly and Scott.
- **Specialty DB (future):** Nate will likely get his **own subspecialty database build-out** — e.g. **urgent
  care / medical net-lease on existing listings** — a NEW domain like `Dialysis_DB`/`government` (its own
  Supabase project + ingestion pipelines + comps/BOV skills). That's a project in itself, scoped when he's ready.

**Nate's checklist (staged):** core connections + flows 1–5 first → add 6–8 at broker transition → scope the
subspecialty DB build as a separate track.

---

## Member 3 — Sarah Martin  (after Nate)
**Role in LCC:** Operations & marketing analyst. **Her LCC function looks most different** — she doesn't carry a
deal pipeline, so the broker deal-cadence flows are largely N/A. Her surface is marketing/ops.

- **Core:** mailbox/to-do/calendar (flows 1–4) so her correspondence and tasks are in LCC.
- **Her work surface (ops/marketing flows, not broker cadence):** `SF Get Campaign Members`,
  `marketing_leads` intake, `SF Listing Activity → LCC engagement`, `RCM Cleanup`, `LCC Weekly Retention Sweep`
  — these are the marketing/engagement automations that match her function. Some are already shared; her
  onboarding is about giving her the ops/marketing *views and deliverables*, not a deal digest.
- **No specialty DB / no deal cadence** — instead, ops dashboards, campaign/engagement tracking, retention.

**Sarah's checklist:** core connections + flows 1–4 → wire her to the marketing/ops flow set + an ops-oriented
digest (design her surface separately, since it diverges most from the broker template).

---

## Execution recipe (how to actually replicate a per-person flow) — HELD until go-live
For each broker-core flow (1–8), the replication is the same 3-step recipe. Two packaging options; recommend the
Solution for 3+ people.

**Option 1 — Save-As-and-reconnect (fastest for one person):**
1. Open the source flow → **Save As** → rename with the member's name (e.g. `Kelly — Outlook Intake`).
2. Open the copy → for every action, **repoint the connection** to the member's account (Outlook/To-Do/Teams/
   SharePoint) — the member signs into each connection once when prompted.
3. Update any hardcoded owner value (mailbox address, "to" recipient, briefing target) to the member; turn On.

**Option 2 — Solution package (recommended, cleaner at scale):**
1. Scott adds the 8 broker-core flows to a Power Automate **Solution** with the connections as
   **connection references** (not hardcoded).
2. **Export** the Solution (managed) once.
3. Each member **imports** it and, during import, binds the connection references to their own connections.
   One import per member instead of 8 Save-As operations. *(Scott builds the Solution; Claude can't export from
   here — this is the one packaging step that must happen in the PA UI.)*

## Per-member go-live checklist (lift the hold only when ALL are ✅)
System-level gates (must be true before ANY member):
- [ ] Full deal-intelligence spine verified end-to-end (sync → roster → matcher → cadence → digest).
- [ ] Error triage complete: 0 open ERROR-level items; ops-health alerts resolved or explained.
- [ ] Reconciliation verified (open flagged backlog = 0; addresses correct — ✅ done 2026-07-28).
- [ ] Owner-scoped digest verified per-broker (dry-run against a broker with deals).

Per-member gates (Kelly first):
- [ ] Member authorizes the 4 connections (Outlook, To Do, Teams, SharePoint).
- [ ] Broker-core flows 1–8 stood up (via Solution import or Save-As), connections repointed, turned On.
- [ ] Verify: member's mailbox produces `activity_events`; their in-scope deals gain last-touch; their
      owner-scoped digest renders with real content.
- [ ] Un-park B1 (per-broker delivery) for that member; retire the coverage caveat for their deals.

## Known gaps / dependencies (tracked, not blocking the package)
- **Actor-identity reconciliation (attribution).** For team-visibility "who-touched-it", the `users` actor table
  needs real broker identities — today `klargent@`, `smartin@`, etc. rows all read "Scott Briggs"; the correct
  identities live in `lcc_users`. And the intake attributes to the auth user, not the mailbox owner. This is a
  deliberate identity build (provenance, not cadence). Scoped separately; NOT required for Kelly's cadence.
- **Sarah's ops surface** — separate mini-design (most divergent role; no deal cadence).
- **Nate's subspecialty DB** — separate build track (urgent care / medical net-lease domain) at his transition.
- **To-Do PA flows** currently failing (deleted To-Do list) — repair before those flows are part of anyone's
  bundle (see ERROR-TRIAGE.md).
