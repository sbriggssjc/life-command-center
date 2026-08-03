# Microsoft surfaces — triage + the MCP pivot (2026-08-03)

Three issues from Scott's tests, and one strategic change (Copilot <-> MCP) that simplifies the whole Microsoft
side and is the recommended go-forward.

## A. Copilot "LCC Deal Agent" — comps mostly work; only the workbook export fails
Good: after the connector update, query_comps + synthesize_comps work — the agent pulled and ranked a full
dialysis comp set for the Villages BOV ask. That's the ConnectorOperationNotFound from before, fixed.
Remaining: asking for the workbook threw ConnectorOperationNotFound again. GenerateComps (POST /api/comps) IS in
the v4 connector, but the agent's action list doesn't include it — query + synthesize were added, generate was
not. ConnectorOperationNotFound = the agent tried an operation it doesn't expose (not a server error).
Quick fix (no code): Copilot Studio -> LCC Deal Agent -> Tools/Actions -> the LCC connector -> add the
GenerateComps action (same way query/synthesize were added). Then retest "export the comps workbook." Also
confirm /api/comps returns a downloadable workbook URL on the Copilot channel — if it returns a file blob Copilot
can't render, have it return a signed download link.

## B. ChatGPT custom GPT — "300 character" error on two comps actions
Root cause (confirmed): ChatGPT Actions cap each operation's description at ~300 chars. In
docs/comps-rollout/lcc-openapi.yaml, queryComps description = 459 and synthesizeComps = 421 — both over.
(generateComps = 270, fine.) The v4 swagger already has short versions (247/246) — they just weren't ported to
the yaml. Fix (code): trim queryComps + synthesizeComps description fields in lcc-openapi.yaml to <=300 (reuse
the swagger's ~245-char text). Then re-import the schema into the GPT. -> prompt 20.

## C. Northmarq Claude — can't add a custom connector (admin-locked)
Confirmed limitation. Options, best first:
1. Route live comps through the Copilot LCC Deal Agent (org-available, now working) — the team asks Copilot for
   comps; the compose-and-handoff Northmarq Claude Project stays for methodology. Current design, no IT approval.
2. Admin adds the MCP connector once for the org (Claude -> Settings -> Connectors, admin) — then the same
   Northmarq Claude Project gains native tools. Best long-term if an admin will do it.
3. The compose-and-handoff Project alone (no live pull) — the fallback that already exists.

## D. STRATEGIC — connect Copilot Studio directly to our MCP server (the pivot)
Microsoft Copilot Studio now supports MCP servers as agent tools (verified on Microsoft Learn: "Add a Model
Context Protocol (MCP) server to your agent"). You point the agent at our MCP endpoint and it discovers ALL LCC
tools natively — the same tools Claude gets — instead of a hand-maintained OpenAPI/Swagger connector.
Why pivot:
- Solves the generate_comps gap — every tool (query/synthesize/generate + the 7 reads + more) exposed
  automatically; no per-action adding, no missing operations.
- Solves the 300-char / schema-drift class of problems — no OpenAPI descriptions to trim per surface; one source
  of truth (the MCP server), same as Claude.
- Unifies the architecture — Claude and Copilot both consume the same /mcp endpoint; one contract, not swagger +
  openapi + registry + package.
How (Copilot Studio steps): agent -> Build -> Tools -> Add a tool -> Add -> Model Context Protocol (MCP) ->
- Name / Description: short, so the orchestrator knows when to use it.
- Server URL: https://tranquil-delight-production-633f.up.railway.app/mcp
- Authentication: our server advertises OAuth discovery; if OAuth onboarding works, use it. Otherwise create the
  MCP custom connector in Power Apps with x-ms-agentic-protocol: mcp-streamable-1.0 + Bearer LCC_API_KEY.
- Add -> review the tool list -> Save -> Publish. Test in Preview: "Pull DaVita comps in The Villages, FL and
  export the workbook."
Note on transport: Copilot Studio's MCP expects the streamable HTTP transport (mcp-streamable-1.0). Confirm our
/mcp speaks that (vs. only SSE) — the one thing to verify before relying on it (prompt 21).

## E. Copilot "Cowork" (plugins/skills) — how it reaches our tools
Copilot Cowork / M365 Copilot reaches our tools through the published Copilot Studio agent: the LCC Deal Agent is
published to the Teams & Microsoft 365 Copilot channel, and that agent connects to our tools (via the MCP
connection in D, or the OpenAPI connector). Cowork doesn't need its own wiring — give the LCC Deal Agent the MCP
tools and publish it to the M365 Copilot channel, and Cowork/M365 Copilot users can invoke comps, context, and
the deal/property tools from inside Copilot. It ADDS to our strategy (a native Microsoft surface for the team)
but reuses the same agent + MCP contract — no new backend.

## Recommended sequence
1. Now (no code): add the GenerateComps action to the LCC Deal Agent (A) so the workbook export works today.
2. prompt 20: trim the two lcc-openapi.yaml comps descriptions <=300 -> ChatGPT updates cleanly (B).
3. prompt 21 (the pivot): verify /mcp streamable-HTTP + auth for Copilot Studio, then connect the LCC Deal Agent
   to /mcp (all tools native), publish to the M365 Copilot channel (D/E). Supersedes per-surface OpenAPI/Swagger
   maintenance and gives the Northmarq team full comps (incl. workbook) via Copilot.
4. Census: on hold — key request pending on Census's side; revisit prompt 19 when the key works.
