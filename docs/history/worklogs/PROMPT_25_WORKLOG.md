# Prompt 25 Worklog

Date: 2026-08-03

## Objective

Extract a shared Subject/Entity Resolver and adopt it in the highest-risk silent-guess paths:
`get_property_context`, `get_contact_context`, HTTP mirrors, and BOV lookup logging without weakening existing
ambiguity refusal.

## Current Context

- Phase-1 audit is `docs/architecture/intent-resolution-audit-2026-08-03.md`.
- Project doctrine is to surface ambiguity and never guess.
- `/api` changes must follow `.github/AI_INSTRUCTIONS.md`; `server.js` remains the API routing source of truth.

## Plan

1. Read the existing MCP, HTTP mirror, and BOV resolver code.
2. Add `mcp/subject-resolver.js` with a uniform `resolved | ambiguous | not_on_file` envelope and lightweight
   interpretation logging.
3. Replace first-hit property/contact resolution paths with the shared resolver.
4. Wrap BOV `resolve_property_id()` so it emits the same envelope/log while preserving 404/409 behavior.
5. Add focused tests or verification coverage for ambiguity, clean resolution, and BOV logging.

## Notes

- Later-phase hooks: Intent Interpreter, Data-Consistency Contract, and Gazetteer should attach around this
  resolver boundary rather than being implemented in this phase.
- Added `mcp/subject-resolver.js` as the shared resolution boundary. It logs `{ raw_ref, status,
  chosen_entity, candidates_n, tool }` to console and best-effort `interpretation_logs`.
- Added additive migration `supabase/migrations/20260820130000_lcc_interpretation_logs.sql` for the Health
  surface to aggregate ambiguity/not-on-file rates later.
- MCP and HTTP property/contact paths now return the resolver envelope on ambiguity/not-on-file instead of
  silently picking a first/best row.
- BOV `property_lookup` now builds/logs the same envelope while preserving numeric lookup, 404, and 409 refusal
  behavior.

## Verification

- `node --check mcp/subject-resolver.js`
- `node --check mcp/server.js`
- `node --check api/_handlers/property-handler.js`
- `node --check api/_handlers/contact-handler.js`
- Bundled Python: `python -m py_compile bov-generator/bov_record_loader.py bov-generator/main.py`
- `node --test test/subject-resolver.test.mjs`
- `node --test test/property-context-packet.test.mjs test/mcp-context-assemble.test.mjs`
- `node --test test/contacts.test.js test/contacts-company-link.test.mjs test/contact-fields.test.mjs`
- Bundled Python monkeypatch smoke: ambiguous BOV lookup preserves 409 and carries `resolution.status =
  'ambiguous'`.
