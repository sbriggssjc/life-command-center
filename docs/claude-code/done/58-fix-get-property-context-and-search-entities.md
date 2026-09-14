# Prompt 58 — Fix two broken connector tools: get_property_context (resolves nothing) + search_entities (crashes)

## Why (connector smoke test, 2026-08-06 — pre-rollout baseline)

Testing the full LCC tool surface before rolling out to ChatGPT/Copilot/Northmarq. Comps, daily briefing,
pipeline health, and queue summary all return correct data. But two headline tools are broken on the live
standalone MCP service (`mcp/*`, the personal-Claude connector path):

### A. `get_property_context` returns `not_on_file` for properties that exist
Every call returns:
```json
{ "status": "not_on_file", "entity": null, "type": "asset", "confidence": 0,
  "resolved_via": null, "candidates": [], "raw_ref": {}, "error": "Property not found" }
```
Tested (all `not_on_file`, `raw_ref` empty):
- `"1050 Old Camp Rd, The Villages, FL"` — this is **property_id 31964**, which resolved here at **0.96** earlier
  this session AND which `synthesize_comps`/`generate_comps` STILL hydrate correctly (subject 6,453 SF / 12 chairs
  / 6.75% / excluded). So the record is present and resolvable — `get_property_context` specifically isn't finding it.
- `"614 South Cannon Boulevard, Kannapolis, NC"` — a live dialysis sold comp (property exists).

`raw_ref` comes back `{}`, so the request→ref parsing yields nothing, or the resolver query errors and is
swallowed into `not_on_file`. This is a **regression** — the same input worked earlier this session (pre 48–57).
Likely suspects: the prompt-49 `parseRequest`/subject-resolution changes, the prompt-51/52 property consolidation
(IDs/addresses moved), the shared `mcp/subject-resolver.js` (prompt 25) path, or a missing DB env on the standalone
MCP (`DIA_SUPABASE_URL/KEY` — the operational reference notes a dialysis path errors without it). Note comps uses
`hydrateSubjectFromRecord` (direct DB) and works, so the divergence is specifically in the `get_property_context`
resolver path.

### B. `search_entities` throws on any input
```json
{ "error": true, "tool": "search_entities", "message": "Cannot read properties of undefined (reading 'replace')" }
```
Fails immediately (`duration_ms: 1`) for `"DaVita"` and `"search for DaVita operator entities"`. A `.replace` on an
undefined — the handler reads a request field that isn't there (wrong param name, or a missing null-guard on the
query string) before it does any work.

## Task

1. **Fix `get_property_context` so it resolves known properties again.** It must return the property entity for
   `1050 Old Camp Rd, The Villages, FL` (property_id 31964, ~0.96) and other on-file properties — the same
   resolution `synthesize_comps` uses to hydrate the subject. Diagnose why `raw_ref` is empty / the query returns
   nothing (parse regression, moved IDs from consolidation, resolver path, or DB env), fix at the root, and make
   the two resolver paths (this tool and the comps subject-hydration) agree on a resolvable property. Preserve the
   `{status, candidates}` envelope contract (prompt 25): `resolved` with the entity when unambiguous, `ambiguous`
   with candidates when >1, `not_on_file` ONLY when genuinely absent — never for a property that exists.

2. **Fix `search_entities` so it stops crashing.** Guard the undefined `.replace` (accept the request/query string
   robustly, null-safe), and return entity matches for a plain query like `"DaVita"`. Add a minimal test so a bare
   string query can't regress into a crash again.

3. Add/refresh smoke coverage: a test that `get_property_context("1050 Old Camp Rd, The Villages, FL")` resolves to
   property_id 31964 (not `not_on_file`), and that `search_entities("DaVita")` returns matches without throwing.

## Verify

- `get_property_context` for `"1050 Old Camp Rd, The Villages, FL"` → resolves property_id 31964 (SF 6,453 / 12
  chairs / DaVita), confidence high; and for a second on-file property (e.g. the Kannapolis comp) → resolves or
  returns real candidates, never a false `not_on_file`.
- `search_entities("DaVita")` → returns entity matches, no `.replace` crash.
- Comps, briefing, pipeline health, queue summary unchanged (still correct).
- Note whether the fix was code-only (redeploy tranquil-delight + standalone MCP) or also needed a DB/env change.
