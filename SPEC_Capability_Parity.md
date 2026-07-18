# Capability Parity — one property → one record → identical BOV from every entry point
**Date:** 2026-07-18 · **Status:** built + tested; pending deploy of the two services.

The layer after Unit 4. Unit 4 built the shared **record** (a property's reviewed
lease/financial data). This makes every **entry point** open onto that record, so a
BOV request resolves to the same data and emits the identical workbook regardless of
who asks or from where — hand-authoring is reserved only for brand-new deals.

## What shipped

**Generator — the resolver everyone shares (`bov-generator/`):**
- `bov_record_loader.py` → `resolve_property_id(lookup)`: a numeric value is the id;
  an address matches `lcc_cre_properties.address` (street portion, optional `, ST`).
  Exactly one match → id; zero → 404; many → **409 with the candidate list** (never
  guesses).
- `main.py` → `/generate-bov` now accepts **`property_lookup`** (address or id) in
  addition to `cre_property_id`. Resolution happens server-side, so every caller gets
  address-or-id for free. Posted fields still override the loaded record
  (`exclude_unset`); hand-authored payloads are unchanged.

**LCC MCP tool (`mcp/server.js` → `generate_bov`):** schema now leads with
`property_lookup` / `cre_property_id` (marked PREFERRED); validation accepts a
record-only call OR a hand-authored call. Passes args straight through to the
generator (which does the resolving).

**Northmarq Claude Project action (`bov-generator/claude_project_action.json`):**
same two inputs added; the `required: [asset_type, property, tenants, underwriting,
client]` gate removed so a `{ property_lookup }` call validates. Same endpoint as the
MCP tool — so the two highest-traffic doors are now equals.

## Verified
- `resolve_property_id`: numeric → id; single address → id; ambiguous → 409; none → 404.
- `{property_lookup}`-only and `{cre_property_id}`-only bodies validate; overrides =
  only posted fields.
- **End-to-end:** `property_lookup="207 Fob James Dr, Valley, AL"` → resolve → load →
  build → **byte-identical to the `cre_property_id` build** (0 cell diffs across all 11
  sheets). (Diffs vs the yesterday-committed master are only `TODAY()` recalc drift.)
- `node --check` on server.js; JSON valid on the action.

## To deploy
1. **Railway (BOV generator):** redeploy so `/generate-bov` accepts `property_lookup`
   (+ the resolver). Needs `LCC_OPS_URL` + `LCC_OPS_SERVICE_KEY` (already set for Unit 4).
2. **MCP service:** redeploy/restart the `mcp/server.js` service so the tool schema +
   relaxed validation take effect.
3. **Northmarq Project:** re-import / update the action from
   `claude_project_action.json` in the Project's action settings.

## Methodology note — DONE
`NORTHMARQ_PROJECT_PROMPT.md` bumped to **v1.6**: §3P now leads with the PREFERRED
record path — hand off `{ property_lookup: "<address>", client }` (or cre_property_id)
for any property already in LCC; full hand-authored payload reserved for NEW deals.
Changelog row added.

## Two doors that need a manual paste (not repo edits)

**1. Copilot Studio agent** (`Team Briggs.../Copilot Studio Agents/LCC Deal Agent…​.agent`).
It's a Power-Platform package (not a readable/committable JSON). IF the agent exposes a
BOV-generation action pointing at `/generate-bov`, add these two inputs to that action's
request schema in Copilot Studio (and mark the previously-required fields optional):
```json
"property_lookup": { "type": "string", "description": "Address (or numeric id) to resolve to the LCC property's reviewed BOV record — e.g. '207 Fob James Dr, Valley, AL'. No other fields needed; posted fields override the record." },
"cre_property_id": { "type": "integer", "description": "LCC Opps lcc_cre_properties.id — load that property's reviewed BOV record directly." }
```
If the agent only surfaces deal context (get_property_context etc.) and doesn't generate
BOVs, no change is needed — it already reads the same records.

**2. `bov-underwriting` skill** (`~/.claude/skills/bov-underwriting/SKILL.md`, not
bridged to this session). Add one line near the top of the workflow:
> **Record-first:** If the property already exists in LCC, generate the BOV from its
> reviewed record — call the generator (or `mcp__LCC__generate_bov`) with
> `property_lookup: "<address>"` (or `cre_property_id`). This yields the identical
> workbook every access point produces. Only hand-author the full payload for a
> brand-new property not yet ingested into LCC.

Net: personal Claude, the Northmarq team Project, and any direct caller now resolve
"BOV 207 Fob James Dr" to the same reviewed record and produce the same deliverable —
with the two paste-ins above closing the Copilot + skill doors.
