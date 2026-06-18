# Claude Code — R44 (micro-fix): refresh active-listing caps when a property's confirmed NOI lands

## Why (inverse-propagation audit, 2026-06-16)
The sale→anchor/NOI propagation is healthy and the cap-rate symmetry is otherwise complete.
One tiny residual: **42 gov active listings sit on a property that now carries a
`confirmed_sale` NOI** — their cap was computed at listing-ingest and isn't refreshed when the
fresher confirmed NOI lands. (Edge case — usually a sale closes the listing — but worth
closing for full symmetry.) NOTE the asymmetry: this applies to **ACTIVE LISTINGS ONLY**, never
to prior sales (a sale's cap is correctly point-in-time and must not be retroactively
recomputed).

## The fix — extend R42 Unit-1 change-detection to `properties.noi`/`noi_source`, listings only
- In the R42 Unit-1 recompute change-detection (`{gov,dia}` nightly recompute pass), add a
  trigger condition: a property whose `noi` / `noi_source` changed in the lookback window →
  recompute that property's **`available_listings` (is_active) cap rates only** via the
  authoritative compute fn (rewriting the derived cap, preserving raw/manual). Do NOT touch
  the property's `sales_transactions` (point-in-time integrity).
- One-time: refresh the current 42 gov active-listing caps on `noi_source='confirmed_sale'`
  properties (idempotent; reversible/snapshot, same pattern as R42). dia: apply the same
  listings-only rule (likely ~0 today, type-ready).

## Guards
Listings-only; never recompute sales on a NOI change; reuse the R42 recompute + range guards;
idempotent; reversible. ≤12 `api/*.js`; suite green. Apply live after a quick dry-run (tiny set).

## Bottom line
Closes the last cap-rate-symmetry residual: a fresh confirmed NOI now also refreshes the
property's ACTIVE listing caps (42 rows), while historical sale caps stay correctly frozen.
