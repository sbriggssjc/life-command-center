# The Unified Intelligence Layer (self-resolving to-do / inbox / brain)

_2026-07-30. Direction doc. The to-do list, inbox, and LCC are ONE intelligent, self-resolving layer — not a
manual checklist. Every activity (email sent/received, call in/out, meeting, note) is ingested, auto-resolves the
work it satisfies, advances cadence, and feeds the draft/template/cadence learning loops — so what surfaces is a
single prioritized list of exactly what needs doing (work + personal), much of it already prepped by proactive
subagents. Extends `offer-context-connectivity.md` (same close-the-loop pattern, applied to the activity layer)
and operationalizes the **Producer/Consumer Consumption Layer** doctrine in `CLAUDE.md`._

> **Lineage / reconciliation:** this is the *built realization* of the April-2026 vision in
> `context_packet_schema.md` + `context_broker_api_spec.md`. Key evolution: the packet is realized as
> **projections over the spine** (SQL RPCs — `lcc_offer_context`, `mcp/deal-dossier-tools.js`), **not** the
> separate stateful "Packet Assembly microservice" those drafts proposed. Same thesis, leaner realization
> (assemble-on-read from one enriched spine). Do not build the microservice; enrich the spine + resolve on read.

## Thesis
A to-do you have to remember to check is a failed to-do. The list should be the *output* of an intelligence layer
that already knows what happened (activity), what it means (resolution), and what's next (cadence) — ranked by the
scored queue. AI + subagents do the preparatory work ahead of you; you make the judgment calls.

## What exists to build on (don't fork — extend)
- **Event spine:** `activity_events` (every touch), `action_items` (to-dos), `touchpoint_cadence` (the 38-mo cadence).
- **Single-advance-owner:** `advanceCadence()` / the `lcc_activity_event_advance_cadence` trigger — each activity
  advances a cadence exactly once. Any new ingest funnels through this, never a parallel advancer.
- **Scored queue:** `v_priority_queue*` (P0…P8 bands) — the ONE ranked surface; to-dos ride it, never a separate list.
- **Draft + log:** `bridgeDraftAndLog` (draft → log → advance), `recordTemplateSend` + `template-refinement` (the
  template learning loop), Cortex `log_memory` (durable relationship memory).
- **Consumption-layer doctrine (already canon):** value-gate the producer · auto-retire + auto-resolve · surface
  actionable-only, ranked, capped · close the loop from real activity · honest counts.

## The gaps (why it isn't yet self-resolving)
1. **Ingest is inbound-only, one mailbox.** LCC ingests flagged *inbound* email from a single mailbox. **Sent email**
   and **inbound/outbound calls** are not ingested — so the system can't see the human's own actions, which is
   exactly what should auto-resolve to-dos and advance cadence.
2. **To-dos don't auto-resolve.** `action_items` are created (producer) but rarely auto-closed when their premise is
   satisfied (a sent reply, a completed call, a filed doc). Missing the **auto-retire predicate** per item type.
3. **No content→draft learning from outcomes.** Sent drafts and their replies aren't fed back to improve the next
   draft/template or the cadence timing beyond the existing template loop.
4. **Little proactive prep.** Work surfaces as "to do," not as "here's the drafted next touch / assembled packet,
   ready to review." Subagents don't yet run ahead of the human.

## The loops to close (build order)
1. **Ingest sent email + calls.** Extend the intake path to **sent items** (Outlook Sent folder via the same
   PA→intake channel) and **call logs** (in/out, with disposition). Each becomes an `activity_event` with actor =
   the human, funneled through the single cadence-advance owner. *This is the keystone — everything below depends on
   the system seeing the human's own actions.*
2. **Auto-resolve to-dos from activity.** Give each `action_type` an **auto-retire predicate**: e.g. an `offer_review`
   To-Do closes when the submission draft is sent; a "call X back" closes on a logged outbound call to X; a "reply to
   Y" closes on a sent email to Y. High-confidence → auto-resolve (provenance-tagged, reversible); ambiguous → leave
   for human. Honest counts: a closed item is real work done, not hidden.
3. **Cadence from real activity (extend the trigger).** Sent emails + calls advance `touchpoint_cadence` via the
   existing single-advance-owner — so "next touch due" reflects what the human actually did, and the queue self-quiets.
4. **Content → draft/cadence learning.** Feed sent-draft + reply outcomes into `template-refinement` (which subject/
   structure got a reply) and cadence timing (what interval converts). The next draft is pre-shaped by what worked.
5. **Proactive subagents.** For the top of the scored queue, a worker prepares the artifact *before* you ask — drafts
   the next cadence touch, assembles the offer/deal packet, pulls the comp set — and parks it as "ready to review"
   on the queue. You approve/send; you never start from blank.
6. **One prioritized surface, work + personal.** The scored queue is the single ranked list across domains (personal
   binds to the same OS, scoped). "To-do list" = the actionable, value-gated, ranked slice of the intelligence layer.

## Invariants (non-negotiable, carried from canon)
- **Every producer names a consumer** (human verdict, worker, or auto-sweep). No new producer without a value-gate,
  an auto-retire predicate, and a ranked/capped actionable-only surface.
- **Fill-blanks · provenance-tagged · reversible · confidence-scored.** Auto-resolution is soft/reversible; a
  low-confidence close is surfaced for confirmation, never silently hidden.
- **Single-advance-owner** for cadence; **honest counts** on every badge; **resolve-or-refuse** on any inference.
- **Same engine → same result on every surface** (Copilot/ChatGPT/Claude): resolution lives in `mcp/`+`api/`, not
  per-surface.

## Relationship-primary, deal-subfilter (the transactional lifecycle) — foundational model
**The durable BD unit is the PARTY (client / broker), not the deal.** Deals are sub-contexts under a relationship.
This is a hard requirement from how the business actually works (2026-07-30, Scott):
- **Heavy-volume sellers/brokers** transact many deals — anchoring their context to any single deal is wrong;
  their context lives at the **relationship** level, with **deal-level subfilters**.
- **The business is transactional.** A deal's topics **end at disposition**. Once sold, that deal's context is
  **retained as history** (valuable, categorized) but **active BD attention shifts to the relationship** — the
  next opportunity with that party — and essentially never returns to the sold deal (barring minor one-off follow-ups).

**Implementation — dual anchor on every activity/touch:**
- `activity_events.entity_id` = the **active (OPEN) deal** when one exists (keeps the deal timeline / dossier /
  cadence intact); when only closed deals or no deal exist, it rides the **party**.
- `metadata.party_entity_id` = the **relationship** (person/org) — always stamped, so the **relationship dossier**
  aggregates every touch across all that party's deals.
- `metadata.deal_entity_id` = the **deal subfilter**.
- **Relationship dossier** = aggregate by `party_entity_id` (spans deals, persists past close). **Deal dossier** =
  filter by the deal. **Cadence:** on disposition the **deal cadence retires** (auto-retire); the **relationship
  cadence continues** and re-aims at the next opportunity — never re-surfacing the sold deal.
- **Resolver encodes it:** `lcc_resolve_contact` returns the party + deals with `is_open`, and `primary_deal` is the
  **OPEN** deal only (active BD anchor); a closed-only contact returns `has_open_deal:false` → attention at the party.

This is why we did NOT bulk-re-attribute sent emails to single deals: that would bury the relationship. Instead the
dual anchor keeps the party primary and the (open) deal as the sub-context. `handleOutlookSent` now stamps both.
The **correspondence→deal linkage at ingest** (next build, via `deal-email-matcher`) sets the same dual anchor at
the source, so every projection reads relationship + deal correctly, and the fuzzy city-bridge retires.

## The living context object (projection model — the key architectural fact)
The deal dossier, the offer-context packet, and the priority queue are **projections over the same spine**, not
stored blobs (`mcp/deal-dossier-tools.js`: identity = `entities`; correspondence/milestones = `activity_events`;
economics = domain record + `lcc_cre_bov_extraction`). Because they're computed on read, they are **already
continuously current** — the packet reflects the spine at query time. So "keep the dossier continuously updated"
is NOT a storage problem; it is two things: (a) **maximize what flows into the spine** from every source, and
(b) **run resolution/enrichment as signal arrives** so the projection reads resolved links, not raw fragments.
The seller-resolver (`offer-context-connectivity.md`) is the first instance: same spine, richer projection, zero
new storage. Every future enrichment follows this shape — feed the spine + resolve on read/arrival.

### The spine (single set of inputs every projection reads)
`entities` (identity + links via `external_identities` to domain `dia|gov:asset`) · `activity_events` (every
touch: email in/out, call, meeting, note, milestone) · `entity_relationships` (owner/party edges) ·
`touchpoint_cadence` · domain property facts (`dia`/`gov`) · `sharepoint_documents` (ShareFile/OM/lease) ·
`lcc_cre_bov_extraction` · `field_provenance` (who said what, confidence). Enrich any of these and **every**
projection (dossier, offer-context, queue, briefing) gets richer at once.

### Lifecycle enrichment triggers (enrich at every step — ingestion → close → re-prospect)
Each step fires enrichment into the spine; nothing waits for a manual refresh:
- **Ingestion (DB layer):** a property enters → kick owner/history enrichment (public records, deed/SOS when
  un-blocked; domain facts; CMS/tenant) → seed the entity + first links.
- **Listing / BD:** OM/lease arrives → extract economics → **fill-blanks** to domain property + `lcc_listing_economics`;
  correspondence arrives → resolve seller candidate (built) → promote to a durable owner edge when confidence clears.
- **Every interaction:** each email (in **and out**), call, meeting → `activity_events` → advances cadence (single
  owner) → auto-resolves the to-do it satisfies → feeds draft/template + cadence-timing learning.
- **Docs:** folder-feed links every new ShareFile/OM/lease to the entity (`property_entity_id`).
- **Close & beyond:** on closing, spawn the **buyer as a new prospect** — a new entity/cadence seeded from the
  closing activity (the buyer who just bought is the highest-signal lead for the next deal). The dossier persists;
  post-close touches keep enriching it.
Each trigger obeys the invariants below (fill-blanks · provenance · reversible · single-advance-owner · honest counts).

## First concrete step
Ingest **sent email** (Outlook Sent → intake → `activity_events`, actor=human, through the cadence-advance owner) and
wire the **first auto-retire predicate** (`offer_review` To-Do auto-closes when the offer submission draft is sent).
That single slice proves the loop end-to-end: a human action the system now sees → a to-do that closes itself →
cadence that advances from reality — and becomes the template for every other activity type.

## Build log
- **2026-07-30 — seller-resolver (offer-context):** `lcc_offer_context` resolves a correspondence-inferred, deduped,
  confidence-scored `seller_candidates[]` when no seller edge exists (RCG surfaced for Snellville). Live.
- **2026-07-30 — keystone, engine + DB (deploy to activate):** `POST /api/intake?_route=outlook-sent`
  (`handleOutlookSent` in `api/intake.js`) logs a SENT email as an OUTBOUND `email` `activity_event` on the deal
  (resolved by recipient-is-a-known-correspondent), deduped on `(workspace_id,'outlook_sent',internet_message_id)`;
  the SQL cadence trigger advances the touch. `lcc_autoresolve_offer_review(entity,activity)` then **completes the
  open "Review & submit offer" To-Do** (reversible, provenance-tagged) — the first auto-retire predicate. Both
  `node --check`-clean; DB function live. **Remaining:** the PA **Sent-Items capture flow** (Outlook Sent → this
  route) — portal spec delivered; import + redeploy to light the loop end-to-end.
- **Next predicates to add** (same shape): "call X back" closes on a logged outbound call to X; "reply to Y" closes
  on a sent email to Y; generalize `lcc_autoresolve_offer_review` → `lcc_autoresolve_todos(activity)` keyed by
  `action_type`.
- **2026-07-30 — keystone VERIFIED on live data (backfill):** the Sent-Items backfill ingested **42** sends →
  **30 auto-attributed across 8 deals**, **0** wrongly auto-resolved (the `backfill:true` guard held); **cadence
  advanced from real history** (next-touch-due computed — Edwin Ryu 10/15, Ben Brigham 10/28, Toby Scrivner 10/21).
  Refinement found: some sends attributed to the **contact/person** entity, not the **asset/deal** (matcher takes
  the most-recent entity mentioning the recipient) — fixed by §4 contact reconciliation (resolve contact→deal;
  attach to both). Full design: `contact-reconciliation.md`.
- **2026-07-30 — contact-reconciliation slice 1:** `lcc_resolve_contact(email,phone)` live (resolves person +
  deal via a city bridge; `frankm@rcgventures.com` → Snellville ✓); `handleOutlookSent` now prefers the resolved
  **deal** over the person (deploy + re-attribute existing rows). Finding: correspondence isn't linked to assets —
  the clean fix is linking correspondence→deal at ingest via `deal-email-matcher`. Details: `contact-reconciliation.md`.

## Roadmap: ingestion sources & layers on deck (decisions on record)
1. **Personal email — deliberately EXCLUDED from the professional sent-ingest** (2026-07-30 decision). The
   `outlook-sent` handler writes `visibility:'shared'` into the Briggs CRE workspace; personal sends must never
   enter the shared professional deal graph (canon: personal context never on team surfaces). Personal ingest is a
   later, separately-scoped path (personal mailbox → `visibility:'private'` + personal domain → personal to-dos),
   never wired into the shared route.
2. **Shared marketing mailbox `teambriggs@northmarq.com`** (Scott + Sarah Martin). The front door for marketing
   inquiries + leads — highest-value BD signal (OM downloaders, buyer inquiries), today reaching LCC only
   indirectly (Sarah forwards→broker flags, or SF log). Build as its own **inbound** capture (attribute to
   listing+broker via the deal-email-matcher; create lead/cadence) plus Sarah's outbound responses as touches.
   **Dedup is the crux:** the same inquiry arrives 3 ways — shared-box original, Sarah's forward (a NEW
   message-id), and the SF log — so exact-id dedup is insufficient; need thread/content-level dedup. Professional/
   shared scope (fits this workspace).
3. **WebEx softphone (desk / direct office line) — the call layer.** Schema is already primed:
   `activity_events` has a `source_type='webex'` unique index (`ux_activity_webex_extid`). Ingest inbound/outbound
   calls (+ forwarded-voicemail flagged emails) as `webex` activities through the single cadence-advance owner.
   Then extend the auto-retire predicate so an **outbound call to a contact's number OR an email follow-up to that
   contact completes the contact's outstanding To-Do** and triggers the clean/sort/file sweep. Requires §4.
4. **Cross-surface contact reconciliation (WebEx ↔ Outlook ↔ LCC) — the identity spine for §3.** One person =
   one LCC entity resolvable by BOTH phone (WebEx) and email (Outlook). Extend `external_identities`
   (`source_system` webex/outlook, keyed on phone/email) + `owner_contact_pivot` + `entity-link.js` so a phone
   number or an email resolves to the same entity/contact/deal. This is the prerequisite that lets "outbound call
   to number X" and "email to contact X" resolve to the SAME to-do. Reconcile via matching phone+email+name,
   provenance-tagged, confidence-scored, reversible — never a blind merge.
5. **Deep historical ingest (10+ yr Sent + Inbox) — build the past, not just the future** (Scott's directive).
   Backfill as much email history as retention allows via a **LEAN correspondence path** (log `activity_events` +
   attribute + dedup on `internet_message_id`; `backfill:true`, no auto-resolve) — NOT the live inbound-triage/OM
   pipeline (far too heavy for decade-old mail, and we don't want to re-stage old OMs). This retro-populates the
   relationship graph (who we've worked with, on what, how they responded) and is the **training corpus** for the
   learned-cadence/content layer. Run in date-windowed batches; attribution sharpens as §4 identity resolves.
   Inbound history uses the same lean handler with `direction:'inbound'` (a sibling of `outlook-sent`), keeping the
   heavy triage for LIVE mail only.

Build order for the call layer: **§4 contact reconciliation first** (identity), then **§3 WebEx call ingest +
generalized auto-retire**, so a call and an email to the same person close the same to-do. §2 (shared mailbox) is
independent and can slot in anytime; §1 (personal) waits for the personal-domain layer.

## Learned cadence & content (BD / marketing effectiveness) — the soft layer over the hard rules
The cadence targets in `logging-and-touchpoints` (7 touches / ~4× yr / weekly-report) and the stage intervals in
`cadence-scan.js` (`INTERVAL_DAYS`) are the **floor** — the minimum that should never be missed. On top of that,
the timing AND content of the *next* touch should be **learned per owner** from their actual response history and
our background with them — better than any fixed rule (Scott's directive). The enriched spine now makes this
possible: with sent emails, replies, and calls all flowing in, the system can *see* what each owner responds to.

**Timing (per-owner cadence learning):** derive each owner's responsiveness profile from `activity_events` —
reply latency, preferred channel, day/time that gets answered, how they went cold before — and let the queue
rank/schedule the next touch by *predicted* responsiveness, not just the stage interval. Surface as a recommended
next-touch date + channel (resolve-or-refuse; the floor still guarantees a minimum). Never below the doctrine floor.

**Content (per-owner + per-topic learning):** feed reply/no-reply outcomes back through the existing template loop
(`recordTemplateSend` → `template-refinement`) keyed by owner + topic — which subject line, angle, length, and
deliverable actually drew a response from *this* owner and on *this* asset class. The next draft is pre-shaped by
what converts, and carries the relationship background (prior deals, tone, what they care about) the enriched
dossier already holds.

**Self-improvement loop (marketing/BD effectiveness):** a scheduled sweep measures response/engagement rate by
subject-angle × owner-segment × asset class, and promotes the highest-converting patterns into the template/cadence
recommendations — a closed loop that raises marketing response rates and BD effectiveness over time. Honest metrics
(real replies, not sends); every recommendation is a suggestion the human can override; provenance + confidence on
every learned signal. This is the payoff of feeding the spine: the more we ingest (sends, replies, calls), the
smarter the timing and content of every next step becomes.

**Dependencies / order:** needs the ingest keystone (sends — built) + replies (inbound intake — exists) + calls
(§3) + contact identity (§4) flowing, so responses attribute to the right owner. Build the measurement/learning
sweep AFTER the call layer, so timing/content learning sees all channels — not just email.
