# Prompt 32 Ollama Cleaning-Assist Worklog

## Objective
Add a local-Ollama cleaning-assist agent as the P4 continuous scrub layer on top of the resolver. It proposes triage, unstructured links, and conflict narration; it never dedups, merges, or writes canonical domain data.

## Guardrails
- LLM output is a proposal only.
- Canonical truth remains resolver + field_source_priority + human verdicts.
- Every proposal is provenance-tagged with `source='ollama_clean_assist'`, confidence, and source_run_id.
- Proposals attach to the existing Decision Center subject keys instead of creating a parallel review surface.
- Feature flag must make the off state visible in `feature_flags_registry`.

## Plan
- Add an additive LCC Opps migration for the proposal ledger, health view, flag row, and pg_cron schedule.
- Add a bounded `/api/ollama-clean-assist-tick` worker route under `admin.js`.
- Reuse `invokeExtractionAI` so Ollama is primary when configured and cloud fallback remains available.
- Decorate existing Decision Center cards with the latest assist proposal.
- Add static tests proving this path uses the proposal table/AI seam and does not call merge/write RPCs.

## Changes
- Added `supabase/migrations/20260804140000_lcc_prompt32_ollama_clean_assist.sql`:
  - `lcc_clean_assist_proposals` proposal ledger keyed to existing Decision Center subjects.
  - `v_lcc_clean_assist_latest` for card decoration.
  - `v_lcc_clean_assist_health` for Health surface metrics.
  - `OLLAMA_CLEAN_ASSIST` feature flag row, default off and visible.
  - pg_cron schedule through `lcc_cron_post('/api/ollama-clean-assist-tick')`.
- Added `/api/ollama-clean-assist-tick` as an `admin.js` subroute mounted in `server.js`.
- Worker reads existing federated lanes across ops/gov/dia (`property_merge`, `owner_reconcile`, `sf_link_candidate`, `provenance_conflict`, `intake_disposition`), calls `invokeExtractionAI`, and upserts proposal-only rows.
- Existing `/api/decisions` items now attach latest `clean_assist` proposal metadata.
- Decision Center cards render a read-only "Ollama assist" hint without changing verdict actions.
- LCC Health includes clean-assist throughput/depth/flag metrics.
- Added static guard tests in `test/ollama-clean-assist.test.mjs`.

## Verification
- `node --check api\admin.js`
- `node --check server.js`
- `node --check ops.js`
- `node --test test/ollama-clean-assist.test.mjs`
- `node --test test/decision-center-partition.test.mjs`
- `node --test test/operations-subroutes.test.mjs`
- `node --test test/lcc-health-surface.test.mjs test/ollama-clean-assist.test.mjs test/decision-center-partition.test.mjs`

## Notes
- The migration has not been applied to live LCC Opps from this chat.
- Runtime proposal generation remains off until `OLLAMA_CLEAN_ASSIST` is flipped on in env or `feature_flags_registry`.
