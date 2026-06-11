# Claude Code — Phase 2 Slice 3a: the property context packet (Layer 4 keystone)

## Why (grounded live 2026-06-11)
The intelligence-hub Layer 4 goal is "every agent fully informed": a context
service that, given a subject, assembles the full breadth + depth of what's known.
Grounding found:
- `context_packets` has **45,733 packets but only 2 types: `contact` + `daily_briefing`**.
  There are **zero `property` packets**, so `get_property_context` (the MCP tool +
  `api/_handlers/property-handler.js`) returns `context_packet: null` for every
  property (verified on DaVita Chilton, dia 29841 / entity
  `9782c412-e9b7-4061-ac73-edc670b9273c`).
- `assemblePropertyPacket()` (`api/operations.js` ~line 5598) EXISTS and the
  `assembleSinglePacket` switch routes `'property'` to it — but **nothing calls it**:
  the nightly preassemble queue only enqueues contacts + daily_briefing, and the
  property handler only READS the cache (never assembles on miss).
- Even when it runs, the assembler is **thin** — it pulls entity, the raw domain
  `properties` row (as `lease_data`), `action_items`, last-10 `activity_events`,
  and a naively recomputed score. It **omits the documents** (`property_documents`
  — the OMs/BOVs/memos that the Phase-2 enrich + write-back channels attach),
  ownership/related-contacts, listing + sale history, comps, and the real
  investment score/grade.

This slice makes the property packet real: enrich the assembler + wire on-demand
assembly so the full property picture (incl. the docs we just connected) is
available to LCC, Copilot, Claude, and a GPT through the one shared service.

## Unit 1 — enrich `assemblePropertyPacket` (`api/operations.js`)
Keep the existing sections (entity, lease_data, research_status, activity_timeline,
investment_score, external_identities) and ADD, in parallel where possible
(`Promise.all`), pulling from the resolved domain (`gov`/`dia`) via the linked
`external_id` + the LCC graph:

1. **`documents`** — the property's `<domain>.property_documents`
   (`document_id, file_name, document_type, source_url, created_at`, ordered newest
   first). Tag each with its `source` provenance where available
   (`field_provenance` / the `source` column) so consumers can tell an
   `lcc_generated` BOV from an `om_extraction` OM from a `folder_feed_*` attach.
   **This is the keystone — it surfaces the Phase-2 document connections.**
2. **`ownership`** — recorded owner + true owner names (from the domain
   `properties` row's owner FKs or the gov/dia owner-facts views) + the related
   people/orgs from LCC `entity_relationships` (owns / associated_with), so the
   packet answers "who owns this and who do we know there."
3. **`transactions`** — recent `<domain>.sales_transactions` for this property
   (date, price, cap rate, buyer/seller) + any open `available_listings` row.
4. **`comps`** — a small set of nearby/recent comps if cheaply available (reuse an
   existing comps view/helper; if not cheap, leave a `comps: []` placeholder +
   add to `fields_missing` rather than a heavy query — keep assembly fast).
5. **`investment`** — prefer the REAL `investment_scores` / `deal_grade` from the
   domain over the naive recompute; fall back to the recompute only when absent.

Bound every sub-query (`limit`), keep them parallel, and keep the existing
`sourcesQueried` / `fieldsMissing` discipline (push a fields_missing entry when a
section can't be fetched — never throw the whole packet). Token budget: respect the
existing `max_tokens` / compression path the other packets use.

## Unit 2 — assemble-on-miss in `get_property_context` (`api/_handlers/property-handler.js`)
Today it reads `context_packets?packet_type=eq.property…limit=1` and returns null on
miss. Change: on a cache miss (or an expired/invalidated row), CALL the assemble
path (`assembleSinglePacket({packet_type:'property', entity_id, …})` or the
`/api/context?action=assemble` internal path) to build + cache the packet, then
return it. So the first read warms the cache and every read returns a real packet.
Keep the existing cache-hit fast path. Mirror however `get_contact_context` handles
assemble-on-miss if it already does (parity).

## Unit 3 — pre-warm property packets in the nightly preassemble (`api/operations.js`)
The nightly `preassemble-nightly` loop enqueues contacts + daily_briefing. Add
**property/asset entities** to the queue (bounded — e.g. the highest-value /
most-active properties first, by the same ranking the queue uses for contacts, or
a sensible cap per night) so property packets are warm without waiting for the
first read. Respect the existing batch size + TTL (`PACKET_TTL_HOURS['property']`).

## Tests / house rules
- Unit-test `assemblePropertyPacket` with a mocked domain fetch: asserts the payload
  now includes `documents` (with the attached doc), `ownership`, `transactions`,
  and prefers the real `investment` score; `fields_missing` is populated (not a
  throw) when a section's source is unavailable.
- `get_property_context` assemble-on-miss: a cache miss triggers assembly + returns
  a non-null packet; a cache hit still short-circuits.
- `node --check`; ≤12 `api/*.js` (operations.js + property-handler.js — no new
  file); full suite green. Ships on the Railway redeploy.

## After deploy (Claude/Cowork)
I'll call `get_property_context` for DaVita Chilton (entity
`9782c412-…`) and confirm the packet now returns the lease, the attached
`property_documents` (incl. our enrich OM + any write-back deliverable), ownership,
transactions, and the real score — i.e. the full property picture in one packet.
Then spot-check a gov property, and confirm the nightly preassemble warms property
packets.

## OUT OF SCOPE (Slice 3b — correspondence, next)
Routing real correspondence into the timeline: flagged-email (PA) and Salesforce
notes/activities → `activity_events` as entity-linked `note`/`email`/`call` rows
(today activity_events is mostly system events; only ~494 notes + 1 call are human).
That enriches the packet's `activity_timeline` and depends on the email/SF connector
wiring — separate prompt once the packet structure above is live.
