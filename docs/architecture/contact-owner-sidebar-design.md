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

## Build phases
1. **P1.0** — `contact360`-backed panel body with the 7-section funnel layout + `_nextActionForContact`
   resolver, rendered in the EXISTING stacked panel first (fastest to ship + validate the layout/flow).
2. **P1.1** — the companion (side-by-side) second-panel container; party clicks open the companion.
3. **P1.2** — move the property page's contact/call actions onto the sidebar (separation of concerns).
4. **P1.3** — float/drag/minimize/dock (Phase 2 behavior).
5. **P1.4** — local-LLM relationship summary; correspondence-privacy filter.

**Recommendation:** ship **P1.0** first — it delivers the logical next-action-first layout Scott asked
for and validates the flow inside the panel we already have, before taking on the second-container +
drag/dock UI risk. P1.1 (side-by-side) immediately after.
