# Prompt 25 — Phase 2: extract the shared Subject/Entity Resolver + fix the silent-guess paths

## Why
The Phase-1 audit (`docs/architecture/intent-resolution-audit-2026-08-03.md`) confirmed the highest-value, highest-
risk shared module is the **Subject/Entity Resolver**, and the highest-risk live behavior is
`get_property_context` / `get_contact_context` silently choosing one of several matches (`limit=1` / `chooseBestEntity`)
without disclosing alternatives — the 35724-vs-29882 collision class. Build the resolver and retire the silent guesses.

## Task
1. **Create a shared `resolveSubject(ref, opts)`** (new `mcp/subject-resolver.js`) returning a uniform envelope:
   `{ status:'resolved'|'ambiguous'|'not_on_file', entity, type, confidence, resolved_via, candidates[] }`.
   Promote the pieces the audit identified: the dossier ambiguity envelope
   (`mcp/deal-dossier-tools.js:37`), BOV's id-or-address semantics (numeric=id, address+optional state, 0→none,
   many→candidates; `bov-generator/bov_record_loader.py:81`), the `search_entities` data sources
   (`mcp/server.js:805`), and CMS matching as a domain strategy (Medicare/CCN exact → thresholded fuzzy;
   `api/admin.js:6403`). Never pick silently: >1 confident match → `ambiguous` + candidates.
2. **Adopt in priority order** (per the audit):
   a. `get_property_context` — replace the `limit=1` address/name + `dia`-before-`gov` first-hit paths
      (`mcp/server.js:240,254,974`; HTTP mirror `api/_handlers/property-handler.js:68,275`) with the resolver;
      on `ambiguous`, return the envelope instead of a packet.
   b. `get_contact_context` — unify MCP + the weaker HTTP mirror (`api/_handlers/contact-handler.js:84`) on the
      resolver; return alternatives instead of `chooseBestEntity()` silently.
   c. Wrap BOV's generator resolver so it emits the same envelope + logging (keep its 409 behavior).
3. **Interpretation logging.** Log every resolve: `{ raw_ref, status, chosen_entity, candidates_n, tool }` to a
   lightweight table/stream so the Health surface can show "ambiguous/guessed" rates (the observability gap).
4. Leave the Intent Interpreter, Data-Consistency Contract, and Gazetteer as later phases — but note where each
   hooks in.

## Verify
- A duplicate-name reference (e.g. "Woodland Hills") returns `ambiguous` + both 35724 & 29882 as candidates, on
  BOTH `get_property_context` MCP and HTTP — never a silent pick.
- A clean reference resolves with `resolved_via` populated.
- BOV still refuses ambiguous CRE matches (409) and now logs the resolution.
- Existing single-match behavior unchanged; no fabricated fields.

## Guardrail
Do not weaken any current refuse-ambiguity behavior (dossier/BOV). This ADDS disclosure to the tools that
currently guess; it must never make a confidently-resolved lookup ambiguous.
