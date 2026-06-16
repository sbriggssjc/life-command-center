# Claude Code — R30: fix the MCP agent layer's discovery ring (the assembler is fine)

## Why (exercised live 2026-06-16 — see AUDIT_mcp_agent_layer_2026-06-16.md)
The MCP context tools were called against live LCC Opps. The DEEP assembler is excellent:
`get_property_context(entity_id)` returns a rich connected packet (lease/CMS financials,
ownership incl. true owner, listings, investment score, activity timeline, tenants). But
every DISCOVERY/NAVIGATION path around it is broken or disconnected, so an agent/ops-chat
can't actually find the node or see the work:
- `get_pipeline_health` → **broken**: `column ingestion_tracker.status does not exist`.
- `get_queue_summary` → returns **1 item** (reads `action_items`); blind to the 1,308-row
  priority queue, the 93 research gaps, the 371 contact-qualify rows.
- `search_entities` → finds dia assets but **0** for a $183M gov property shown on Today
  ("350 Rhode Island St"); surfaces **~20 fragmented "Boyd Watterson by <broker>" person
  dupes** for a major buyer parent, none canonical.
- `get_property_context(address)` → "Property not found" for that same displayed gov property.
- `get_contact_context(name)` → resolves "Boyd Watterson" to a **junk-flagged dupe stub**,
  returns empty context, recommends outreach on junk.

These are all in the MCP server code (the `a1198591…` server) — fix there, no DB schema
changes needed beyond pointing queries at the right existing views.

## Unit 1 (highest value) — `get_queue_summary` reads the REAL work
Repoint it from `action_items` to the operator's actual value-ranked work:
- Primary: `lcc_priority_queue_resolved` / `v_priority_queue_enriched` (band, reason,
  `rank_annual_rent`, entity, days_overdue) — return top-N by band priority then
  `rank_annual_rent DESC`, with the `domain` filter mapping to `source_domain`.
- Optionally fold in the research-gap count (the NBA's `research_tasks` /
  `v_next_best_research`) so "what needs to be done" matches what the operator sees.
- Keep the response shape stable (summary + items), just sourced correctly. Verify it
  returns the real bands (P-BUYER / P0.4 / P-CONTACT / …), not 1 stray action_item.

## Unit 2 (cheap) — `get_pipeline_health` schema fix
`ingestion_tracker.status` doesn't exist. Point the health query at the live source the
operator console/cron-health uses — `v_cron_health_summary` (LCC Opps) and/or the
domains' `ingestion_tracker` real columns — and return last-run/success/failure per
pipeline. Confirm it no longer returns "unavailable."

## Unit 3 — discovery dedup + canonical resolution (reuse existing machinery)
`search_entities` and `get_contact_context(name)` must stop landing on junk/fragments:
- Exclude `metadata.junk_name_flagged = true` (R13/R25 guard) from results and from
  name-resolution.
- Dedupe + prefer the CANONICAL entity: when a name resolves to multiple, prefer the one
  with portfolio/value/SF identity over "by <broker>" RCA stubs; resolve buyer-parent
  names to the registered parent (`lcc_buyer_parents` / the R5/R6 resolver) so
  "Boyd Watterson" → Boyd Watterson Global, not "boyd watterson by cbre".
- Rank results by value (`rank_annual_rent` / connected value) so the real entity leads.

## Unit 4 — gov coverage + address resolution
- `search_entities` and `get_property_context(address)` miss gov properties (the
  $183M Rhode Island St returns nothing). Ensure gov properties are reachable: either the
  agent search includes gov asset entities / a gov-property address index, or
  `get_property_context` falls back to resolving the address against `gov.properties`
  (and dia) on an entity miss — mirroring how the operator surfaces them. Normalize the
  address (same normalization the rest of the app uses) so "350 Rhode Island St" resolves.

## Data-quality follow-on (note, not required this round)
The ~20 "Boyd Watterson by <broker>" person dupes (and the class generally) are RCA
capture artifacts already `junk_name_flagged`/reviewed — excluding them (Unit 3) is the
immediate fix; a future pass could merge/retype them to the canonical parent.

## House rules
MCP server code only (no LCC `api/*.js` change → 12-function rule untouched). No DB schema
changes (point at existing views). Verify each tool live after deploy:
`get_queue_summary` shows real bands; `get_pipeline_health` returns data;
`search_entities`/`get_contact_context` lead with the canonical entity (no junk);
`get_property_context(address)` resolves a gov property shown on Today.

## Priority
Foundational (substrate for ops-chat + future agents), not daily-driver-blocking — the
operator console already works off the DB directly. Units 1-2 are cheap high-value wins;
3-4 ride machinery already built (R4-A/R5/R6/R13/R25).
