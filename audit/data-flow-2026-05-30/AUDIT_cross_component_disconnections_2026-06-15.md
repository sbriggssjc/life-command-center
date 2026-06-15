# Audit — cross-component disconnections (silos not wired to the spine)
**Grounded live 2026-06-15, LCC Opps.** Theme: find components holding actionable
data that another part of the system should see but doesn't.

## The disconnection map
| component | rows | wired to spine? | verdict |
|---|---|---|---|
| activity_events (correspondence) | 19.7k | entity_id ✓ | connected (SF/email → timeline, R16/Slice 3b) |
| signals (telemetry) | 84k | n/a | NOT a silo — append-only event log (packet_assembled 48k, copilot 16k, sidebar 13k); healthy |
| **research_tasks (gap-tracker)** | **12.1k (10.1k queued)** | **entity_id NULL on the bulk** | **DISCONNECTED — the headline finding** |
| listing_bd_runs (CoStar/availability listing→BD) | 1.2k (1.08k/14d) | active | connected + working |
| lcc_listing_events (R5 sale-event cohort fan-out) | 61, 0 processed, stale 5/22 | unprocessed | likely VESTIGIAL (superseded by listing_bd_runs) — reconcile, not a live break |

## Finding 1 (headline) — the ownership gap-tracker is disconnected from resolution AND guidance
`research_tasks` holds **10,138 queued** gap tasks, overwhelmingly
`property_missing_recorded_owner` (**7,961**) + `true_owner_needs_salesforce`
(1,597). Mechanism: the generator creates a task when a property lacks a recorded
owner and auto-completes it (`gap_resolved`) when *any* source later fills the owner.
So it's a GAP TRACKER, not a worklist. Two structural disconnections:

- **No entity to surface on.** `entity_id` is NULL on all 7,961 (a property with no
  recorded owner has no owner entity yet). So these gaps *cannot* appear in the
  entity-grained priority queue or the Decision Center — they're structurally
  invisible to the user's guidance surface. They live only in `research_tasks`,
  keyed by property.
- **Resolution stalled + generation surged.** Completion kept pace through late May
  (5/25: 229 created / 219 resolved) then collapsed (6/08: 4,394 created / **29
  resolved**; 6/15: 861 / **0**). ~7,400 of the 7,961 were created in the last 14
  days, both domains (gov 4,727 / dia 3,234). So the recorded-owner gap is
  accelerating and nothing is closing it.

**Why it matters:** recorded owner → true owner → the entire BD relationship. 8k
identified ownership gaps that nothing surfaces and nothing resolves is the single
biggest "the system knows but can't act" silo.

**Fix (R21) — investigation-first, then connect:**
1. **Diagnose the 14-day surge.** ~7,400 properties newly flagged missing recorded
   owner across BOTH domains points at a generator-criteria change, a recorded_owner
   data regression (a sync that cleared owners?), or a real ingestion influx. This
   decides whether it's a true backlog or noise to scope out. Grep the
   generate-research-tasks generator + check whether recorded_owner coverage
   actually dropped ~6/01.
2. **Connect to resolution.** These are property-level gaps with no owner entity, so
   the resolution path is a recorded-owner LOOKUP (county records / deed), not the
   entity queue. Either (a) an automated county/deed lookup worker that fills
   `recorded_owner` (the durable fix — gov has `county_scraper`; dia needs a path),
   or (b) surface the **value-ranked** high-rent gaps as a property-grained research
   surface (don't dump 8k — rank by property value, work the top). Likely both: auto
   where possible, surface the high-value remainder.
3. **Stop silent accumulation.** Whatever the resolution, bound the queue + alert if
   generation outpaces completion for N days (the same disabled-cron/stall lesson) —
   a gap-tracker that only grows is a broken signal.

## Finding 2 (minor) — reconcile the vestigial R5 listing-event path
`lcc_listing_events` (R5 sale-event cohort fan-out: same-owner / buyer / geographic
cohorts) has 61 events, **0 ever processed**, stale since 5/22 — while the CoStar/
availability listing→BD path (`listing_bd_runs`) is active (1,080 runs/14d). The R5
cohort fan-out appears superseded/abandoned. Decide: wire it (if cohort fan-out adds
value beyond listing_bd_runs) or retire it (drop the table + the
v_lcc_listing_event_queue / lcc_listing_*_cohort functions) so it's not a confusing
dead path. Low urgency; it's just dead weight, not a live break.

## Healthy / connected (no action)
Correspondence → timeline (R16/Slice 3b), the active listing→BD path
(listing_bd_runs), signals telemetry, the entity/property/cadence spine, context
packets. The connected core is sound; these two are the edges that don't talk.
