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
- In progress.

## Verification
- Pending.
