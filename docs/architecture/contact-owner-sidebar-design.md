# P1 — Contact / Owner Sidebar: design (2026-07-31)

The second side panel that opens when you click any party (owner, broker, buyer, developer, lender,
contact) anywhere in the LCC — beside the property panel, not replacing it. Designed so the **layout
itself funnels the user to the next course of action we want**. Plan-before-code (Scott's ask); this
doc is the spec the build follows.

## What already exists (reuse, don't rebuild)
- **`buildContact360(entityId)`** (`/api/entities?action=contact360&id=`) — ONE aggregating read that
  already returns everything the panel needs: entity (+ external identities + relationships),
  `unified_contacts` engagement (score, last call/email/meeting, totals, transactions, volume), the
  **account owner / ROE** (`resolveAccountOwner`), the **portfolio** (owned/former properties via
  `fetchEntityPortfolio`), the **unified activity timeline** (LCC `activity_events` + dia
  `salesforce_activities`, broker-labeled), **open SF tasks**, **marketing_leads**, the **email
  relationship** summary + recent, and person→org ownership edges. **No new backend read needed for v1.**
- **Panel machinery:** `index.html` has one `.detail-panel` slide-over with header / breadcrumb / tabs /
  completeness rail / **`detail-next-step`** / body / **`next-action-bar`**. Today clicking a party
  PUSHES a new level onto `_detailStack` (breadcrumb back-nav) — a *stack*, not a side-by-side panel.
- **`entityLink(text, type, id, db)`** — the clickable party chip (already used by P3.2/P3.3).
- **`lcc_owner_prospecting_status`** (P3.3) — cadence status/tier/last+next touch for owners.

## The design principle — layout as a funnel to the next action
Every section earns its place by moving the user one step toward acting. Top → bottom:

**1. Identity header** — name, a **role-in-context** line ("Owner of Fresenius – Woodland Hills" /
   "Buyer on this deal" / "Listing broker"), firm/org (for a person), SF-link state. Answers *who*.

**2. THE next action (hero)** — the single highest-priority move, chosen by a deterministic rule, as
   ONE primary CTA + at most one secondary. This is the "direct the user by design" element. Priority
   ladder (first match wins):
   - No contact method on file → **Find contact** (public-records enrich; currently paused — show as
     the CTA, wired when re-enabled).
   - Not linked in Salesforce → **Connect in SF** (create/attach the account/contact).
   - Cadence touch overdue (`next_touch_due` past) → **Log the due touch** (call/email per
     `next_touch_type`) — advances the cadence, same loop My Day drives.
   - Active reply awaiting us (last inbound unanswered) → **Reply / Log follow-up**.
   - Otherwise → **Log Touchpoint** (start/continue the relationship).
   The hero reuses the existing `next-action-bar` styling.

**3. Relationship & standing** — are we prospecting them? **tier**, **who owns the relationship (ROE)**,
   last touch + days-since, cadence next-due, engagement (emails sent/replied, calls connected). Tells
   the user *where they stand* before acting. ROE ("Kelly owns this relationship") is the territory
   guardrail Scott wants for rules-of-engagement.

**4. Portfolio / holdings** — what they own (`portfolio_count` · `our_open_deals`, from P3.3), each a
   clickable property chip. For an owner this is their whole book — the BD context and cross-sell surface.

**5. Recent correspondence & activity** — the unified timeline, newest first (email/call/meeting),
   broker-labeled. The content that informs the next move. **Correspondence-privacy (Phase 2):** for
   non-leads, filter to the logged-in user's own correspondence; the lead sees all.

**6. Contact methods** — email (click-to-draft), phone (click-to-call), with source. The "how to reach."

**7. Actions rail (bottom)** — Log Touchpoint · Log Call · Draft Email · Add to BD marketing list ·
   Connect SF. **These are the contact/CRM functions Scott wants OFF the property page and ON here** —
   the property page's "Log Touchpoint / Log Call / Activity" move to this sidebar (property-tab notes).

## Second-panel behavior (the "to the side" ask)
- **Phase 1 — companion panel.** A second panel container beside the property panel (right of it, or
  the property panel narrows), reusing the `.detail-panel` styling. Both visible at once. Clicking a
  party opens/updates the companion instead of stacking over the property. Its own close button; the
  property panel stays put. This delivers the core "second sidebar" value with the least risk.
- **Phase 2 — float / drag / minimize / dock.** Promote the companion to a draggable, minimizable,
  dockable floating window (Scott's "floating window that can be dragged or minimized and docked").
  Layered on Phase 1; higher UI-complexity, done after Phase 1 is validated.

## Data flow (one call, computed next action)
click party → `entityLink` → `openContactOwnerPanel(entityId|name, db)` →
`GET /api/entities?action=contact360&id=<entity>` → render sections 1–7. The **hero next action** is
computed client-side from the contact360 payload (contact-on-file? SF-linked? cadence due? unanswered
inbound?) via a small `_nextActionForContact(c360)` resolver — deterministic, documented, testable.

## Connectivity re-eval + enhancement hooks (Scott's standing directive)
- **Local-LLM layer:** a one-line **relationship summary** at the top of section 3 ("dormant tier-A
  landlord; 13 emails / 0 replies since Feb 2023; owns 223 properties — try a fresh angle"), synthesized
  locally from the timeline + cadence. Natural home for GaryBuilt/Ollama; renders when configured.
- **Public-records enrichment:** the section-2 "Find contact" CTA is the entry point to the owner-contact
  enrichment chain (currently PAUSED — SOS-direct blocked from CI); becomes one-click when re-enabled.
- **Cadence rep (ROE):** section 3's "who owns this relationship" needs the upstream cadence
  `owner_user_id` stamp (documented producer gap) to be reliably populated.
- **Correspondence pipeline:** section 5 reuses the 872 ingested deal emails; the privacy filter is the
  Phase-2 participant-stamp.
- **My Day loop:** section-2 hero actions that advance cadence feed the same next-best-touch loop My Day
  surfaces — the owner panel and My Day become two views of one prioritization engine.

## Tabs (Scott, 2026-07-31) — the sidebar is a tabbed BD + research copilot
The Overview funnel (sections 1–7) is **Tab 1**. Add:

**Tab 2 — Portfolio & History.** Current + prior **ownership** and **development** (as owner / as
developer), current + prior **listings & sales** (as broker / co-broker), and **lending** (as lender /
loan broker). i.e. every role this party has played on every asset, over time. Source: the party's
`entity_relationships` by type + effective dates — `owns`/`purchases` (owner/buyer), `developed`
(developer), `sells`/`brokers` (seller/broker), `finances` (lender/loan broker), `guaranteed_by` — joined
to the asset + the transaction (price/cap/date). Reuses `fetchEntityPortfolio` + the sales/deal-history
normalize; extend to the non-owner roles. **Domain-generic.**

**Tab 3 — Relationships.** The party's **working relationships** across deals: which **brokers** they
co-broker with, which **lenders** finance them, which **buyers** they've sold to — flagged especially
when they've **sold directly to a REIT / institution** (a high-value pattern). Source: graph traversal —
for the party's transactions, collect the counter-parties (buyer↔seller↔broker↔lender on the same asset/
sale) and roll up by counterparty with counts + last date + whether the counterparty is an institution/
REIT (entity org_type / a known-REIT list). This is relationship intelligence: "sold 4 assets to Realty
Income; regularly co-brokers with CBRE; financed by Northmarq Capital." Build an RPC
`lcc_party_relationships(entity)` over `entity_relationships` (no new data — the graph already holds it).

**Tab 4 — Activity & Cadence** (the copilot cockpit). Call/email history (unified timeline) **plus**:
- **Next scheduled touchpoint** — `next_touch_due` + `next_touch_type` + date scheduled (from
  `touchpoint_cadence`; already returned by `lcc_owner_prospecting_status`), and the **suggested**
  touchpoint (cadence `phase`/`next_touch_template`).
- **"Draft touchpoint email"** button (below).

## The BD-copilot closed loop (Scott's core ask) — mostly WIRING existing pieces
The ownership/contact sidebar guides the broker to the next touch and closes the loop. **Each step already
has machinery — this is orchestration, not new construction:**
1. **Suggest** the next touchpoint — from `touchpoint_cadence` (phase/next_touch_type/template) surfaced in
   Tab 4. *(exists: cadence layer.)*
2. **Draft** a context-aware touchpoint email → **Drafts/outbox**. Compose via the **local LLM** (Ollama
   seam / `invokeExtractionAI`) using the party context (cadence phase, last touch, deal/portfolio, recent
   correspondence); create the Outlook draft via the **existing** `api/_shared/outlook-draft.js` +
   `flow-lcc-create-outlook-draft.json` (`LCCCreateOutlookDraft`). **The LCC drafts; the broker reviews and
   SENDS — never auto-send** (respects the send-on-behalf boundary; user stays in the loop).
3. **Broker sends** from Outlook.
4. **Capture the sent mail** from the Sent folder → the **existing** Power Automate sent flow → `POST
   /api/intake?_route=outlook-sent` → `handleOutlookSent`, which already: **logs the activity in the LCC**
   (dual-anchor), and **advances/resolves the to-do** (`lcc_advance_todos`). *(exists.)*
5. **Reschedule the cadence** — bump `touchpoint_cadence.next_touch_due` per the cadence schedule
   (`growCadenceFromOutreach` / `advanceCadence`). *(mostly exists — confirm the reschedule fires on a sent
   touchpoint.)*
6. **Mirror to Salesforce** — log the activity as a **standard SF Task/call** and **reschedule the open SF
   task** per cadence. *(partial: the `LogActivitytoSFfromLCC` flow + `logSalesforceActivity` exist; the
   sent-capture path must TRIGGER them, and an SF task-reschedule op must be added — same signed-webhook
   pattern as the other SF flows.)*

**Connectivity gaps this exposes (the only genuinely new work):**
- (6) wire the sent-touchpoint capture → SF activity log + SF task reschedule (a flow op + a call in
  `handleOutlookSent`), and (5) confirm the LCC cadence reschedule fires on a sent touchpoint.
- The **local-LLM compose** for the draft (content generation) — gated on GaryBuilt/Ollama; until then the
  draft uses a cadence template (`next_touch_template`) so the button works today, richer with the LLM later.
- Tabs 2/3 need `lcc_party_relationships(entity)` (graph rollup) — data exists, function new.

## Build phases (updated)
1. **P1.0** — `contact360`-backed **Overview** funnel (sections 1–7) + `_nextActionForContact`, in the
   existing panel. Validate the layout/flow.
2. **P1.1** — side-by-side companion panel; party clicks open the companion.
3. **P1.2** — **Tab 4 cadence cockpit**: next scheduled touchpoint + suggested touchpoint + **Draft
   touchpoint email** button (template-based now, LLM-composed later) → Outlook draft via the existing flow.
4. **P1.3** — **close the loop**: confirm cadence reschedule on sent; wire the sent-capture → **SF activity
   log + SF task reschedule** (the new flow op). This is the copilot payoff.
5. **P1.4** — **Tab 2 Portfolio & History** + **Tab 3 Relationships** (`lcc_party_relationships` RPC).
6. **P1.5** — move the property page's contact/call actions onto the sidebar (separation of concerns).
7. **P1.6** — float/drag/minimize/dock; local-LLM relationship summary + draft compose; correspondence-privacy filter.

**Recommendation:** still ship **P1.0** first (the funnel/flow), then **P1.2 + P1.3** (the cadence cockpit
+ the closed loop) — because that closed loop (suggest → draft → send → auto-log LCC+SF → reschedule) is
the "BD copilot" heart of what Scott wants, and it's ~80% wiring of machinery we already have.

---

## Build status — review-first findings + what shipped (2026-07-31)

**Review-first finding (major): most of P1 already exists.** Before building, a pass over the real code
(`detail.js` `openEntityDetail`/`openContact360`, `entities-handler.js` `buildContact360`,
`operations.js` `bridgeDraftAndLog`) found the "second sidebar" is largely built already, not greenfield:
- **contact360 panel** — `openEntityDetail` is contact360-backed with **role-driven tabs**
  (Overview / Ownership|Deals / Activity / Engagement / ROE / Contacts), a **ROE verdict banner** across
  every tab (the standing/territory element), role label + portfolio + engagement + open tasks. `openContact360(id)` is
  the one reusable trigger, already wired from party chips.
- **Companion dock** — `closeCompanion`/companion state already exist (the P1.1 side-by-side seed).
- **The closed loop already exists** — `_entityDraftAndLog` → `POST /api/operations?action=draft_and_log`
  (**"Topic F" `bridgeDraftAndLog`**) already: renders the template, **creates the Outlook draft**
  (`createOutlookDraftViaPA`, flagged on `PA_OUTLOOK_DRAFT_URL`), **logs the completed SF activity**
  (`logSalesforceActivity`), records the send for the learning loop, and **advances the cadence**
  (`advanceCadence`, which reschedules `next_touch_due`). So "suggest → draft → log LCC+SF → reschedule"
  is ~built. *Nuance:* it logs/advances **optimistically at draft time**, not on sent-capture; the
  sent-capture (`handleOutlookSent`) is a second path. Reconciling the two (avoid double-count; make the
  sent-capture the source of truth) is the remaining closed-loop refinement — see open items.

**Shipped this session (verified):**
- **Tab 3 "Relationships" (ask #2)** — new RPC **`lcc_party_relationships(p_entity, p_limit)`**
  (migration `20260818340000`, live) rolls counterparties across shared assets into derived relationships
  (`sold_to` / `bought_from` / `financed_by` / `lent_to` / `co_broker` / `brokered_for` / `broker_on_deal`
  / `co_owner`), ranked by shared-asset count, with a **REIT/institution** name flag. Served via
  `GET /api/entities?action=relationships&id=` (grouped). Frontend `_entityTabRelationships` lazy-loads +
  renders grouped sections with an institution badge; each counterparty chip → `openContact360`. Verified
  live on Boyd Watterson (Realty Income + Office Props Income Trust correctly flagged on `bought_from`).
- **Cadence cockpit (ask #3)** — `buildContact360` now returns a **`cadence`** block (next_touch_due /
  type / template / phase / tier / last_touch / engagement counts / `overdue` / `days_until_due`) from
  `touchpoint_cadence`. Frontend `_entityCadenceCockpit` renders **"Next touchpoint"** at the top of the
  Activity tab (next + suggested touchpoint, overdue badge, unsubscribe guard) with a **"Draft touchpoint
  email"** button reusing `_entityDraftAndLog` (the existing closed loop). Verified via handler syntax +
  contract; browser render pending Scott's eyes.

- **Tab 2 "History" (ask #1)** — new RPC **`lcc_party_history(p_entity, p_per_role)`** (migrations
  `20260818350000` + `…350001` dedupe, live): every role the party has played on every asset over time
  (as owner / buyer / seller / broker / lender / developer), deduped per (role, asset), current-first,
  capped per role with an honest `role_total`. Served via `GET /api/entities?action=history&id=`
  (grouped + totals). Frontend `_entityTabHistory` lazy-loads role-segmented sections with CURRENT/PRIOR
  badges; each asset chip → its entity panel. Complements the economics-rich Ownership tab (this is the
  all-roles timeline). Verified live on Boyd Watterson (254 owned · 273 bought · 16 sold · 1 brokered).

- **Hero next-action (ask: "direct the user by design")** — `_nextActionForContact(c)` deterministic
  ladder over the contact360 cache, first match wins: suppressed → *do not contact*; no email/phone →
  *find a contact*; not SF-linked → *connect in Salesforce*; cadence overdue → *log the overdue touch*;
  last inbound unanswered → *reply*; cadence due → *next touch*; else → *log a touchpoint*. Rendered as a
  single "Next best action" hero atop Overview (tone-colored, one CTA reusing `_entityAcquireContact` /
  `_entityDraftAndLog`). Pure function — **unit-tested (8/8 ladder cases pass)** against the live file.

**Still open (next steps):**
- **Closed-loop reconciliation** — make sent-capture (`handleOutlookSent`) the source of truth vs.
  `draft_and_log`'s optimistic pre-log; add the **SF task reschedule** op (draft_and_log advances the LCC
  cadence + logs a completed SF task, but does not yet reschedule the *next* SF task).
- **Data-quality note** — `finances` edges are polluted with brokerage firms (CBRE/JLL/Cushman appear as
  "financed_by"); the Relationships lender section inherits that noise. Upstream graph-labeling fix (P2).
