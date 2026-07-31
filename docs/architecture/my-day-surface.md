# My Day surface (`lcc_my_day`)

**Status: LIVE (2026-07-31).** One owner-scoped RPC that assembles Scott's (or any rep's)
prioritized inbox from four engines. Everything scopes through `lcc_entity_owner_override`
(the reconciliation engine's output), so each rep sees only their work + unassigned; a
teammate's owned items are excluded.

`lcc_my_day(p_owner_user_id, p_todo_limit=25, p_pipeline_limit=12, p_deal_limit=25, p_touch_limit=15)`
returns `{todos, active_deals, next_touchpoints, pipeline}` + counts.

## Sections & their feeders
1. **Do Now — action items** (`todos`): open `action_items`, ranked by urgency (due today/overdue),
   priority, action type, and recency. Includes the self-updating correspondence to-dos
   (offer/seller flow) **and** the deal-stage next-steps (below).
2. **Active deals** (`active_deals`): open `bd_opportunities`, ranked by proximity to close
   (non_refundable → loi_executed → off_market → listing_signed → bov → identified). Owner from
   the entity override → `bd_opportunities.owner_user_id`.
3. **Next best touchpoints** (`next_touchpoints`): `touchpoint_cadence` rows due/overdue (stale
   >400d dropped), ranked by tier (A>B) then client value (deal volume/engagement) then overdue.
   Name resolved from contact → unified_contacts → entity → property; cadence `notes` surfaced.
4. **Prospecting pipeline** (`pipeline`): `v_priority_queue_enriched` BD-sourcing targets by
   priority band (P0.4 ownership-control, lease-expiry, buyer relationships, agency solicitations…).

## Deal-stage next-step engine (`lcc_generate_deal_next_steps`)
Ensures every open transaction-stage deal that has **no** open action item gets a stage-appropriate
next step, so Do Now reflects all deal work in motion — not just deals that happened to get a to-do.
Gap-fill only (never duplicates a deal already being worked). Self-correcting: retires its own
auto-steps when a deal advances stage or closes, then regenerates the right one. Stage → action:
non_refundable → "Confirm closing date & coordinate settlement" (high); loi_executed → "Track due
diligence & confirm closing timeline" (high); off_market_listing → "Advance off-market buyer
outreach"; listing_signed → "Confirm marketing launch / OM status"; bov → "Deliver BOV & set listing
discussion". Cron **lcc-deal-next-steps-daily** @ 05:15 UTC (before the 05:30 owner reconcile).
Content-aware titles (via the next-step AI) can layer onto the same `title` field later.

## Refresh cadence
- `lcc-deal-next-steps-daily` 05:15 UTC — deal next-steps.
- `lcc-owner-reconcile-daily` 05:30 UTC — email/deal/cadence feeders + reconcile ownership.
- `lcc-sf-owner-sync-weekly` Mon 06:30 UTC — pull SF Task/Opportunity owners, reconcile.
- Live intake continuously logs correspondence + self-updates to-dos.

## Known gaps (non-blocking)
- 9 active deals read "unassigned" (8 system-identified buy-side targets; 1 owned by SF user
  `0058W00000FDlCOQA1` not in the roster). Add that user to `lcc_users` to attribute their deals.
- `touchpoint_cadence` has no owner source (metadata/link), so cadence touchpoints attribute only
  via the entity override — they own up as their entities get reconciled owners.
