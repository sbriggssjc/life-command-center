# Deal Correspondence Attribution — mail-intake's real delta
_Design, 2026-07-27._ **Mail-intake is already built.** The delta is attributing deal-relevant email to the DEAL.

## What already exists (verified)
- **Outlook email pipeline is LIVE** — `activity_events` holds **5,735** `source_type='outlook'` emails, all
  `entity_id`-resolved, latest today. Bodies average **~251 chars** → the pipeline **already distills** (not raw).
  So *ingestion + distillation + in-tenant capture = DONE.* Governance (notes stay in LCC, distill-before-egress) is met.
- **Relationship graph exists** — `entity_relationships` (from→to, `relationship_type`, effective_from/to): 109k
  edges (purchases/sells/leases/owns/brokers/finances/associated_with). This is the CRE ownership/transaction graph.

## The gap
- **Every Outlook email resolves to a PERSON (contact) — 0 to deals/assets.** The dossier reads the deal (asset)
  entity's `activity_events`, so deals see **none** of their correspondence even though it's all in LCC on the contacts.
- **New deals have no roster.** Fresenius (`a0feab2e`) has **0** `entity_relationships` edges. The 109k edges are
  the broad CRE graph, not "who are the parties on THIS active listing."

## Design — roster + attribution (NOT new ingestion)
### 1. Deal roster (deal asset ↔ its people, with role)
Populate `entity_relationships` edges: `from=deal-asset → to=person`, `relationship_type='deal_party'`,
`metadata.role` ∈ {seller, seller_counsel, buyer, buyer_rep, co_broker, escrow, title, our_broker},
`effective_from/to` = the deal window. Sources, in order:
- the dossier `.md` §3 roster (we already have Fresenius's),
- SF Opportunity contact roles (once the SF Opportunity sync lands — see cadence Phase 1),
- the CRE graph (`brokers`/`sells`/`purchases` edges on the asset) as candidates.

### 2. Deal-email matcher (which emails belong to a deal)
An email is attributed to a deal when it clears a **precision bar** (avoid over-attribution — an escrow officer
handles many deals):
- **Strong signals:** property address / escrow file # (e.g. `NCS-1288731E-SC`) / OM/PSA reference in subject or thread.
- **Roster signal:** ≥1 deal-roster person on the thread AND within the deal's effective window.
- Ambiguous / weak → **do not attribute** (reconcile-or-review), stays contact-only.

### 3. Attribution write (keep the dossier read simple)
On a match, write a **deal-attributed `activity_events` row on the asset** (`entity_id=asset`, `category=email`,
`external_id=<message_id>` for idempotency, distilled body). The dossier then surfaces it with **no query change**.
Trade-off: one extra row per deal-email (dedupe by `external_id`). *(Alt: project roster emails at read-time with
a relevance filter — no dup, heavier query. Recommend the write approach for read simplicity + idempotency.)*

## Where the matcher runs
- **Recommended:** a periodic LCC pass (engine job or PA recurrence) over recent contact-emails → match to open
  deals via roster + strong signals → write deal-attributed rows. Decoupled from the (external) Outlook pipeline.
- Alt: extend the Outlook ingest to deal-match at write time (tighter, but couples to a pipeline we don't own).

## Payoffs beyond the dossier
- **Cadence engine** gets real per-deal last-email/last-call from the roster → accurate "next touch due".
- **Contractual mode** — a matched inbound email can satisfy a milestone (CO received, estoppel delivered).
- **Weekly pipeline email** reflects true activity, not just logged calls.

## Phases
- **Phase 1 — Roster.** Populate `entity_relationships` deal_party edges from the dossier `.md` rosters (+ SF Opp
  contacts when that sync exists). Backfill Fresenius as the test.
- **Phase 2 — Matcher.** The periodic deal-email matcher (roster + strong signals) → deal-attributed rows.
- **Phase 3 — Milestone satisfaction.** Matched inbound mail flips contractual milestones (needs a milestone→email
  rule set).

## Open questions
1. **Matching precision** — start strict (escrow#/address/OM-PSA + roster) and widen, or roster-participation alone?
2. **Dual-write vs read-projection** for attribution (recommend dual-write w/ `external_id` dedupe).
3. **Roster source of truth** — the `.md` dossier roster now, SF Opportunity contacts once synced; reconcile the two.
