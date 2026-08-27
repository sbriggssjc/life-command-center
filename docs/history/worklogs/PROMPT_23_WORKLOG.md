# Prompt 23 Worklog — Comps Engine Plain-Language Robustness

## Objective
Make the shared comps engine interpret plain-language comp requests consistently across ChatGPT HTTP, Copilot HTTP, and Claude MCP by changing the shared core in `mcp/comps-tools.js`, then mirror the contract in the comps-engine skill instructions.

## Plan
- Read `CLAUDE.md`, the Prompt 23 request, and the August 3 comps triage.
- Upgrade request parsing for places, appraisal/full-set intent, operator lists, comp type, date windows, and dialysis vertical inference.
- Rank large candidate pools before final truncation for appraisal/full-set synthesis.
- Return subject, summary, score tiers, review flags, and transparency metadata in a stable shape.
- Add focused tests for the prompt examples and update `docs/comps-rollout/comps-engine-SKILL.md`.

## Changes
- Added place/subject resolution for key named markets including The Villages and Woodland Hills, with subject fields rendered as "Not on file" when no source attribute is available.
- Added appraisal/full-set intent detection. Bare dialysis place requests and appraiser/valuation/package wording now default to all operators, sold + active listings, include estimated-NOI comps, and a larger candidate pool.
- Added operator-list parsing (`tenants`) so multi-operator requests do not become one impossible `ILIKE` blob. The RPC receives `p_tenant = null` for multi-operator pulls and the engine filters locally.
- Changed synthesis to pull up to 100 candidates in appraisal mode, score by subject similarity, assign A/B/C tiers, then cap the final ranked set.
- Added `subject`, `summary`, `transparency`, score tiers, and richer interpreted query metadata to synthesized output.
- Updated `docs/comps-rollout/comps-engine-SKILL.md` so the skill contract matches the engine behavior.
- Added focused parser/routing/output tests for Prompt 23 examples.

## Verification
- `node --test test/comps-bounded-output.test.mjs` — passed.
- `node --test test/comps-reconciliation.test.mjs` — passed.
