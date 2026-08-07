# Prompt 67 — Add the comps operations to `copilot-spec-v2` (so the slimmed Copilot connector keeps comps)

## Why (Copilot Phase 1, 2026-08-07 — follow-up to prompt 66)

Prompt 66 slimmed `generateSwagger2Spec` (`/api/copilot-spec-v2`) from 95 → 47 operations by dropping the compat
aliases + dispatch gateway. But a dump of the slimmed v2 spec shows it has **no comps operations** — the 47 are 43
`ACTION_REGISTRY` actions + 4 typed gateway ops (`intakeStageOm`, `intakeFinalizeOm`, `contextRetrieveEntity`,
`memoryLogTurn`). Comps (`synthesizeComps` / `queryComps` / `generateComps`) are **not** in `ACTION_REGISTRY` /
`ACTION_SCHEMAS`; they live only in the `OPERATIONS` array consumed by `generateOpenApiSpec` (the full spec) and in
the ChatGPT curated spec.

The existing `LCC Intelligence` Copilot connector still shows a comps op ("Query de-duplicated sales comps") only
because it was imported ~18 months/days ago from an older v2 build. If we re-import the current slimmed v2 spec as
Phase 1 requires, **comps disappear from the Copilot agent** — breaking the Comps Flow (SynthesizeComps / QueryComps
/ GenerateComps). Comps is a core capability and must stay on the connector.

## Task

Add the three comps operations to the **v2 spec only**, as typed gateway operations (the same mechanism that already
emits `contextRetrieveEntity` etc.), pointing at the real mounted flat comps routes.

1. In `api/_shared/action-schemas.js`, add three entries to **`TYPED_GATEWAY_OPERATIONS`** (the array at ~line 1030
   that `generateSwagger2Spec` emits via its typed-ops loop, ~line 1659), reusing the EXACT path / inputs / outputs
   already defined for comps in the `OPERATIONS` array (search for `tag: 'comps'`, ~lines 1178–1215):
   - `SynthesizeComps` → `POST /api/synthesize-comps` — summary "Synthesize a ranked sales-comp set from a
     plain-language request"; reuse the `synthesizeComps` inputs/outputs (the `request` + optional structured
     fields; returns `{ ok, comps[] }`).
   - `QueryComps` → `POST /api/query-comps` — summary "Query de-duplicated sales comps by explicit filters"; reuse
     the `queryComps` inputs/outputs.
   - `GenerateComps` → `POST /api/comps` — summary "Generate a Briggs CRE comps workbook (returns a download
     link)"; reuse the `generateComps` inputs/outputs (one-shot `request` mode + row payload mode).
   Use **PascalCase operationIds** (`SynthesizeComps`, `QueryComps`, `GenerateComps`) so the connector's operation
   names are uniform with the other discrete ops and match the agent instructions. Keep `tag: 'comps'`.

2. Do **not** duplicate: these must appear once each in the v2 spec. Confirm they do NOT collide with any existing
   operationId, and that the flat routes `/api/synthesize-comps`, `/api/query-comps`, `/api/comps` are already
   mounted in `server.js` (they are — used by the ChatGPT/curated surface). This prompt only advertises them in v2.

3. Leave `generateOpenApiSpec` (`/api/copilot-spec`) and `generateChatGptSpec` (`/api/gpt-spec`) unchanged — comps
   already exist there under the camelCase operationIds; do not touch those.

4. Extend the prompt-66 guardrail test (`test/copilot-spec-v2-slim.test.mjs`): assert the v2 spec now contains
   `SynthesizeComps`, `QueryComps`, and `GenerateComps`, each mapped to its correct `/api/...comps` path, and that
   the total op count is ~50 (47 + 3). Keep the existing assertions (no dispatch gateway, no `/compat/` paths,
   unique operationIds, `GetDailyBriefingSnapshot` present).

## Verify

- `GET {tranquil-delight}/api/copilot-spec-v2` returns ~50 operations including `SynthesizeComps`
  (`/api/synthesize-comps`), `QueryComps` (`/api/query-comps`), and `GenerateComps` (`/api/comps`) — still no
  `dispatchCopilotAction`, no `/api/copilot/compat/*`, all operationIds unique.
- A POST to `/api/synthesize-comps` with `{ "request": "dialysis sales comps, last 18 months" }` returns the ranked
  comp set (route already mounted; unchanged behavior).
- Guardrail + existing tests pass. Code-only → **redeploy `tranquil-delight` AND the standalone MCP**. Can ship on
  the same branch/PR as prompt 66 (#1602) so it's one re-import for the connector.
