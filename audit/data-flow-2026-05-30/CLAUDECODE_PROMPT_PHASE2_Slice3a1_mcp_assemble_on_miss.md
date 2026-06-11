# Claude Code — Phase 2 Slice 3a.1: MCP get_property_context assembles on cache miss

## Why (grounded live 2026-06-11)
Slice 3a made the **`/api/property` HTTP mirror** assemble a rich property context
packet on a cache miss (verified: DaVita Chilton returns documents/ownership/
transactions/lease/score, cached fresh). But the **deployed MCP server**
(`mcp/server.js`) — the tool that **Copilot, Claude, and a custom GPT actually
call** — only READS the `context_packets` cache (`mcp/server.js` ~line 304-308:
`context_packets?entity_id=eq.X&packet_type=eq.property&limit=1`) and returns
`context_packet: null` on a cold miss. It relies on the nightly pre-warm, which is
bounded to the most-active assets — so a cold/long-tail property returns `null` to
agents. This closes that gap so the "every agent fully informed" promise holds on
the first ask, not just after a nightly warm.

(The MCP server already fetches some domain data itself; this change is specifically
about populating the `context_packet` field via the shared assembler so agents get
the SAME rich packet the HTTP mirror returns — documents incl. the Phase-2 doc
connections, ownership, transactions, real score.)

## The change — `mcp/server.js` `get_property_context`
- After the existing `context_packets` cache read, treat the packet as a **miss**
  when there's no row, OR the row is `invalidated`, OR `expires_at <= now()`
  (mirror the HTTP mirror's fresh-only predicate).
- On a miss, call the **main app's assemble endpoint** to build + cache + return the
  packet, then use it as `context_packet`:
  - `POST {LCC_API_BASE}/api/context?action=assemble`
    body `{ "packet_type": "property", "entity_id": <eid> }`
    headers `{ 'Content-Type':'application/json', 'X-LCC-Key': LCC_API_KEY }`
    (match however the app authenticates the context route — `X-LCC-Key` is the
    standard; confirm against an existing authenticated call).
  - Use the returned packet's `payload` as `context_packet` (parse the response to
    the same shape the cache row's `payload` has, so downstream rendering is
    unchanged).
- **New env `LCC_API_BASE`** = the main Express app base URL (the tranquil-delight
  service, e.g. `https://tranquil-delight-production-633f.up.railway.app`). Read it
  as `process.env.LCC_API_BASE`.
- **Graceful degradation (required):** if `LCC_API_BASE` is unset, or the assemble
  call errors / times out (bound it ~8s), fall back to the CURRENT behavior
  (`context_packet: null` from the cache-only read) — never break or hang the tool.
  Log a one-line warn on the fallback.
- Keep the cache-HIT fast path unchanged (no assemble call when a fresh packet
  exists). The same change should apply to the `address`-resolved path, not just
  `entity_id`.

## Tests / house rules
- Unit-test the miss→assemble path with a mocked `fetch`: a cache miss triggers the
  `POST /api/context?action=assemble` call and the returned payload becomes
  `context_packet`; a fresh cache hit does NOT call assemble; an assemble
  error/timeout falls back to `null` without throwing; `LCC_API_BASE` unset →
  cache-only (no call).
- `node --check` on `mcp/server.js`; this is the MCP service (not an `api/*.js`
  function — the 12-function ceiling is unaffected). Ships on the **MCP service**
  redeploy (the `life-command-center-production` / MCP service), and needs
  `LCC_API_BASE` set on that service. Note in the PR that this is the MCP service,
  not the main Railway app.

## After deploy (Claude/Cowork)
With `LCC_API_BASE` set on the MCP service, I'll call the MCP `get_property_context`
for a NOT-pre-warmed property and confirm `context_packet` comes back populated
(documents/ownership/transactions), proving cold-miss assembly works for agents —
then the Layer-4 keystone is fully delivered to every tool. After that, Slice 3b
(correspondence → activity_timeline).

## Note
This needs the MCP service to be able to reach the main app over HTTP (same network
/ public URL). If they're the same deployment, `LCC_API_BASE` is just that app's own
base. If the MCP can't reach the main app, the fallback keeps it safe (cache-only)
and we'd instead lean on broadening the nightly pre-warm — but the HTTP call is the
clean fix.
