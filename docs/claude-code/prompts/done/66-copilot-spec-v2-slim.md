# Prompt 66 — Slim the Copilot connector spec: drop the compat aliases + dispatch gateway from `copilot-spec-v2`

## Why (Copilot Studio orchestration overload, 2026-08-07)

The `LCC Intelligence` custom connector (built from `GET /api/copilot-spec-v2`, Swagger 2.0) exposes **95
operations** to the LCC Deal Agent. Microsoft's generative orchestration recommends **≤ 25–30 tools** per agent
and advises splitting past **30–40 choices**; at 95 the orchestrator fails before it even calls a tool
(the agent errors on its own greeting with "I'm sorry, I'm having trouble right now").

The 95 is inflated by design. `generateSwagger2Spec` (`api/_shared/action-schemas.js`, ~line 1529) emits each
`ACTION_REGISTRY` action **three times**:
1. a discrete **PascalCase** operation at `/api/copilot/{category}/{action-id}` (e.g. `GetDailyBriefingSnapshot`),
2. a **snake_case `/compat/` alias** at `/api/copilot/compat/{action-id}` with `operationId = actionId`
   (~48 duplicate operations — the "snake_case period" back-compat shims), and
3. a single **`dispatchCopilotAction` gateway** at `/api/chat` (`operationId: 'dispatchCopilotAction'`, ~line 1570).

The compat aliases are pure duplicates of the PascalCase ops, and the gateway is a catch-all the orchestrator
falls into (it's the source of the "Please provide the parameters specific to the copilot action" stall). Removing
both from the **spec** roughly halves the operation count (95 → ~48) with **zero loss of real capability** — every
action is still reachable via its discrete PascalCase operation.

This is Phase 0 of the Copilot architecture plan (`docs/copilot/COPILOT-ARCHITECTURE-PLAN.md`): shrink the source
of the sprawl so the interim single-agent prune and the eventual child-agent grouping are both clean.

## Scope — change ONLY the Swagger 2.0 / Copilot connector spec

- **Edit `generateSwagger2Spec`** in `api/_shared/action-schemas.js` (the generator behind
  `GET /api/copilot-spec-v2`, served via `server.js` `app.all('/api/copilot-spec-v2', …)`).
- **Do NOT touch** `generateOpenApiSpec` (`/api/copilot-spec`, the full OpenAPI dispatch spec) or
  `generateChatGptSpec` (`/api/gpt-spec`, the curated ChatGPT surface). Those stay exactly as they are.
- **Server routes stay mounted.** Leave the `/api/chat`, `/api/copilot/{category}/:action`, and
  `/api/copilot/compat/:action` Express routes in `server.js` untouched — we are only removing their
  *advertisement* in the v2 spec, not the runtime routes (nothing that currently calls those paths directly breaks).

## Task

1. In `generateSwagger2Spec`:
   - **Remove the `dispatchCopilotAction` gateway path** (the `/api/chat` block, ~line 1570) from the generated
     spec so the connector no longer advertises the catch-all gateway.
   - **Remove the `/compat/` snake_case alias emission** (the `compatPathKey = /api/copilot/compat/{action-id}`
     block, ~lines 1634–1655) so only the discrete PascalCase per-action operations remain.
   - **Keep** the discrete PascalCase per-action paths (`/api/copilot/{category}/{action-id}`) and the
     `TYPED_GATEWAY_OPERATIONS` loop (~line 1659) unchanged.
2. Confirm the resulting v2 spec is still valid Swagger 2.0 (the existing `sanitizeForSwagger2` pass still runs)
   and that operation count ≈ the number of `ACTION_REGISTRY` actions + typed gateway ops (roughly halved from 95;
   expected ~48). No two operations share an `operationId`.
3. **Guardrail test** (new or extend an existing spec test): assert that the generated v2 spec contains
   **no** operation with `operationId === 'dispatchCopilotAction'`, **no** path under `/api/copilot/compat/`, and
   that every remaining operationId is unique. Also assert the discrete briefing op is present and named
   `GetDailyBriefingSnapshot` (guards the exact name the agent/instructions rely on).
4. Leave `docs/comps-rollout/lcc-openapi.yaml` (ChatGPT curated) and any ChatGPT artifacts alone.

## Verify

- `GET {tranquil-delight}/api/copilot-spec-v2` returns a valid Swagger 2.0 doc with **~48 operations** (down from
  95), **no** `dispatchCopilotAction`, and **no** `/api/copilot/compat/*` paths — only discrete PascalCase ops
  (incl. `GetDailyBriefingSnapshot`, `GetMyExecutionQueue`, `GetPipelineIntelligence`, `GetHotBusinessContacts`,
  `SearchEntities`, `GetRelationshipContext`, `GenerateProspectingBrief`, `DraftOutreachEmail`,
  `DraftSellerUpdateEmail`, `ListStagedIntakeInbox`, `TriageInboxItem`, `CreateTodoTask`, `LogCallNote`,
  `SynthesizeComps`, `QueryComps`, `GenerateComps`) plus the typed gateway ops.
- `GET /api/copilot-spec` (full) and `GET /api/gpt-spec` (ChatGPT) are unchanged.
- The runtime routes still resolve: a POST to `/api/copilot/portfolio/get-daily-briefing-snapshot` still returns
  the briefing (routes weren't removed, only their spec advertisement).
- Guardrail test passes. Code-only → **redeploy `tranquil-delight` AND the standalone MCP** for parity.

## Note for after deploy (manual, Phase 1 — not part of this PR)

Once redeployed, updating/re-importing the `LCC Intelligence` connector from the slimmed spec will drop the
compat/gateway operations. On the agent, we then keep only the ~15 essential PascalCase tools and slim the
instructions under the 8,000-char limit (canon → knowledge file). That step is done in Copilot Studio, not in code.
