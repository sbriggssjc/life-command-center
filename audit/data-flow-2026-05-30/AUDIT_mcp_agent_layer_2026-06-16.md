# Audit — MCP agent/context layer (exercised live 2026-06-16)

**Question:** does the agent-facing surface (the MCP tools that let an AI assistant / ops-chat
answer "tell me about this property/contact" and "what should I work") actually return
complete, connected, correct data?

**Verdict: the DEEP assembler is excellent; every DISCOVERY/NAVIGATION path around it is
broken or disconnected.** An agent can get a great answer — but only if it already knows the
exact entity UUID, and nothing in the surface helps it get there.

## Tool-by-tool (exercised against live LCC Opps)
| tool | state | finding |
|---|---|---|
| **get_property_context(entity_id)** | ✅ works | Rich, fully-connected packet: entity + lease/CMS financials + ownership (recorded + true owner) + listings + investment score + activity timeline (OM intakes) + tenants. `assembled_on_miss` works. This is the Slice-3a payoff — genuinely good. |
| **get_property_context(address)** | ❌ broken | "Property not found" for **350 Rhode Island St** — a $183M gov property shown on the Today rail right now (with a working recorder link). Address resolution + gov coverage gap. |
| **get_contact_context(name)** | ⚠️ wrong target | "Boyd Watterson" resolves to a **junk-flagged duplicate stub** ("boyd watterson by cbre", `junk_name_flagged`), returns empty context, and still recommends "introductory outreach." Not the real Boyd Watterson Global buyer parent (145 SPEs / $163M). |
| **search_entities** | ⚠️ partial | Works for dia assets (DaVita found). But returns **0** for the gov NBA property ("Rhode Island"), and surfaces **~20 fragmented "Boyd Watterson by <broker>" person dupes** for a major buyer parent — none canonical, no value ranking. |
| **get_queue_summary** | ❌ disconnected | Returns **1 open item** (reads `action_items`/work_items). Blind to the real work: the 1,308-row priority queue, the 93 research gaps the NBA shows, the 371-row contact-qualify worklist. The agent literally cannot see what the operator works. |
| **get_pipeline_health** | ❌ broken | Schema drift: `column ingestion_tracker.status does not exist`. Returns "unavailable." |

## Synthesis
The MCP layer is **"great answers, only if you already know the exact UUID — and nothing
helps you get the UUID."** The deep `get_property_context(id)` assembler is the hard part and
it's done well. But the discovery ring around it — search, name→entity resolution, the work
queue, pipeline health, address/gov coverage — is broken or points at the wrong/empty
sources. For an agent or ops-chat, that makes the common case (find the thing, see the work)
near-unusable, even though the payoff (the assembled packet) is excellent.

It's the same meta-pattern as the rest of this engagement: the system **assembles and
connects beautifully once you're at the right node, but the navigation/activation paths that
get you there aren't wired** (cf. outreach 0 sends, inbox never promotes, qualify parked).

## Priority
Foundational, not daily-driver-blocking (the operator console works directly off the DB).
But this is the substrate for ops-chat and any future agent, and two fixes are cheap wins:
`get_queue_summary` repoint (the agent should see the real value-ranked queue) and
`get_pipeline_health` schema fix. The discovery/dedup fixes (search + name resolution) ride
the same canonical-entity/junk-exclude machinery already built (R4-A, R20, R25).

## Recommended fix → CLAUDECODE_PROMPT_R30_mcp_agent_layer_discovery.md
1. **get_queue_summary** → read the real priority queue (`lcc_priority_queue_resolved` /
   `v_priority_queue_enriched`) + research gaps, value-ranked, domain-filterable — not
   `action_items`.
2. **get_pipeline_health** → fix the `ingestion_tracker.status` drift; point at the live
   cron-health / `v_cron_health_summary` source.
3. **search_entities + get_contact_context** → exclude `junk_name_flagged`, dedupe, prefer
   the canonical entity (resolve "by <broker>" stubs to the parent), rank by value; cover
   gov assets so a displayed gov property is findable.
4. **get_property_context(address)** → normalize address + resolve gov properties (mirror as
   asset entities or query gov.properties on miss), so a property shown on Today resolves.
