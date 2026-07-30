# The Unified Intelligence Layer (self-resolving to-do / inbox / brain)

_2026-07-30. Direction doc. The to-do list, inbox, and LCC are ONE intelligent, self-resolving layer — not a
manual checklist. Every activity (email sent/received, call in/out, meeting, note) is ingested, auto-resolves the
work it satisfies, advances cadence, and feeds the draft/template/cadence learning loops — so what surfaces is a
single prioritized list of exactly what needs doing (work + personal), much of it already prepped by proactive
subagents. Extends `offer-context-connectivity.md` (same close-the-loop pattern, applied to the activity layer)
and operationalizes the **Producer/Consumer Consumption Layer** doctrine in `CLAUDE.md`._

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

## First concrete step
Ingest **sent email** (Outlook Sent → intake → `activity_events`, actor=human, through the cadence-advance owner) and
wire the **first auto-retire predicate** (`offer_review` To-Do auto-closes when the offer submission draft is sent).
That single slice proves the loop end-to-end: a human action the system now sees → a to-do that closes itself →
cadence that advances from reality — and becomes the template for every other activity type.
