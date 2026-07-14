# Claude Code (life-command-center) — REAL root cause: /api/dia-query allowlist 403s the two new views

## Why (proven live via browser network inspection, 2026-07-13)

Two rounds of client-render fixes didn't move On Market (0) or Lease Backfill
(1,000) because **the code was already correct — the block is server-side.** The
browser's data fetches for these two views return **HTTP 403** from the query
proxy:

```
GET /api/dia-query?table=v_dia_on_market&select=*&limit=1000            → 403
GET /api/dia-query?table=v_clinic_lease_backfill_summary&select=*        → 403
```

Confirmed in the live client: `diaData.onMarketRows` = `[]` (empty — the 403 fetch
yields nothing → On Market shows 0) and `diaData.leaseBackfillCount` = `null` (the
403 fetch never populates it → the tile falls back to `leaseBackfillRows.length` =
the capped 1,000).

**Root cause:** `/api/dia-query` has a **table/view allowlist** (a security
control — it only proxies approved tables to the dia Supabase). The views that
render correctly on the Overview (`v_ownership_coverage`,
`v_llc_research_queue_health`, `v_listings_needing_manual_confirmation`,
`research_queue_outcomes`, `mv_dia_overview_stats`, etc.) ARE on the allowlist.
The two NEW canonical views — `v_dia_on_market` and
`v_clinic_lease_backfill_summary` — were created but **never added to the
allowlist**, so every browser read 403s. DB-level SELECT grants to anon/
authenticated are fine (Claude Code verified those) — the allowlist is a separate,
earlier gate at the API proxy.

## The fix (add the views to the query-proxy allowlist)

1. **Find the `/api/dia-query` allowlist** — the set/array of permitted table/view
   names in the dia-query handler (likely `api/*.js` handling `?table=` — grep for
   `dia-query`, `ALLOWED_TABLES`, `allowlist`, or where the incoming `table` param
   is validated before proxying to the dia Supabase REST/`data-query` edge). Note
   CLAUDE.md: the `data-query` edge function is deployed on the Dialysis_DB project
   and `api/admin.js DATA_QUERY_EDGE_URL` hard-codes that ref — if the allowlist
   lives in the edge function, bump it AND deploy to that project; if it lives in
   the api route, ship on the Railway redeploy.
2. **Add** `v_dia_on_market` and `v_clinic_lease_backfill_summary` to the dia
   allowlist.
3. **Gov parity — check `/api/gov-query` (or the gov equivalent) for
   `v_gov_on_market`.** The gov Overview On Market intersects `govData.listings ∩
   onMarketIds`, where `onMarketIds` comes from `v_gov_on_market`. If
   `v_gov_on_market` 403s at the gov proxy, gov On Market is ALSO 0/wrong (its
   `onMarketIds` would be empty). Add `v_gov_on_market` to the gov allowlist too.
4. **Sweep for any other new canonical view added in the recent rounds that a tile
   reads through the proxy** (e.g. anything from the canonical-source / consolidation
   rounds) so there are no other silent 403s. A quick audit: for each view a tile
   reads, confirm it's on the proxy allowlist.

## Boundaries / verify

- life-command-center (the query-proxy allowlist — api route and/or the
  `data-query` edge function on Dialysis_DB per CLAUDE.md); additive (allowlist
  entries only); no DB change (grants already exist). Follow the deploy-target
  note above (edge vs Railway).
- **Verify LIVE (browser, the acceptance bar):** after the allowlist change,
  `GET /api/dia-query?table=v_dia_on_market` returns **200** with rows (not 403);
  the dia Overview On Market shows **ACTIVE LISTINGS 184**, Lease Backfill shows
  **3,039** (Research Pipeline) and the real backfill count (Database Health);
  gov Overview On Market shows **278**. Confirm with a network check that the two
  (three incl. gov) requests are 200, and eyeball the tiles.
- This is the missing piece behind the whole "On Market / Lease Backfill still
  wrong" saga — the client + views + grants were all correct; only the proxy
  allowlist was blocking. Once allowlisted, no code change to the tiles is needed
  (they already read the right views).

## Documentation

Update CLAUDE.md: note that `/api/dia-query` (and gov) enforces a table/view
allowlist — **any new view a client tile reads through the proxy must be added to
the allowlist**, or the browser gets a 403 and the tile silently shows empty/0.
Add `v_dia_on_market`, `v_clinic_lease_backfill_summary`, `v_gov_on_market`.

## Bottom line

The On Market (0) and Lease Backfill (1,000) tiles were never a client-render or
stale-build problem — the query proxy 403s `v_dia_on_market` and
`v_clinic_lease_backfill_summary` because they're not on its allowlist. Add them
(and `v_gov_on_market` for gov), and the already-correct tiles will show
184 / 3,039 / 278. Then confirm 200s + the numbers in the live browser.
