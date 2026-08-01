# Prompt 11 — Comps: connector reach for the field agents + bounded output
- Priority: **P1**
- Status: open (drafted 2026-08-01)
- Related: `docs/architecture/error-triage-2026-08-01.md` §4, the comps engine (query_comps/synthesize_comps), Comps_Column_Mapping.md
- Response file: `../responses/11-comps-connector-and-output.response.md`

## Prompt (copy/paste to Claude Code)
```
Comps pulling is failing for the field agents even though the LCC comps ENGINE works (mcp__LCC__query_comps
returns a full comp set from Supabase). Two problems:
1. Reach: the Copilot "LCC Deal Agent" fails with "ConnectorOperationNotFound" and the Claude Northmarq project
   has no LCC/Supabase connector available. Register/repair the LCC comps action (query_comps / synthesize_comps
   / generate_comps) so it is discoverable and callable from the field surfaces (Copilot LCC Deal Agent + the
   Claude Northmarq connector), with auth that works headless. Confirm a comps request for "DaVita, The Villages,
   FL" returns from the engine in those agents (not web/general knowledge).
2. Output size: query_comps returned ~1.1M characters / 32k lines for a single-market request — the filter/limit
   did not visibly apply. Make the comps query BOUNDED and market-targeted by default: respect the requested
   market/tenant/radius + a sane row cap, and return the Team Briggs template-mapped comp set (per
   Comps_Column_Mapping.md: Tenant-first, Chairs/Patients after RBA, rent-driven caps) rather than the whole
   universe. Add cap-rate self-consistency + bid-ask QC.
Verify: the DaVita/The Villages FL comps request returns a bounded, template-ready set through the agent
connectors.
```

## Verify
The comps action is reachable from the field agents (no ConnectorOperationNotFound), returns a bounded
market-targeted set, and maps into the Team Briggs comp templates.

> **Review note (2026-08-01):** the comps/artifact actions do not appear registered in `docs/architecture/copilot_action_registry.json` — a likely direct cause of `ConnectorOperationNotFound`. Register the comps action(s) in the registry + the connector manifest so the field agents can discover/call them.
