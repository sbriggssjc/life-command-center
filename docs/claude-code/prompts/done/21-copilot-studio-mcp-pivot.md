# Prompt 21 — Connect Copilot Studio (LCC Deal Agent) directly to our MCP server

## Why (the pivot)
Microsoft Copilot Studio now supports MCP servers as agent tools. If we point the LCC Deal Agent at our `/mcp`
endpoint, it discovers ALL LCC tools natively (query/synthesize/generate comps + the 7 read ops + more) — the same
contract Claude consumes. This supersedes the hand-maintained OpenAPI/Swagger connector for the Microsoft side and
fixes, at the root: (a) the missing GenerateComps action (ConnectorOperationNotFound on workbook export), and
(b) the per-surface schema drift / 300-char class of problems. One source of truth instead of swagger + openapi +
registry + package.

## Part 1 — VERIFY the server can back a Copilot Studio MCP connection (code/infra)
Copilot Studio's MCP tool expects the **streamable HTTP** transport (`x-ms-agentic-protocol: mcp-streamable-1.0`),
not SSE-only. Confirm our Railway MCP server at
`https://tranquil-delight-production-633f.up.railway.app/mcp` supports it:
1. Check the MCP server implementation (`mcp/` + `server.js`) for the transport it exposes. Streamable HTTP =
   a single POST endpoint that returns either JSON or an SSE stream per request (MCP spec 2025-03-26+). If we only
   expose the older HTTP+SSE (2024-11-05) transport, note exactly what's missing.
2. Confirm auth: does `/mcp` accept `Authorization: Bearer <LCC_API_KEY>`? Does it advertise OAuth
   discovery (`/.well-known/oauth-*`)? Document which auth path Copilot Studio should use.
3. Confirm the tool list `/mcp` advertises on `tools/list` (names + short descriptions) so we know what the agent
   will see. Flag any tool whose output is unbounded (the old 1.1M-char comps dump must stay bounded).
4. If streamable HTTP is NOT supported, specify the smallest change to add it (adapter/route), or confirm the
   existing transport works with Copilot Studio's custom-connector path (`mcp-streamable-1.0` header on a Power
   Apps custom connector pointed at `/mcp`).

Deliverable for Part 1: a short readiness note — transport supported yes/no, auth method, tool list, any change
needed — written to `docs/comps-rollout/mcp-copilot-readiness.md`.

## Part 2 — Connect + publish (Scott does in Copilot Studio; give exact steps)
Once Part 1 confirms readiness, provide the click-path (already drafted in
`docs/comps-rollout/ms-surface-triage-and-mcp-pivot.md` section D):
Build -> Tools -> Add a tool -> Add -> Model Context Protocol -> Server URL `.../mcp` -> auth per Part 1 ->
review tool list -> Save -> Publish -> publish agent to the Teams & Microsoft 365 Copilot channel (so Cowork /
M365 Copilot users reach the same tools). Test in Preview: "Pull DaVita comps in The Villages, FL and export the
workbook."

## Verify
- Part 1 note committed; transport + auth conclusively stated (not assumed).
- After Scott connects: the agent lists the LCC tools; query/synthesize/generate all callable; workbook export
  returns a downloadable link on the Copilot channel.

## Interaction with prompt 20
Prompt 20 (ChatGPT description trim) still ships — ChatGPT needs the OpenAPI schema. This prompt removes the
OpenAPI/Swagger dependency for the MICROSOFT surfaces only.

## Prerequisites confirmed on Microsoft Learn (2026-08-03) — account for these
1. **Generative Orchestration must be ON** for the LCC Deal Agent, or MCP tools are unavailable. Part 2 must have
   Scott enable it (agent Settings -> Orchestration -> Generative) before adding the MCP tool.
2. **Bounded outputs are mandatory, not optional.** Copilot Studio throws `TooMuchDataToHandle` when a tool's
   output exceeds the model request size — this is exactly the earlier 1.1M-char comps dump. Part 1 must verify
   every tool `/mcp` advertises returns a bounded/scoped result; if any comps/read tool can still return the
   universe, that's a server-side bug to fix before the pivot (scope to the requested market, cap row count).
3. **`dialogId` authoring error** (`"Expected 'dialogId' to be defined"`) when adding an action in the classic
   action/canvas path: this is a Copilot Studio authoring-UI issue, typically cleared by saving+publishing the
   agent, refreshing/reopening it, and ensuring Generative Orchestration is on. Note it in the readiness doc so
   Scott doesn't fight the per-action add — the MCP tool add path (Add tool -> Model Context Protocol) sidesteps
   the per-operation action wiring entirely, which is another reason to prefer it over adding GenerateComps by hand.
4. **DLP note:** tenant Data Loss Prevention can block custom-connector creation. If hit, create the MCP custom
   connector in a Dev/Sandbox Power Platform environment (per Microsoft's troubleshooting guidance).
