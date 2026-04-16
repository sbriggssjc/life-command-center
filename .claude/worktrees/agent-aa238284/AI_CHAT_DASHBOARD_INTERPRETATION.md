# AI Dashboard Interpretation Guide

## Purpose

Use this guide after running the rollout checklist to decide whether the current AI chat routing should be kept, adjusted, or rolled back.

## Sections To Check First

### Rollout Readiness

- `Routing active`
  - Feature routing config is present and should be visible in telemetry.
- `Routing still manual/default-only`
  - The env is still effectively using the default route.
  - Do not draw conclusions about feature-level routing until this changes.

### Routing Policy

- Confirms the currently active default provider/model.
- Confirms the configured feature overrides.
- If this does not match the intended rollout, fix env first before evaluating quality.

### Routing Mismatches Detected

- Empty:
  - Observed traffic matches the configured route closely enough.
- Not empty:
  - At least one feature is landing on a provider/model that does not match the expected route.
  - Fix mismatches before making quality or cost decisions.

### Telemetry Quality

- High model coverage:
  - You can trust provider/model distribution more confidently.
- High usage coverage:
  - Token and cost analysis is much more reliable.
- Low usage coverage:
  - Do not over-interpret token totals yet.
  - Improve upstream telemetry before making strong cost claims.

## Decision Rules

### Keep Current Routing

Use `keep` if:
- all key flows work
- routing mismatches are absent or trivial
- ownership quality is acceptable
- intake/intel/ops research quality is acceptable
- telemetry quality is good enough to measure usage trends

### Adjust Routing

Use `adjust` if:
- a flow works but quality is weak
- a local model is too unreliable for structured extraction
- one feature should move from `ollama` to `openai`
- one feature should move from `edge` to a repo-local path

Typical adjustments:
- move `detail_ownership_assistant` to a stronger model if ownership reasoning is weak
- move `detail_intake_assistant` off local vision if screenshot extraction is too noisy
- move `global_copilot` to repo-local OpenAI only after telemetry and answer quality are acceptable

### Roll Back

Use `rollback` if:
- core flows fail
- routing mismatches are widespread
- Ollama is unavailable or unstable
- ownership quality drops materially
- assistant latency is unacceptable for day-to-day use

Rollback target:
- [AI_CHAT_MANUAL_EDGE_PRESET.env.example](C:/Users/scott/life-command-center/AI_CHAT_MANUAL_EDGE_PRESET.env.example)

## What Good Looks Like In Balanced Rollout

- `global_copilot` stays on `edge / gpt-5-mini`
- `ops_research_assistant` shows `ollama / llama3.1`
- `detail_ownership_assistant` shows `openai / gpt-5-mini`
- `detail_intel_assistant` shows `ollama / llama3.1`
- `detail_intake_assistant` shows `ollama / llama3.2-vision`
- mismatch table is empty
- model coverage is high
- usage coverage is at least directionally useful

## Recommended Review Order

1. Check `Rollout Readiness`
2. Check `Routing Policy`
3. Check `Routing Mismatches Detected`
4. Check `Telemetry Quality`
5. Review recent calls by feature/provider/model
6. Decide `keep`, `adjust`, or `rollback`
