# Activity-coverage audit — active-deal "going cold" signal (2026-07-31)

## Question
My Day flags ~21 of 23 active deals as stale/going-cold. How much of that is genuine neglect
vs. a data/linkage gap?

## Findings
- **40 open deals; 20 have direct `activity_events`, only 11 surface client touches.** The
  6–9 difference is **not a bug**: `v_activity_unified` correctly includes only client-facing
  categories (`email, call, meeting, note`) and excludes internal events (OM/document/copilot
  processing). A deal whose only activity is internal processing has had no *client touch* — so
  "stale" is correct for it.
- **Client touches attach to the wrong entity type for deal-matching.** Of 7,813 client-touch
  events: **7,017 attach to `person` (contact) entities, 737 to `asset`, 59 to `organization`.**
  Deals anchor to the **asset** (property) entity (34 of 40 open deals), so a deal's
  correspondence — logged against the *contact* — doesn't match the deal's asset entity.
- **The entity graph links deals to parties, but traversal recovers almost nothing.**
  `entity_relationships` connects deal assets to owners/sellers/buyers/brokers, but of the 29
  silent deals, only **1** gains a touch via safe sell-side links (owns/sells/deal_party) and
  only **5** via *any* relationship. So the related contacts on these deals have no logged
  activity either.

## Root cause
**A true coverage gap, not a linkage bug.** These deals' correspondence was never ingested into
the spine. The live dual-anchor intake captures mail flowing through it *now* (which is why the
11 recently-worked deals — e.g. Snellville — do show touches); historical deal threads (LOIs,
listing agreements, DD correspondence) predate it or aren't routed through intake. Graph
traversal can't help because the touches aren't in the spine at all.

## Why naive fixes are wrong
- Broadening last-touch to *any* related contact would pull **cross-deal** touches (a repeat
  buyer/broker like Boyd Watterson or Easterly touches many assets), falsely marking deals as
  recently touched. Only sell-side, deal-specific links (owns/sells/deal_party to *this* asset)
  are safe — and those recover just 1 deal.
- So there is no safe query-only fix; the gap is upstream in ingestion.

## The real fix (scoped deep-dive — deferred, circle back)
Bring these deals' correspondence into the spine, deal-linked:
1. **Backfill historical deal threads.** For each open `bd_opportunities`, pull the Outlook
   thread(s) for the deal (by subject/property/counterparty) and log them via the dual-anchor
   logger with `deal_entity_id` = the deal entity, so they attach to the deal, not just a contact.
2. **Ensure ongoing capture.** Confirm the Outlook intake covers the folders/threads where deal
   correspondence lives, and that the dual-anchor resolver maps the counterparty → the deal
   entity (not just the contact). The resolver already stamps `party_entity_id`/`deal_entity_id`
   for matched mail; the gap is deals whose contacts aren't yet linked to the deal entity.
3. **Deal↔contact bridge.** Populate `deal_party` relationships (or `bd_opportunities.primary_contact`)
   for every open deal so future touches on the contact can be safely attributed to the deal.

## Interim honesty (no code change needed)
`lcc_my_day` already returns `days_since_touch = null` when a deal has zero logged activity vs a
number when it went quiet. Downstream (dashboard/app) should render these distinctly — "no
logged activity (verify)" vs "N days quiet" — so the ~20 no-data deals read as *unverified*
rather than *confirmed cold*. The flag is still useful (a deal with no visible touch is worth a
check) and sharpens automatically as ingestion coverage grows.
