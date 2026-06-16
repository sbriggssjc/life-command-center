# Claude Code — R36: one canonical market-metric layer (kill the 61-vs-126-vs-1,300 divergence)

## Why (metric-consistency audit, live 2026-06-16 — see AUDIT_metric_consistency_2026-06-16.md + CANONICAL_METRIC_DICTIONARY_2026-06-16.md)
The same metric is computed by 3+ independent paths with different windows/filters, so the
SAME number reads wildly differently: gov "sold last 12mo" = **61 (briefing RPC) vs 126
(overview MV) vs ~1,300 (CM aggregator)**; gov on-market = **854 vs 628 vs 868**; dia
sold-TTM = **161 vs 201 vs 253**. Root causes: `exclude_from_market_metrics` honored by only
one consumer; the CM aggregator counting ~1,174 price-less rows as "transactions"; price
floor / date window / cap-rate range all inconsistent; three storage modes; dia↔gov schema
drift. Fix = ONE canonical metric layer per domain that every surface reads. **Implement
EXACTLY per `CANONICAL_METRIC_DICTIONARY_2026-06-16.md`** (Scott-ratified definitions:
Northmarq INCLUDED + labeled; curation flags / non-live `transaction_state` EXCLUDED;
`sold_price > $100k`; trailing-365d window; cap band 0.01–0.25; price-less rows never counted).

## Phase 1 — build the canonical source (per domain), verify against the dictionary
- Create one canonical object per domain encoding M1–M4 from the dictionary —
  **`v_market_metrics_gov`** + **`v_market_metrics_dia`** (or a parameterized RPC
  `lcc_market_metrics(domain, window_days default 365)`). Return: `on_market_total`,
  `on_market_nm`, `sold_ttm_count`, `sold_ttm_volume`, `sold_ttm_nm_count`,
  `sold_ttm_nm_volume`, `avg_cap_rate`, `total_properties` — with the EXACT inclusion rules
  in the dictionary (M1 on-market incl. 60-day sale-overlap + `exclude_from_listing_metrics`;
  M2 sold incl. `>$100k` + `transaction_state='live'`/`exclude_from_market_metrics=false`;
  NM counted in totals + exposed as sub-cut).
- **dia schema parity:** dia `available_listings` lacks `exclude_from_listing_metrics` /
  `is_northmarq` / `transaction_state`. Preferred: add those columns to dia (default
  matching current behavior) so M1 is defined identically; if deferred, the dia canonical
  view documents the reduced on-market filter (is_active + sale-overlap only) — do NOT
  silently diverge.
- **Verify Phase 1 BEFORE repointing anything:** the canonical view returns the dictionary's
  canonical numbers (gov on-market ≈ 628, gov sold-TTM ≈ 61/$0.87B, dia sold-TTM ≈
  161/$0.69B). Adjust filters until it matches, then proceed.

## Phase 2 — repoint the INTERNAL consumers to the canon (no published-report risk)
Repoint each to read `v_market_metrics_*` instead of re-deriving; verify each now returns the
SAME number as the canon:
- `lcc_briefing_market_stats` RPC (gov + dia twins) → Today "Market Intelligence" / daily
  briefing email (`briefing-email-handler.js fetchMarketStats`).
- `mv_gov_overview_stats` materialized view (+ dia equivalent) → domain dashboards. Keep it
  materialized (refresh cron) but its sold-TTM/on-market/cap columns now compute from the
  canon's rules (so MV == briefing == Today).
- Any other LCC surface the catalog found re-deriving these (dashboards, overview RPCs).
- **Acceptance:** on one load, Today, the briefing, and the domain dashboard show the SAME
  on-market and sold-TTM for a domain. No internal surface re-derives.

## Phase 3 — repoint the Capital Markets export to the canon (Scott eyeballs before/after)
Scott's doctrine: the CM **Excel export is a living data layer** that should change daily
with new ingest (the published PDF is marketing + his commentary on top). So the export
SHOULD move onto the canon — but it changes figures his commentary references, so produce a
**before/after diff for his review** before it's used for the next report.
- `GovernmentProject/src/capital_markets_agg.py`: apply the dictionary's inclusion filters to
  the sales set BEFORE quarter bucketing — `sold_price > $100k`, `transaction_state='live'` /
  `exclude_from_market_metrics=false`; **stop counting price-less rows** (the ~10× count
  bug); NM included + labeled. Keep calendar-quarter buckets for report layout; TTM rollup =
  trailing-4-quarters of the canonical set. Ideally read the same canonical SQL the views use
  (a shared `v_market_metrics`-style source) so Python and SQL can't drift.
- **Deliverable for Scott:** a before/after table of every CM figure that changes (esp.
  transaction_count dropping from ~1,300 → ~real, volume/cap deltas) so he sees the published
  impact before the next report cycle. Do NOT treat it as silently shippable.

## Guards / house rules
- Implement strictly to the dictionary; if a definition is ambiguous, STOP and ask — don't
  invent a 4th variant. Additive migrations; cache-or-live-safe; ≤12 LCC `api/*.js`.
  `node --check`; suite green. GovernmentProject follows its own git workflow.
- **No silent published-number change:** Phase 3's before/after diff is mandatory output.
- Verify live per phase (numbers match the dictionary; all surfaces agree).

## Bottom line
Build the canon once, point everything at it. After R36, "properties on market" and "sold
last 12 months" read the SAME everywhere — Today, briefing, dashboards, and the CM export —
and the export tracks current data daily on a single agreed definition. One unified,
connected data flow.
