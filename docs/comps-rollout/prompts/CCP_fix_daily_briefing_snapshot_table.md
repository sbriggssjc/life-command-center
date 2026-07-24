# Claude Code Prompt — Fix `get_daily_briefing`: read the real snapshot table (LCC Opps)

## Bug (root cause)
`get_daily_briefing` in `mcp/server.js` (~line 650) queries a table that **doesn't exist** —
`daily_briefing_snapshot` — so the GET returns not-ok and the handler **always** falls through to the raw
`action_items_fallback`. The curated intel briefing is therefore never served on any surface (Claude, ChatGPT,
Copilot). The real, actively-populated table is **`briefing_intel_snapshot`**.

## Ground truth (verified live on LCC Opps `xengecqvemvfknjvbvrq`, 2026-07-24)
- `briefing_intel_snapshot`: **44 rows, latest generated today (2026-07-24 10:00)** — it's populated daily.
  Columns: `id, as_of_date (date), workspace_id (uuid), variant (text), generated_at (timestamptz),
  key_numbers (jsonb), market_data (jsonb), fed_outlook (jsonb), analyst_take (text), capital_markets (text),
  sector_news (jsonb), reading_list (jsonb), weekly_changes (jsonb), source_counts (jsonb), ai_model,
  ai_tokens_in, ai_tokens_out, warnings (jsonb), created_at`.
- Two variants: `daily` (latest 2026-07-23) and `friday_deep_dive` (latest 2026-07-24). **Pick the latest
  snapshot regardless of variant** — do NOT hardcode `variant='daily'`, or Friday deep-dives are missed.
- `daily_briefing_snapshot` does not exist (confirmed).

## Fix (`mcp/server.js` → `get_daily_briefing` handler)
1. **Point the snapshot query at the real table:**
   - FROM: `daily_briefing_snapshot?workspace_id=eq.${wsId}&order=created_at.desc&limit=1`
   - TO:   `briefing_intel_snapshot?workspace_id=eq.${wsId}&order=as_of_date.desc,generated_at.desc&limit=1`
   - On hit, return `source: 'briefing_intel_snapshot'` with the intel fields (`as_of_date, variant,
     key_numbers, market_data, fed_outlook, analyst_take, capital_markets, sector_news, reading_list,
     weekly_changes`).
2. **Fold in the team's action items as a section (not only a fallback).** Keep fetching the urgent/high/normal
   `action_items` and attach them to the briefing as a `priorities` section, so the full briefing = market intel
   + team to-dos in one payload. Keep the pure `action_items_fallback` **only** when NO snapshot row exists for
   the workspace.
3. **HTTP size:** confirm the `daily-briefing` shaper in `mcp/http-response-bound.js` handles the
   `briefing_intel_snapshot` shape — cap/trim the jsonb arrays (`sector_news`, `reading_list`, `weekly_changes`,
   `market_data`) and keep the short text fields (`analyst_take`, `capital_markets`, `key_numbers`). The generic
   guard should catch anything that slips past; verify a real snapshot stays < 45 KB over `/api/daily-briefing`.
4. **Surface split unchanged:** `/mcp` (Claude) returns the full snapshot; `/api/*` stays bounded.

## Verify / report
- MCP `get_daily_briefing` → `source: 'briefing_intel_snapshot'`, today's row (2026-07-24, `friday_deep_dive`),
  with intel + a `priorities` section. Report the returned `source` + `as_of_date`.
- `/api/daily-briefing` → response < 45 KB, no `ResponseTooLargeError`; re-test in the ChatGPT GPT → a real
  curated briefing.
- Confirm the action-items fallback still fires when a workspace has no snapshot.

## Guardrails
Read-only; the only changes are the table name/order, attaching `priorities`, and the shaper check. Don't alter
the fallback logic beyond gating it on snapshot-absence. `node --check` clean; existing tests pass.
