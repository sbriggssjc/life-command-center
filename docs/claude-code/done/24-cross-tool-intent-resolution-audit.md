# Prompt 24 — Audit every LCC tool for the plain-language intent/resolution gap (Phase 1)

## Why
Prompt 23 fixed plain-language handling for comps. Scott's follow-up: the same "loose request → wrong/thin output"
gap likely exists in the other tools. Design + rationale: `docs/architecture/request-understanding-and-consistency-
layer.md`. This is the **understand-first audit** (no refactor yet) that confirms scope before we extract shared
modules.

## Task — audit, don't build
For each tool/workflow below, read the handler and report: (a) how it resolves the SUBJECT/entity from a
plain-language reference (address/name/"the X deal"), and where that's weak or duplicated; (b) how it infers
INTENT/mode/output vs requiring exact params; (c) which Team-Briggs QUALITY/consistency rules it applies
(cap/rent reconciliation, reliable-vs-estimated transparency, source labeling, buyer/seller policy, no-fabrication
"Not on file/Derived/Conflict") and where they differ from comps' now-canonical implementation.

Tools/handlers (in `mcp/` + `api/`):
- `generate_bov` + skills `bov-underwriting` / `bov-government` (HIGHEST exposure — template pick, assumptions,
  cap/rent reconciliation).
- `get_property_context`, `get_contact_context`, `get_deal_dossier` (entity resolution, dupes like 35724 vs 29882).
- `offer-submission` skill (resolve listing/deal/parties from an inbound LOI).
- `cms-npi-analysis` (facility by address/Medicare ID/NPI).
- `search_entities` (the resolver front door — assess how good NL resolution is here, since everything leans on it).
- `generate_comps` (confirm it inherits synthesize's fixed path).

## Deliverable
Write `docs/architecture/intent-resolution-audit-2026-08-03.md`: a per-tool table (subject resolution / intent /
quality — status + specific gap + duplication vs comps), then a prioritized extraction plan for the four shared
modules (Subject/Entity Resolver, Intent Interpreter, Data-Consistency Contract, Reference/Gazetteer) — what to
promote out of `mcp/comps-tools.js` first and which tool adopts each module first (BOV leads). Flag anything where
resolution currently guesses silently (picks one of duplicate entities without disclosing) — those are the
highest-risk. Recommend where interpretation logging should hook in.

## Guardrails
- AUDIT ONLY — do not refactor tools in this prompt; propose the plan.
- Do not fabricate; where a tool's behavior is unclear from code, say so and point to the file/line.
- Reconcile against the design doc's exposure table; correct it if the code says otherwise.
