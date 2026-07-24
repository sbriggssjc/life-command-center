# Claude Code Prompt — Bound the Option A `/api/*` Read-Route Responses for ChatGPT/Copilot Actions

## Why
The Option A HTTP read routes (`mcp/server.js`) return the **same rich payloads as the Claude MCP tools** —
sized for Claude's large context. ChatGPT Custom GPT Actions cap a single response at ~100,000 characters and
throw **`ResponseTooLargeError`** when exceeded; Microsoft Copilot connectors have similar limits. **Measured
live:** calling `getDailyBriefing` from a ChatGPT Action returned `ResponseTooLargeError` (the endpoint fired
and responded — auth/URL/import are all correct — the payload was just too big). `queryComps`/`synthesizeComps`
are fine (bounded by `limit`); `searchEntities` is fine with a small limit. The rich read tools
(`get_daily_briefing`, `get_property_context`, `get_queue_summary`, `recall_memory`) are the ones at risk.

Fix: bound the **HTTP** responses so they're always Action-safe, **without changing the MCP (Claude) surface** —
Claude handles large payloads and must keep full fidelity.

## Implement
1. **Shared HTTP response guard.** In the HTTP read wrapper (the `makeReadHttpRoute` factory / the `/api/*`
   handlers), after producing the JSON result, enforce a size ceiling before sending:
   - `const MAX_HTTP_RESPONSE_CHARS = 45000;` (top-of-module constant; ~45 KB, comfortably under the ChatGPT
     and Copilot caps).
   - If `JSON.stringify(result).length > MAX_HTTP_RESPONSE_CHARS`, shrink deterministically: (a) cap the large
     arrays to a per-tool default N (trim the **tail**, never the top-ranked items), (b) drop the heaviest
     verbose fields (nested `raw` blobs, long free-text, base64, full nested graphs), and (c) add
     `truncated: true` + `truncation_note` (what was trimmed + how to get more, e.g. "raise limit / call the
     specific entity"). Re-check size after trimming; trim again if still over.
   - This is generic so **every** `/api/*` route inherits it. The MCP tool handlers are untouched.
2. **Sensible per-tool HTTP defaults** (so responses are small by default, expandable on request):
   - `daily-briefing`: return the top **N per band** (e.g. 10 urgent / 10 high / 10 normal) with only the
     display fields (id, title, status, due_date, priority, entity_id) — not the full snapshot. Add an optional
     `limit`.
   - `queue-summary`: default `limit` small (e.g. 25); return band counts + top items, not the whole gap universe.
   - `recall-memory`: default `limit` small (e.g. 20); return summaries, not full payloads.
   - `property-context`: the richest one — cap nested arrays (comps, ownership_history, related contacts) to a
     top-N each and drop verbose `raw`/document blobs by default; add an optional `verbose`/`sections` param for
     when the caller wants the full packet.
   - `search-entities`: default `limit` 10.
3. **Expose the new optional params** (`limit`, and `verbose`/`sections` for property-context) in
   `docs/comps-rollout/lcc-openapi.yaml` so ChatGPT/Copilot can ask for more when needed. Keep it OpenAPI 3.1.0.
4. **Do NOT touch the MCP tool outputs.** Verify `/mcp` responses are byte-identical to before (Claude keeps full
   fidelity). Only the `/api/*` HTTP layer bounds size.

## Verify / report
- For each `/api/*` read route, print the serialized response length before/after — confirm all are
  < `MAX_HTTP_RESPONSE_CHARS`.
- Re-test `getDailyBriefing` from the ChatGPT GPT Action → returns a briefing with **no** `ResponseTooLargeError`;
  spot-check `property-context` (the heaviest) returns bounded + `truncated` marker when the full packet is large.
- Confirm `/mcp` `get_daily_briefing` / `get_property_context` still return the full (unbounded) payloads.
- Report the before/after sizes per route and which fields get trimmed by default.

## Guardrails
- Read-only; additive; MCP surface unchanged. Trim the **tail** (never the highest-priority items); mark every
  truncation transparently. `node --check` clean; existing tests pass. Update
  `docs/comps-rollout/comps-rollout-checklist.md` note that the HTTP read routes are Action-size-bounded.
