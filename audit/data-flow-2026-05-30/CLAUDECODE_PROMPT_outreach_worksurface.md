# Claude Code (life-command-center) — make the prospect cadences WORKABLE (the outreach work-surface)

## Why (grounded live on LCC Opps `xengecqvemvfknjvbvrq`, 2026-06-26)

The outreach PLUMBING is verified working — this round is about making the
operator actually work the list. Grounded:
- The advance bridge is healthy: **0 advance-failures**, and correctly-categorized
  SF events that land on a cadence entity advance **27/27**. The OUTREACH#1
  categorization fix is live (SF `note`-Tasks stopped 2026-06-19; `email` events
  flow through today). So when a touch happens, the loop closes.
- The gap is WORK, not mechanics: **218 active cadences, 197 reachable (have a
  contact), ~209 overdue — but only ~9 have ever been touched.** Scott's real
  outreach in 60d hit ~19 entities; the other ~190 reachable, value-ranked
  prospect cadences are sitting unworked. **Decision (Scott, 2026-06-26): make
  this prospect list workable** — invest in the work-surface so it's frictionless
  to knock out the highest-value prospects.

The loop already EXISTS (R10 Unit 4: `cadence_dashboard` action +
`renderCadenceDashboard` + `cadDraft`/`cadMarkSent`/`cadLogTouch` + the
`?_route=draft` `generate`/`record_send` endpoints + `advanceCadence` the single
advance owner; R34 value-ranked it; R63 made the default the actionable set).
**Reuse all of it.** This round fixes three friction points that keep it from
being a daily-driver surface. No new api/*.js; reuse `advanceCadence`; no sending
integration (mailto/copy stays — Scott sends from his mail client, then Mark sent).

## Unit 1 — surface it where Scott will actually use it (placement + honest count)

Today the worklist is reached via a "Cadence dashboard →" button off the Priority
Queue header — buried. Make it a first-class daily surface:
- Add a prominent entry on the **Today page**: "Work your outreach — N due · $X in
  reach" (N = actionable overdue cadences, $X = sum of their `rank_value`), that
  lands DIRECTLY in the focused worklist (Unit 3), not a generic dashboard. Honest
  count = actionable (reachable, non-paused, overdue), never the raw 909-row view.
- Keep the existing dashboard reachable, but the Today entry is the daily on-ramp.
- Value-ranked by `rank_value DESC` (R34) so the highest-value prospect is first.
  Grounded: ~197 actionable, top ~$27M, ~39 ≥ $1M.

## Unit 2 — resolve the draft recipient (no dead drafts)

**~32% of email-next cadences have no recipient email**, so the draft `mailto:`
opens with an empty `to:` — a dead end. Resolve the recipient from every source
before falling back:
- Order: the cadence's `contact_email` (already on `v_bd_cadence_dashboard`, R20
  Unit 3) → the contact person entity's email → any email on a person linked to
  the owner entity → (if a SF contact path exists) the SF contact's email.
- When genuinely none: render an **inline "add email" field** on the card (one
  input → saves to the contact/person entity → draft becomes sendable), NOT a
  dead `mailto:`. Never fabricate an address; Copy-to-clipboard always available
  as the fallback.
- Surface the resolved recipient on the card ("To: jane@acme.com") so Scott sees
  it before sending.

## Unit 3 — a focused "work session" (one card at a time, auto-advance)

Turn the flat list into a knock-it-out flow:
- A **focus queue**: top-N actionable cadences by `rank_value`, one card at a time.
  Card shows who + WHY (owner, portfolio/connected value, last touch / overdue
  days, the property context) so Scott knows why this prospect matters.
- **Email-next:** "Draft" → the existing `generate` (subject + editable body, with
  the Unit-2 resolved recipient) → **Copy** / **Open in mail** (`mailto:`) →
  **Mark sent** → which advances via `record_send`/`advanceCadence` (the single
  advance owner; no double-advance) AND **auto-advances to the next card**.
- **Call/VM-next:** "Log touch" → `advance_cadence` → next card.
- A **Skip / Snooze** that records a disposition and moves on (so a card Scott
  won't work doesn't block the session — push `next_touch_due` out or pause with a
  reason, never silently re-serve).
- Session progress ("12 of 40 worked · $48M touched") so it feels like progress.

## Boundaries / verify

- life-command-center; client-side (`ops.js` / `app.js` / `index.html`) + the
  existing `?_route=draft` endpoint for recipient resolution if needed; **no new
  api/*.js (stays 12)**; reuse `advanceCadence` (never a second advance owner);
  Northmarq brand on new chrome.
- No sending integration — Scott sends from his mail client; "Mark sent" records
  the touch. Never fabricate a recipient.
- `node --check`; suite green; the cadence dashboard / draft / advance tests still
  pass.
- **Live proof (Cowork verifies):** the Today entry shows the honest actionable
  count + value and lands in the focus queue; a high-value email-next card resolves
  a real recipient, drafts, and "Mark sent" advances the cadence (it leaves the
  overdue set) and auto-advances to the next card; a no-email card offers inline
  add-email instead of a dead draft; the touched cadences' `last_touch_at` updates
  and they drop off the actionable list.

## Documentation

Update life-command-center CLAUDE.md: the outreach work-surface — Today on-ramp
("Work your outreach — N due · $X"), recipient resolution (contact → person →
linked-person → SF → inline add-email; never a dead draft), and the focus-mode
draft→mark-sent→auto-advance session. Reuses R10 Unit 4 + R34 ranking + the single
`advanceCadence` owner; no new api/*.js.

## Optional (low ROI — only if trivial)

The ~52 pre-2026-06-19 `note` backlog events (real correspondence that predates
the categorization fix) never advanced their cadences. A one-shot re-categorize +
advance could recover them, but most are admin/deal-execution emails ("Sent RE:
Invoice/Funding"), so the value is marginal. Skip unless trivial.

## Bottom line

The outreach loop works mechanically; the operator just isn't working the list.
Make it a daily-driver surface: a Today on-ramp with an honest value-ranked count,
drafts that always resolve a recipient, and a focus-mode session that advances
card-to-card. This converts the connected, value-ranked BD data into actual touches
— the payoff of everything built so far.
