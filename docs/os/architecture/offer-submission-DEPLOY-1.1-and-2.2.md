# Turnkey deploy — 1.1 (expose `lcc_offer_context` as a tool/route) + 2.2 (folder-feed indexing)

_2026-07-29. Copy-paste PR for the two highest-leverage human wire-ups from the setup runbook. 1.1 is a Railway
code deploy; 2.2 is an engine env + a capped crawl. Both grounded in the current code._

---

## 1.1 — Expose `lcc_offer_context` as an MCP tool + HTTP route + root proxy

The DB function is live. This makes it callable three ways every other pipeline capability uses: the engine HTTP
route (`/api/pipeline/offer-context`), the root proxy (so the public host forwards it), and the MCP tool
(`get_offer_context`, for direct Claude/agent callers). Mirrors the `cadence-scan` / `reconcile-entity` pattern.

### (a) New file — `mcp/offer-context.js`
```js
// offer-context.js — the offer-submission skill's single context call.
// Wraps public.lcc_offer_context(text). Reads `deal` from BOTH body and query:
// the root proxy (aiReadHandler) POSTs a JSON body and DROPS the query string.
export function makeOfferContextRoute({ opsQuery }) {
  async function get(req, res) {
    const deal =
      (req.body && (req.body.deal || req.body.p_deal)) || req.query.deal || req.query.p_deal;
    if (!deal) return res.status(400).json({ ok: false, error: 'deal_required' });
    const r = await opsQuery('POST', 'rpc/lcc_offer_context', { p_deal: String(deal) });
    if (!r.ok) return res.status(502).json({ ok: false, error: `rpc_failed_${r.status}`, detail: r.data });
    const packet = Array.isArray(r.data) ? r.data[0] : r.data;   // scalar-jsonb RPC → object (or [object])
    return res.status(200).json(packet || { ok: false, error: 'empty' });
  }
  return { get };
}
```

### (b) `mcp/server.js` — four small edits
```js
// 1) with the other route imports (near line 20, makeCadenceScanRoute / makeEntityReconcileRoute):
import { makeOfferContextRoute } from "./offer-context.js";

// 2) where the other route factories are instantiated (near __reconcile, ~line 1865):
const __offerCtx = makeOfferContextRoute({ opsQuery });

// 3) with the other pipeline routes (near /api/pipeline/flagged-deals, ~line 1882):
app.get ("/api/pipeline/offer-context", authenticate, __offerCtx.get);
app.post("/api/pipeline/offer-context", authenticate, __offerCtx.get);
```
```js
// 4a) MCP tool DEFINITION — add to the tools object (near get_property_context, ~line 382):
  get_offer_context: {
    name: 'get_offer_context',
    description: "Assemble the full context for an inbound offer on one of our listings — deal identity, resolved seller (of-record + contact), listing economics (ask/NOI/cap/lease), linked documents, external correspondents, and a gaps[] list. Call FIRST in the offer-submission flow. Pass a property name/address, e.g. 'DaVita Snellville'.",
    inputSchema: {
      type: 'object',
      properties: { deal: { type: 'string', description: "Property name/address (e.g. 'DaVita Snellville' or '2155 Main Street East')" } },
      required: ['deal']
    }
  },

// 4b) MCP tool HANDLER — add to the handlers object (near the get_property_context handler, ~line 864):
  get_offer_context: async ({ deal }) => withTiming("get_offer_context", async () => {
    if (!OPS_SUPABASE_URL || !OPS_SUPABASE_KEY) return textResult({ ok: false, error: 'ops_not_configured' });
    const r = await opsQuery('POST', 'rpc/lcc_offer_context', { p_deal: String(deal || '') });
    const packet = Array.isArray(r.data) ? r.data[0] : r.data;
    return textResult(packet || { ok: false, error: `rpc_failed_${r.status}` });
  }),
```

### (c) `server.js` (root proxy) — one line, with the other `/api/pipeline/*` proxies (~line 317)
```js
app.all('/api/pipeline/offer-context', (req, res) => { req.query._mcpTarget = '/api/pipeline/offer-context'; aiReadHandler(req, res); });
```

### (d) Verify after deploy
```bash
# root proxy (auth as the skill does): expect the Snellville packet, gaps=["documents_missing"]
curl -s -XPOST "$LCC_HOST/api/pipeline/offer-context" \
  -H "x-lcc-key: $LCC_API_KEY" -H "content-type: application/json" \
  -d '{"deal":"DaVita Snellville"}' | jq '.seller, .economics.ask_price, .gaps'
```
MCP: `get_offer_context({deal:"DaVita Snellville"})` returns the same packet. No DB change — the function is already live.

---

## 2.2 — Folder-feed: index the Team Briggs – Documents tree (close `documents_missing`)

The folder-feed already "turns the Team Briggs Documents tree into an ingestion channel" (`api/_handlers/folder-feed.js`).
The **enrich channel over the PROPERTIES tree is deliberately OFF** until you opt in, so the deep ~27-bucket crawl
can't run away. Turning it on = one engine env + a capped dry-run, then the existing cron descends it.

### (a) Set the engine env (Railway → the engine service)
```
FOLDER_FEED_ENRICH_ROOTS = /sites/TeamBriggs20/Shared Documents/PROPERTIES/<DaVita-or-dialysis bucket>
```
- Scope to **one bucket first** (not the whole PROPERTIES tree) for a capped first pass. Present-but-empty falls
  back to the full `ENRICH_DEFAULT_ROOTS = /sites/TeamBriggs20/Shared Documents/PROPERTIES` — don't do that until
  the scoped pass looks right.
- The SharePoint read-back uses the same connection already authorized for the ingest roots — no new auth.

### (b) Capped dry-run (preview, no writes)
```bash
curl -s "$LCC_HOST/api/folder-feed-tick?folders=/sites/TeamBriggs20/Shared%20Documents/PROPERTIES/<bucket>&mode=enrich&limit_folders=5"
```
Confirm it lists the property folders + the OM/lease/PSA files under `PROPERTIES/<bucket>/<brand>/<City, ST>`.

### (c) Drain (writes → index)
```bash
curl -s -XPOST "$LCC_HOST/api/folder-feed-tick?folders=/sites/TeamBriggs20/Shared%20Documents/PROPERTIES/<bucket>&mode=enrich&limit_folders=5" \
  -H "x-lcc-key: $LCC_API_KEY"
```
Files flow through the existing extract → match → link path into `sharepoint_documents`, linked to the property
entity (`property_entity_id`) by the matcher.

### (d) Ongoing (already scheduled)
The `lcc-folder-feed-crawl` cron descends the frontier via `?source=frontier`; `lcc-folder-feed-crawl-ingest`
drains. Once seeded (b/c), no per-listing action — new docs index automatically.

### (e) Verify
```sql
-- docs now linked to the Snellville deal entity
select count(*), array_agg(distinct doc_type) from public.sharepoint_documents
where property_entity_id = 'c6777c73-9fee-451d-85d9-0e3944383da5';
-- and the gap clears
select public.lcc_offer_context('DaVita Snellville')->'gaps';   -- expect [] (no documents_missing)
```

### Notes / human judgment
- **Doc→property linkage** depends on the matcher resolving the folder path (`PROPERTIES/<bucket>/<brand>/<City, ST>`)
  to the deal entity. If Snellville's docs land unlinked, confirm the property folder exists under PROPERTIES with a
  matching `City, ST`, or link the OM to the deal entity manually (one-time) and let future docs auto-link.
- Start scoped; widen `FOLDER_FEED_ENRICH_ROOTS` to the whole PROPERTIES tree only after the first bucket verifies clean.
- This is the last gap for Snellville: with 1.1 + 2.2 done, `lcc_offer_context` returns a **fully populated** packet
  (seller ✓, economics ✓, documents ✓) and the skill runs end-to-end from any surface.
