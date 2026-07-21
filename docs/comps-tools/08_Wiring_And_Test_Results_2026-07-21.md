# query_comps — Wiring & End-to-End Test Results (2026-07-21)

Status: **deployed to both databases, wired into `server.js`, end-to-end validated.** Takes effect on the next Railway redeploy of the MCP server.

## 1. What was deployed (live)
- `rpc_query_comps` created on **government** (`scknotsqkcheojiaewwh`) and **dialysis** (`zqzrriwuavgrquhisnoa`) via migration `create_rpc_query_comps`. Both are `stable`, read-only SQL functions. No data was modified.
- One bug fixed during deploy: government `available_listings` has **no `sold_date`** column — the on-market gate uses `sale_transaction_id IS NULL` instead. (Dialysis does have `sold_date`; its RPC is unchanged.) The saved `rpc_query_comps_government.sql` matches the deployed version.

## 2. What was wired into `server.js`
Two minimal, additive edits (both syntax-checked with `node --check`):
1. Import near the top: `import { makeCompsTools } from "./comps-tools.js";`
2. Just before `app.listen(...)`, register onto the existing maps:
   ```js
   const { defs, handlers } = makeCompsTools({ govQuery, diaQuery, textResult, withTiming });
   Object.assign(TOOL_DEFINITIONS, defs);
   Object.assign(TOOL_HANDLERS, handlers);
   ```
New file `mcp/comps-tools.js` holds the tool defs + handlers (synonym expansion, parallel fan-out via the server's own `govQuery`/`diaQuery`, dedup, scoring). Nothing else in `server.js` changed. The tools appear as `query_comps` and `synthesize_comps` in `tools/list` after redeploy.

## 3. End-to-end test results

**RPC layer (live, via the deployed functions):**
- gov `rpc_query_comps(property_types=>['Health','Medical'], states=>['OK'])` → returns blended `salesforce` + `government_db` rows; cap rates normalized to decimal (SF 10.4 → 0.1040); the confidential $0 VA sale returned with `price_withheld=true` and null price. ✅
- dia `rpc_query_comps(property_types=>['Dialysis','Medical','Health'])` → blended `dialysis_db` + `salesforce`; property type from `properties.property_type`, price_per_sf derived. ✅

**JS layer (`node test_query_comps.js`, real rows from the RPCs) — 10/10 passing:**
- synonym expansion: `medical` → Health/Medical/Dialysis; `office` passthrough. ✅
- **dedup caught a real gap and now handles it:** Covington GA `"4179 Baker St"` (Salesforce) vs `"4179 Baker Street"` (canonical) — same $2.41M, same date — initially did **not** collapse because of the St/Street abbreviation. Added street-suffix normalization (`st→street`, `ave→avenue`, …); the pair now collapses to one row, keeping the higher-confidence canonical record. ✅
- Yukon VA: confidential $0 Salesforce row + priced canonical row collapse to one, keeping the priced record. ✅
- genuinely different properties in the same city are NOT merged. ✅
- deterministic `source_sf_id` link collapses a matched pair. ✅

## 4. Real dedup cases observed in live data (why the reconcile stage matters)
| property | sources | note |
|---|---|---|
| 4179 Baker St, Covington GA | salesforce (cap 0.0761) + dialysis_db (cap 0.0771), both $2.41M same day | St/Street — now collapsed |
| 1808 Commons Cir, Yukon OK | salesforce ($0 withheld) + government_db ($1.538M) same day | collapsed, keeps priced |

## 5. To activate
Redeploy the MCP server (Railway) so it picks up `comps-tools.js` and the `server.js` edits. Ensure `DIA_SUPABASE_URL`/`DIA_SUPABASE_KEY` are set on the MCP service (the README lists DIA as optional; the dialysis leg warns and degrades gracefully if unset). No RPC redeploy needed — the functions are already live. Then in Claude: *"query_comps: government medical sales in OK, last 12 months."*

## 6. Files
- `comps-tools.js` → copy to `mcp/comps-tools.js` (done in repo).
- `server.js` → edited in place (`mcp/server.js`).
- `rpc_query_comps_government.sql` / `rpc_query_comps_dialysis.sql` → deployed; kept as source of truth.
- `test_query_comps.js` → the JS-layer test harness (run with `node`).
