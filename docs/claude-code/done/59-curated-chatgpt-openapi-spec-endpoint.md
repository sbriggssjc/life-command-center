# Prompt 59 — Serve a live, curated ChatGPT OpenAPI spec (≤30 ops) from the registry; retire the hand-maintained static yaml

## Why (ChatGPT GPT Action setup, 2026-08-06)

Wiring the ChatGPT custom GPT to the LCC tools surfaced two problems that share one root cause — a
**hand-maintained static spec that drifts from the live routes**:

1. **30-op cap.** Importing the live `/api/copilot-spec` fails in ChatGPT with *"OpenAPI spec can have a maximum
   of 30 operations."* That endpoint emits the FULL `ACTION_REGISTRY` (46 actions, `api/operations.js:3150`) as
   `/api/copilot/{category}/{action}` dispatch ops — the Microsoft/Copilot surface. ChatGPT should never get most
   of those (internal pipeline/ingest/merge/cron actions like `run_listing_bd_pipeline`, `ingest_pdf_document`,
   `merge_duplicate_entities`).
2. **Static-file drift.** The curated ChatGPT spec we hand people to paste — `docs/comps-rollout/lcc-openapi.yaml`
   (15 flat ops) — is a hand-maintained snapshot (last touched 2026-08-04). It already diverges from the live
   wiring: it declares the daily briefing at `/api/ai/daily-briefing`, while the MCP read-route table
   (`mcp/server.js` `READ_HTTP_ROUTES`) mounts it at `/api/daily-briefing` (both happen to resolve today via
   `api/ai-read.js`, but the spec and the routes are maintained separately, so nothing guarantees they stay in
   sync). This is exactly the "a stale file silently drops/mis-routes a tool" risk.

We want ONE generated source of truth, imported by URL, so the GPT's tool set can never drift and never trips the
cap — the same discipline as the canon (generated, not hand-copied).

## The two surfaces (keep them distinct)
- **ChatGPT** needs the **curated flat-route REST surface** — the ~15 user-facing tools that already exist as live,
  Bearer-authed routes: the `READ_HTTP_ROUTES` set (`/api/search-entities`, `/api/property-context`,
  `/api/contact-context`, the briefing, `/api/queue-summary`, `/api/pipeline-health`, `/api/recall-memory`), the
  comps routes (`/api/query-comps`, `/api/synthesize-comps`, `/api/comps`), the deal routes (`/api/deal/dossier`,
  `/api/deal/checkpoints`), and the Salesforce write routes (`/api/sf/log-activity`, `/api/sf/create-task`,
  `/api/sf/update-opportunity`). That's 15 — under 30, with headroom to add a couple more (e.g. offer context) and
  still fit.
- **Copilot Studio / Microsoft** keeps the full dispatch spec at `/api/copilot-spec` + the Swagger-2.0 variant at
  `/api/copilot-spec-v2`. Do not change those.

## Task

1. **Define the curated ChatGPT tool set as a single in-code source of truth** — the ~15 flat routes above, each
   with its path, HTTP method, `operationId`, summary/description, request schema, and response schema. Derive this
   from (or share it with) the SAME definitions that actually MOUNT those routes (`READ_HTTP_ROUTES` + the comps /
   deal / SF route registrations), so the spec is generated from the routes, not maintained beside them. If full
   unification is too large, at minimum keep the curated list in ONE place and add the test in step 4.

2. **Serve a live, curated spec endpoint** — e.g. `GET /api/copilot-spec?surface=chatgpt` (or a dedicated
   `/api/gpt-spec`), no auth on the GET (same as the existing spec endpoint so ChatGPT can fetch it at import time),
   OpenAPI 3.x, `servers` = the tranquil-delight base URL, `securitySchemes.bearerAuth` (Bearer `LCC_API_KEY`),
   and **only** the curated operations (must be ≤ 30). Reuse the existing `generateOpenApiSpec` generator over the
   curated list rather than writing a second generator. Paths must be the REAL mounted paths (resolve the
   `/api/daily-briefing` vs `/api/ai/daily-briefing` question — pick the canonical one, ensure it's mounted +
   Bearer-authed, and use it in the spec).

3. **Retire the hand-maintained static yaml.** Replace `docs/comps-rollout/lcc-openapi.yaml` with either (a) a
   short README pointing to the live curated URL as the thing to import, or (b) a file that is GENERATED from the
   endpoint and clearly stamped "generated — do not hand-edit; import the live URL." No one should paste a
   hand-edited spec again.

4. **Guardrail test (the anti-drift check).** Add a test asserting that EVERY operation in the curated spec maps to
   a route that is actually mounted AND Bearer-authenticated — so a path mismatch like the briefing one is caught
   in CI, not in ChatGPT. Also assert the curated op count ≤ 30.

5. Update `docs/setup/GPT_ACTIONS_SETUP.md` to say: import the Action from the curated URL (Step 4), set Bearer +
   `LCC_API_KEY`; note the 30-op cap and that the curated surface is intentionally the user-facing subset.

## Verify

- `GET {tranquil-delight}/api/copilot-spec?surface=chatgpt` (or the chosen URL) returns a valid OpenAPI 3.x doc with
  **≤ 30 operations**, servers = tranquil-delight, Bearer security, and exactly the curated tool set (incl.
  `getDailyBriefing`, comps, property/contact context, queue/pipeline, deal dossier/checkpoints, SF write).
- Importing that URL into a ChatGPT custom GPT Action succeeds (no 30-op error) and lists the curated operations.
- With Bearer + `LCC_API_KEY` set, the GPT can call the briefing, comps, and property-context tools and get live
  data (the briefing returns market numbers + priorities, not a from-memory description).
- The guardrail test passes: every curated op → a mounted, authenticated route; op count ≤ 30.
- `/api/copilot-spec` (full) and `/api/copilot-spec-v2` (swagger2, Copilot) are unchanged.
- Note whether this is code-only (redeploy tranquil-delight + standalone MCP) — it should be.
