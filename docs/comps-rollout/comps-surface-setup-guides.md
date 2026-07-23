# Comps Engine — Per-Surface Setup Guides

The engine is one shared core. Claude surfaces connect to the **MCP endpoint**; Copilot and ChatGPT use the
**HTTP routes** via the OpenAPI schema (`lcc-comps-openapi.yaml`). Everything is Bearer-authenticated with
`LCC_API_KEY`. Substitute your live values everywhere they appear:

- `MCP_BASE_URL` = the MCP server's Railway domain (e.g. `https://<name>.up.railway.app`).
- `LCC_API_KEY` = the Bearer token. **Rotate it first** (it was exposed in chat) and use the new value below.

---

## 1. Northmarq Claude (Enterprise) — MCP connector
1. Claude → Settings → Connectors (or your org's admin console if connectors are admin-managed) → **Add custom connector**.
2. **URL:** `{MCP_BASE_URL}/mcp`
3. **Authentication:** the server advertises OAuth discovery, so Claude may complete a connect flow; if it asks
   for a token instead, add header `Authorization: Bearer {LCC_API_KEY}`.
4. Claude discovers all LCC tools including `query_comps`, `synthesize_comps`, `generate_comps`.
5. Test: "Pull DaVita comps in Texas over the last 12 months."
> If connectors are locked to admins, an org owner does this once for the workspace; otherwise it's per-user.

## 2. Personal Claude — MCP connector
Same as above under your personal account (Settings → Connectors → Add custom connector →
`{MCP_BASE_URL}/mcp`, Bearer `{LCC_API_KEY}`). Test with the same prompt.

## 3. Claude Cowork — internal skill
1. Save `comps-engine-SKILL.md` as a skill in your Cowork/skills workspace (or install it as a `.skill`).
2. It triggers on comp requests and drives `synthesize_comps`/`query_comps`/`generate_comps` with the Team
   Briggs policies. It coexists with `briggs-comps` (that one maps a raw CoStar/Salesforce export into the
   template; this one pulls from the databases).
3. Test in Cowork: "Build me a comps workbook of recent government medical-office sales in Texas."

## 4. ChatGPT — GPT Action
1. ChatGPT → **Create a GPT** (or edit an existing internal GPT) → **Configure** → **Actions** → **Create new action**.
2. **Authentication:** API Key → Auth Type **Bearer** → paste `{LCC_API_KEY}`.
3. **Schema:** paste the contents of `lcc-comps-openapi.yaml`. Set the `servers[0].url` to `{MCP_BASE_URL}`.
4. Two operations appear: `queryComps`, `synthesizeComps`.
5. In the GPT instructions, tell it to prefer `synthesizeComps` for plain-language asks, render `markdown`, and
   surface `meta.flagged_for_review`. Test: "government medical office comps, Texas, last year."

## 5. Microsoft Copilot Studio — custom connector / agent action
1. Power Platform / Copilot Studio → **Custom connectors** → **New** → **Import an OpenAPI file** → upload
   `lcc-comps-openapi.yaml` (Copilot Studio accepts OpenAPI; if it requires Swagger 2.0, use the Power Platform
   converter or ask me for a 2.0 build).
2. **Host:** the `MCP_BASE_URL` domain. **Base URL:** `/`.
3. **Security:** API Key / HTTP Bearer → header `Authorization`, value `Bearer {LCC_API_KEY}`.
4. Add the connector as an **action/tool** to your Copilot Studio agent; expose `queryComps` + `synthesizeComps`.
5. Test in the agent: "Pull recent DaVita dialysis comps."
> Best for M365 workflows (Outlook/Teams). Read-only.

---

## Notes
- All comps tools are **read-only**; no surface can write to the databases.
- The reliability gate, multi-tenant naming, and reconciliation flags live in the engine, so every surface
  returns identical comps — no per-surface logic to maintain.
- Workbook generation (`generate_comps`) is native on the Claude/Cowork surfaces. Adding it to ChatGPT/Copilot
  needs a small extra action against the BOV service's `/generate-comps` (returns a download URL) — ask me to
  add it to the OpenAPI schema if you want file export on those surfaces.
- After rotating `LCC_API_KEY`, update the stored secret on **every** surface (connector + both actions).
