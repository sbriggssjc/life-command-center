# Canonical Metric Dictionary — LCC unified data flow (draft for Scott's ratification, 2026-06-16)

The single source of truth for every "market" metric. EVERY surface (Today / daily briefing,
domain dashboards, overview stats, priority-queue trigger bands, and the Capital Markets
Excel export) must read these definitions from ONE canonical layer — never re-derive. Grounded
in the live data + Scott's doctrine (2026-06-16): **Northmarq is INCLUDED** (it's real
inventory/activity, identifiable as a sub-cut); curation flags ARE honored (they mark
non-market rows); price-less rows are NEVER counted as transactions.

## Doctrine (the rules every metric obeys)
1. **Include Northmarq.** NM deals/listings count in the totals AND are separately
   identifiable (an `is_northmarq` sub-cut). "NM on-market" = NM-broker listings that are
   **actively marketed** (`is_active` + `is_northmarq`). NM is never excluded from a headline
   number; it's labeled, not hidden.
2. **Honor curation flags.** `exclude_from_market_metrics` / `exclude_from_listing_metrics`
   = "this row is not a clean market record" (verified: ~98% are `transaction_state` in
   `duplicate_superseded` / `ownership_stub` / `needs_review`). These are ALWAYS excluded
   from market metrics. Equivalent: only `transaction_state='live'` counts.
3. **A "sale" requires a real price.** `sold_price > $100,000` (floor excludes
   placeholder/$0/non-arm's-length rows). **Price-less rows are never counted as
   transactions** (this is the CM ~10× count bug).
4. **One window.** "TTM / last 12 months" = trailing 365 days from today, everywhere. The CM
   report keeps calendar-quarter buckets for layout, but its inclusion filters = this
   dictionary and its TTM rollup = the trailing-4-quarters of the same canonical set.
5. **One cap-rate range.** Avg market cap rate uses `sold_cap_rate` (or the derived
   `cap_rate_history` value where available) within **0.01–0.25**, on the canonical sale set.
6. **Live-or-fresh, single source.** All surfaces read ONE canonical view/RPC per domain;
   materialized/snapshot consumers refresh from it on a known cadence. No surface re-derives.

## The metrics

### M1 — On-market (active listings)
- **Definition:** properties currently, actively for sale.
- **Source:** `available_listings`.
- **Inclusion:** `is_active = true` AND `exclude_from_listing_metrics IS NOT TRUE` AND NOT
  overlapping a live sale (no `sales_transactions` row, `transaction_state='live'`,
  `sale_date >= listing_date - 60 days`). **Northmarq listings included** when actively
  marketed (`is_active`).
- **Sub-cuts exposed:** total; `nm_on_market` (= `is_active` + `is_northmarq`); by domain.
- **Canonical today (gov):** **628** (the authoritative `v_available_listings` figure) — NOT
  854 (briefing, which wrongly drops NM and skips the overlap/flag filters) and NOT 868 (raw).
- **dia caveat:** dia `available_listings` lacks `exclude_from_listing_metrics` /
  `is_northmarq` / `transaction_state` (schema drift). Either add those columns to dia for
  parity, or dia on-market = `is_active` + sale-overlap only, documented as a known
  per-domain difference until parity lands.

### M2 — Sold (trailing 12 months): transaction count + volume
- **Definition:** closed, arm's-length market sales in the last 365 days.
- **Source:** `sales_transactions`.
- **Inclusion:** `sale_date >= current_date - 365` AND `sold_price > 100000` AND
  `exclude_from_market_metrics = false` (≡ `transaction_state='live'`). **Northmarq
  included** (sub-cut `nm_count`/`nm_volume`).
- **count** = rows meeting the above. **volume** = `sum(sold_price)` over the same set.
- **Canonical today:** gov **~61 / ~$0.87B**, dia **~161 / ~$0.69B** (the briefing-style
  set, which is the correct curated definition) — NOT 126/1,300 (gov) or 201/253 (dia).
- **Northmarq is counted in the total** per Scott (today 0 gov NM in window; dia NM via
  `is_northmarq`), shown as a labeled sub-cut.

### M3 — Average market cap rate
- **Definition:** avg cap rate of the M2 canonical sale set.
- **Source:** `sold_cap_rate` (or derived `cap_rate_history`, gov) within **0.01–0.25**, over
  the M2 set. One range everywhere (replaces 2–20% / 1–25% / none divergence).

### M4 — Total properties (per domain)
- **Definition:** all property records in the domain. `count(*)` of `properties`. (Already
  consistent across the two consumers — no change; included for completeness.)

## Single-source implementation (what "address at the source" means)
- One canonical per-domain object — **`v_market_metrics_<domain>`** (or an RPC
  `lcc_market_metrics(domain, window_days)`) — encodes M1–M4 ONCE.
- Every consumer reads it: the briefing RPC (`lcc_briefing_market_stats`), the overview MV
  (`mv_gov_overview_stats`), domain dashboards, the Today "Market Intelligence" tile, and the
  Capital Markets aggregator (`capital_markets_agg.py`). A definition change happens in
  exactly one place and propagates to all surfaces + the CM export.
- The CM Excel export then **changes daily with new ingest** (Scott's intent), on the
  canonical definition — feeding the marketing-assembled report + commentary with accurate,
  current, consistent numbers.

## Decisions embedded (ratify or adjust)
- Price floor **$100k** for "sale." (Adjust if you want a different threshold.)
- Window **trailing 365 days** for TTM surfaces. (Calendar-quarter retained only inside the
  CM report layout.)
- Cap-rate band **0.01–0.25**.
- NM **included** in headlines + labeled sub-cut. (Per your answer.)
- Curation flags / non-live `transaction_state` **excluded**. (Verified legitimate.)
