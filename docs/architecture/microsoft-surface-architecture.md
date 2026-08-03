# Microsoft-surface architecture — decision note (2026-08-03)

Scott asked, given Copilot Studio can now consume our MCP server and Copilot has a "Cowork" (plugins/skills)
surface: what other architectural shifts does this imply, and should we add Power Apps / Power BI / Dataverse /
other Microsoft AI elements? This records the decision so future chats hold the line.

## The governing principle (don't drift from this)
**Supabase (dia / gov / LCC Opps) + the Railway `/mcp` server remain the single system of record and the single
tool contract.** Every AI surface — Claude (personal + Northmarq), ChatGPT, Copilot Studio, M365 Copilot/Cowork —
is a *consumption layer* over that one contract. We do NOT create a second source of truth in Microsoft. The MCP
pivot is attractive precisely because it collapses the per-surface connectors down to the *same* contract Claude
already uses; adding a parallel Microsoft data platform would undo that.

## What the MCP pivot changes (architectural shifts)
1. **One contract, retire the per-surface schemas (Microsoft side).** Once Copilot Studio reads `/mcp`, the
   OpenAPI/Swagger connector for the Microsoft surfaces is redundant — tools + descriptions live only on the MCP
   server. ChatGPT still needs the OpenAPI schema (no MCP client), so `lcc-openapi.yaml` stays for ChatGPT only.
2. **Generative Orchestration becomes a hard dependency.** Copilot Studio requires **Generative Orchestration
   enabled** to use MCP tools (confirmed on Microsoft Learn). This must be ON on the LCC Deal Agent. It also
   changes tool-selection behavior (the orchestrator picks tools from descriptions) — so our MCP tool
   *descriptions* now do the work the old per-action wiring did. Keep them short and intent-clear.
3. **Bounded outputs are now load-bearing, not a nicety.** Copilot Studio throws `TooMuchDataToHandle` when a
   tool's output blows the model request size — exactly the old 1.1M-char comps dump. Every comps/read tool must
   return a bounded, scoped set (the requested market, not the universe). This is a server-side guarantee, not a
   per-surface fix.
4. **One auth + governance story.** Bearer `LCC_API_KEY` (or OAuth discovery) secures `/mcp` for all clients.
   Rotate the exposed key once; every surface picks up the new value. Governance/monitoring centralizes on the
   MCP server + Power Platform admin (DLP policies can block custom connectors — use a Dev/Sandbox env if hit).
5. **Publish once, reach Cowork for free.** The LCC Deal Agent published to the **Teams & Microsoft 365 Copilot**
   channel is what M365 Copilot / Cowork consume. Cowork needs no separate wiring — it rides the published agent.
   Share to the team with the **Viewer** role.

## Should we add these Microsoft elements? (recommendations)
- **Power BI — YES, highest-value add.** Build a Power BI semantic model over LCC data (pipeline, comps set,
  commission stage/value, health surface) for dashboards the team already wants, and stand up the **Power BI MCP
  server (remote)** so agents can answer "last quarter's dialysis cap-rate trend" in natural language via DAX.
  This complements — doesn't replace — the LCC app's own health/pipeline panels. Fits the analytics we designed
  (LCC health surface, pipeline health).
- **Dataverse — NO (don't migrate).** Dataverse *can* be an MCP server, but adopting it would create a second
  system of record competing with Supabase. Only revisit if the org mandates Power Platform-native governance;
  even then, Dataverse would mirror, never own. Keep Supabase authoritative.
- **Power Apps — OPTIONAL, low priority.** A canvas app would be a Microsoft-native front door to the same MCP,
  but the LCC app (Railway/Vercel) already is the front door. Only worth it if the team lives entirely in Teams
  and wants an embedded mini-app; otherwise it duplicates the LCC UI.
- **Power Automate — KEEP (already core).** The SF / Outlook / Sharefile PA flows are the *ingestion spine* that
  populates Supabase (deal spine, correspondence, documents). The MCP pivot is about *reads/consumption*; it does
  not replace these ingestion flows. Prompt 10/18 work continues.
- **Copilot (Graph) connectors — DEFER.** Indexing SharePoint/Team Briggs docs into the M365 semantic index is
  possible, but our PA flows + Supabase already ingest and structure those documents. Revisit only if M365
  Copilot users need doc search *outside* the LCC agent.
- **Skills/plugins in Copilot Cowork — DON'T duplicate the LCC skills.** Our BOV / comps / dialysis / government
  skills live with the LCC agent + Claude. In Copilot, the equivalent is a few **conversation starters / topics**
  on the LCC Deal Agent (comps, BOV ask, daily briefing) so Cowork users have one-click entries — thin prompts,
  not reimplemented logic.

## Net
Keep Supabase + `/mcp` as the one record + one contract. Do the MCP pivot (prompt 21) with Generative
Orchestration ON and bounded tool outputs. Add **Power BI** (dashboards + Power BI MCP) as the one net-new
Microsoft element worth building. Skip Dataverse migration, a duplicate Power App, and re-implemented skills.
