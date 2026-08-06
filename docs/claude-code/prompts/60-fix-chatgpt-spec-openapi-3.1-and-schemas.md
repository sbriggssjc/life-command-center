# Prompt 60 — Fix the curated ChatGPT spec so ChatGPT accepts it (OpenAPI 3.1 + components.schemas object)

## Why (ChatGPT GPT Action import, 2026-08-06 — post-59)

Prompt 59's `/api/gpt-spec` is live, but importing it into a ChatGPT custom GPT Action fails validation with two
errors:

1. `('openapi',): Input should be '3.1.1' or '3.1.0'` — ChatGPT's importer now requires OpenAPI **3.1.x**, but
   `generateChatGptSpec()` emits `openapi: '3.0.3'`.
2. `In components section, schemas subsection is not an object` — `generateChatGptSpec()` builds `components` with
   only `securitySchemes` and **no `schemas` key**, so ChatGPT (validating as 3.1) sees `components.schemas` as
   missing/not-an-object and rejects it.

Both are in `generateChatGptSpec` in `api/_shared/action-schemas.js`. The curated input/output schemas are already
sanitized of 3.0-only keywords (`nullable`/`examples` are stripped), so they're 3.1-safe; only the spec envelope
needs fixing.

## Task

1. In `generateChatGptSpec` (`api/_shared/action-schemas.js`):
   - Change `openapi: '3.0.3'` → `openapi: '3.1.0'`.
   - Add an empty `schemas: {}` to the `components` object (alongside `securitySchemes`), so `components.schemas`
     is a valid (empty) object. (The curated ops use inline request/response schemas, not `$ref`s, so an empty
     `schemas` map is correct.)
2. Confirm the whole curated spec is valid OpenAPI **3.1.0**: inline schemas contain no 3.0-only keywords
   (`nullable`, `example` — use `examples`/type-arrays if any are needed), and nothing references
   `#/components/schemas/*` (since it's empty). If the existing sanitizer already guarantees this, just verify.
3. Regenerate the stamped static snapshot so it matches: `npm run spec:chatgpt` (updates
   `docs/comps-rollout/lcc-openapi.yaml`, still stamped "generated — import the live URL").
4. Strengthen the guardrail test (`test/chatgpt-curated-spec.test.mjs`): assert `spec.openapi === '3.1.0'` and
   `typeof spec.components.schemas === 'object'` (and it's a plain object, not an array/null), so a regression on
   either field fails CI instead of ChatGPT.
5. Leave the full `/api/copilot-spec` (46-op dispatch) and `/api/copilot-spec-v2` (Swagger 2.0 for Copilot/Power
   Platform) unchanged — only the curated ChatGPT spec becomes 3.1.0.

## Verify

- `GET {tranquil-delight}/api/gpt-spec` returns `openapi: "3.1.0"`, `components.schemas` is an object `{}`,
  `components.securitySchemes.bearerAuth` present, ≤ 30 operations, servers = tranquil-delight.
- Importing that URL into a ChatGPT custom GPT Action succeeds with **no** "openapi should be 3.1.x" and **no**
  "schemas subsection is not an object" errors, and lists the curated operations.
- With Bearer + `LCC_API_KEY`, the GPT calls `getDailyBriefing` and returns live data.
- Guardrail + existing tests pass. Code-only → redeploy tranquil-delight + standalone MCP.
