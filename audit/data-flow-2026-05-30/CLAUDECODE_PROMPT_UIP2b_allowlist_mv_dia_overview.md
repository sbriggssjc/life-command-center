# Claude Code — UIP2b: allowlist `mv_dia_overview_stats` (Phase 2 render blocker)

## Why (live verification finding, 2026-06-23)
Phase 2 (UIP2) shipped correctly: the served `dialysis.js` and the **running**
`renderDiaOverview` both contain the new value blocks (Portfolio at a Glance, Lease
Expiration Risk, Operator Breakdown), and the dia MV `mv_dia_overview_stats` is live on the
dia DB (`zqzrriwuavgrquhisnoa`) and reconciles (12,280 active props, $935.7M projected rent,
DaVita $622M / Fresenius $203M, full lease-expiration buckets).

**But the value blocks render the empty skeleton.** Root cause, grounded live: the browser's
`diaQuery('mv_dia_overview_stats')` returns `[]`, so `diaOverviewStats` is the `{_empty}`
sentinel and the blocks fall back to the graceful skeleton. The dia read proxy
(`data-query` Edge Function) gates reads on the `DIA_READ_TABLES` allowlist, and
**`mv_dia_overview_stats` is not in it** (gov's `mv_gov_overview_stats` IS — that's why gov's
Portfolio-at-a-Glance works). Proof: `diaQuery('properties')` → 1000 rows (allowlisted);
`diaQuery('mv_dia_overview_stats')` → 0 rows (not allowlisted). No grant issue — the proxy
uses the service key (gov's MV also has no anon grant and works).

## The fix (one line, two files — the documented allowlist-bump pattern)
Add `mv_dia_overview_stats` to the dia read allowlist in BOTH places (they must mirror, per
the CLAUDE.md note at `api/_shared/allowlist.js`):

1. **`supabase/functions/data-query/index.ts`** — `DIA_READ_TABLES` set (~line 117). Add
   `"mv_dia_overview_stats",` with a short comment (UIP2b: dia Overview value dashboard MV,
   mirrors gov's `mv_gov_overview_stats`).
2. **`api/_shared/allowlist.js`** — `DIA_READ_TABLES` set (~line 129), same entry + comment.

## Deploy
- The Edge Function must be **redeployed to the dia project** (`zqzrriwuavgrquhisnoa`) for the
  allowlist change to take effect — Claude/Cowork will handle the Supabase edge redeploy via
  MCP from the merged repo source (same pattern as every prior `data-query` allowlist bump).
  The `api/_shared/allowlist.js` mirror ships on the Railway redeploy.

## Boundaries / verify
- No api/*.js count change (`ls api/*.js | wc -l` = 12 — allowlist.js is `_shared`, not a route).
- No migration. No grant. Reversible (remove the one line).
- After the edge redeploy: `diaQuery('mv_dia_overview_stats','select=*')` returns 1 row in the
  browser; the dia Overview renders Portfolio at a Glance → Lease Expiration Risk → Market
  Activity → Pipeline → Operator Breakdown → Data Health (data-quality at the bottom); the
  value numbers reconcile to the MV ($935.7M projected rent, 12,280 active props, DaVita/
  Fresenius operator breakdown).

## Bottom line
Phase 2's code + data are correct and live; the dia value dashboard is one allowlist entry away
from rendering. Add `mv_dia_overview_stats` to `DIA_READ_TABLES` in the edge function + its
`allowlist.js` mirror, redeploy the dia `data-query` Edge Function, and the dia Overview lights
up value-first to match gov.
