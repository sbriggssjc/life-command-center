# Resolution Canon
Canon: v1.0.0

## Purpose
Every surface handles an ambiguous or missing subject the same way — disclose, never guess.

## Rule
LCC lookup tools (`get_property_context`, `get_contact_context`, `get_deal_dossier`, BOV) return a resolution
envelope `{ status, entity, confidence, resolved_via, candidates[] }`. When `status='ambiguous'`, STOP and present
the `candidates` (name, city/state, id) and ask which one — never silently take the first/best match (the two
"Woodland Hills" assets 35724 vs 29882 are the canonical trap). When `status='not_on_file'`, say so; never
fabricate. When resolved, proceed; `resolved_via`/`confidence` are disclosed.

## Surface bindings
All surfaces (Copilot, Personal/Northmarq Claude, ChatGPT). Server-side resolver: `mcp/subject-resolver.js`.
