# QA-06 — Dia NBA query timeout fix (P0)

**Severity: P0.** The Home rail's cross-domain next-best-action fan-out
was timing out on dia. The header showed `⚠ partial · 10 shown · 65
total open` because `/api/admin?_route=next-best-action` returned
`by_domain.dialysis.ok=false, status=500, error="canceling statement
due to statement timeout"` (Postgres 57014). Operator saw gov-only
results.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/qa-06-dia-nba-mv-property-value-signal
node audit/patches/qa-06-dia-nba-mv-property-value-signal/apply.mjs --dry
node audit/patches/qa-06-dia-nba-mv-property-value-signal/apply.mjs --apply
git add -A
git commit -F audit/patches/qa-06-dia-nba-mv-property-value-signal/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/qa-06-dia-nba-mv-property-value-signal -m "Merge audit/qa-06-dia-nba-mv-property-value-signal: dia NBA timeout fix"
git push origin main
```

## What was slow

`v_next_best_action` UNIONs six gap branches and LEFT JOINs each one
to `v_property_value_signal`. `v_property_value_signal` was a regular
VIEW with four correlated subqueries per property
(`sales_transactions`, `available_listings`, `leases` lookups + a
nested `curr_cap` subquery). For 15,219 properties × 6 union branches
that's ~365K subquery executions per request, plus several full Seq
Scans on `properties`.

`EXPLAIN ANALYZE SELECT * FROM v_next_best_action ORDER BY rank
LIMIT 50` showed:

| Node | Time |
|---|---|
| Limit | 75,133 ms |
| Sort (final) | 75,133 ms |
| WindowAgg | 75,127 ms |
| Append (six UNION branches) | 74,828 ms |
| Subquery scan on v (v_property_value_signal) — branch 1 | 8,351 ms |
| Seq Scan on properties (×5 across branches) | 8-10 s each |
| Seq Scan on available_listings looped 13,715 times | 9,700 ms |
| **Total** | **75,141 ms** |

Statement timeout for the `authenticated` role is well below that,
so the request was killed mid-flight.

## What this patch does

Replaces `v_property_value_signal` (a regular VIEW that re-computed
the four correlated subqueries every call) with a materialized
counterpart:

1. Creates `mv_property_value_signal` (matview, same body).
2. Adds `mv_property_value_signal_pkey` (unique index on
   `property_id`) so refresh can run `CONCURRENTLY`.
3. Redefines `v_property_value_signal` via `CREATE OR REPLACE VIEW`
   to be a thin `SELECT property_id, rev_value FROM
   mv_property_value_signal`. The view's OID is preserved, so
   `v_next_best_action` and any other consumers don't need to be
   touched.
4. Schedules `refresh-mv-property-value-signal` cron at `50 6 * * *`
   (between the existing 06:10 and 06:40 refreshes). Refresh uses
   `CONCURRENTLY` so reads aren't blocked.

After the migration applied to live dia:

| Metric | Before | After |
|---|---|---|
| `EXPLAIN ANALYZE` execution time | 75,141 ms | **632 ms** |
| Plan cost estimate | 69,770,697 units | 19,919 units |
| `/api/admin?_route=next-best-action` round-trip | timeout | **141 ms** |
| Home rail header | "10 shown · 65 total open · ⚠ partial" | **"10 shown · 130 total open"** |
| Home rail `by_domain.dialysis.ok` | `false` (57014) | `true` |

## SQL committed for the record

The DDL itself lives at
`supabase/migrations/dialysis/20260518130000_dia_qa06_mv_property_value_signal.sql`
(applied live on 2026-05-18 via Supabase MCP). The file documents the
fix and gives a fresh dia clone the same head state if someone replays
migrations from scratch.

## Caveats

- **Freshness lag**: `rev_value` now changes at most once per day at
  06:50 UTC. Acceptable for a sort key in the NBA queue — the gap
  weights are bands ($1M / $3M / $5M / $10M), not exact dollars.
  If a same-day refresh is ever needed (e.g. immediately after a
  big sales_transactions ingest), `REFRESH MATERIALIZED VIEW
  CONCURRENTLY public.mv_property_value_signal;` works on demand.
- **Storage**: matview is one row per property (15,219 rows × ~30
  bytes = ~450 KB). Negligible.
- **Pattern consistency**: matches the existing `mv_*` +
  `refresh-*` cron pattern used by `mv_clinic_research_priority`,
  `mv_clinic_inventory_diff_summary`, `mv_facility_patient_counts_mom`,
  etc.

## Follow-ups (separate patches)

Still queued from the 2026-05-18 QA pass:
- **P0** `govQuery('property_intel')` 403 — gov has no
  `property_intel` table, only `v_property_intel`.
- **P0** `govQuery('v_ownership_chain')` 400 — gov view has no
  `property_id` column.
- **P1** "Open Activities" stat conflict across Home / Pipeline / Metrics.
- **P1** Sync error count: Pipeline vs Metrics vs Sync Health disagree.
- **P1** Public REITs + same-entity duplicates in `llc_research_queue`.
- **P2** Casing nits ("Dod", "Ave Se", lowercase "townebank"),
  Calendar zero-duration events, Home Inbox cards missing inline
  actions, AI Copilot FAB missing accessible label.
