# Claude Code — small fix: MCP gov_data ownership_history column name

## Why (grounded live 2026-06-11)
`mcp/server.js` `get_property_context` builds a `gov_data` section that queries gov
`ownership_history` ordered by **`recorded_date`** — a column that does NOT exist on
the gov table. Live result: `gov_data.ownership_history` returns
`{"code":"42703","message":"column ownership_history.recorded_date does not exist"}`
for every gov property. The correct column is **`transfer_date`** (verified: gov
`ownership_history` columns include `transfer_date`, `created_at`, `change_type`,
`prior_owner`, `new_owner`, `recorded_owner_name`, `true_owner_name`, … — there is
no `recorded_date`).

## The change — `mcp/server.js` (gov ownership_history query, ~line 320-323)
Change the order column from `recorded_date` to `transfer_date`:
```
ownership_history?property_id=eq.${enc(govExtId)}&select=*&order=transfer_date.desc&limit=10
```
(If any other gov query in the file references `recorded_date` on
`ownership_history`, fix those too — grep `recorded_date`.) Pure column-name fix; no
behavior change beyond the query now succeeding.

## Tests / house rules
`node --check` on `mcp/server.js`; this is the MCP service (12-function ceiling
unaffected). Ships on the MCP-service redeploy. No new env.

## After deploy (Claude/Cowork)
I'll call MCP `get_property_context` on a gov property and confirm
`gov_data.ownership_history` returns rows instead of the 42703 error. (The context
packet's own `ownership` section already works — this only repairs the legacy
gov_data side panel.)
