# Prompt 32 — Add the Ollama cleaning-assist agent (P4 continuous scrub, assist layer)

Build the local-Ollama cleaning-assist agent as the P4 layer ON TOP OF the resolver — never the primary dedup/merge
engine. Design in `docs/architecture/comps-data-integrity-and-canonical-record.md`.

## What it does (LLM proposes; resolver/priority-ladder/human confirms — never automatic truth)
1. **Review-lane triage:** for each ambiguous merge the resolver routes to review (and the ~1,155 field_provenance
   conflicts), the agent reads the candidate records + any linked unstructured context and writes a PROPOSAL to the
   existing decision/review queue: verdict (merge / not / uncertain), a one-line reason, confidence. Never applies.
2. **Unstructured reconciliation:** extract property/sale/contact mentions from call notes, OM text, and emails and
   propose links to the right record (property_id / sale_id / entity) with confidence. Never writes the link
   directly — proposes to the review/decision lane.
3. **Conflict narration:** where field_source_priority has conflicting sources for a field, summarize the conflict
   + recommend which source wins per the precedence ladder (for the human/auto-resolve).

## Build
- Worker drains a batch each run via `invokeExtractionAI` (Ollama-first: OLLAMA_URL/OLLAMA_MODEL, cloud fallback);
  bounded batch size; runs across **dia + gov + ops**. Schedule with **pg_cron** (`lcc_cron_post`) like the other
  sweeps. Feature-flag it (`feature_flags_registry` row) so "off" is visible.
- Every proposal is provenance-tagged (`source='ollama_clean_assist'`, `confidence`, `source_run_id`), reversible,
  and lands in the SAME review/decision queue the humans already work — no new parallel surface.
- Surface throughput + review-queue depth + coverage on the **LCC Health surface**.

## Guardrails
The agent NEVER dedups/merges/writes canonical data directly — that stays the resolver + P2 (prompt 31). It only
TRIAGES and PROPOSES. No fabrication; "uncertain" is a valid verdict. Reuse existing tables (decision/review queue,
field_provenance, feature_flags_registry) — don't build parallel infra.

## Verify
- A seeded ambiguous merge + a sample call-note produce proposals in the review queue with reason+confidence,
  nothing auto-applied; the feature flag toggles it; Health surface shows queue depth + agent throughput.
