# Ownership & Sales Remediation — 2026-05-27 Session Status (B6)

Picks up after PR #956 (C9 Phase 1 — standard ingest contract foundation, merged + deployed). Focus this round: **B6 — propagate-recompute-tick nightly cron**.

## What the investigation found

The plan: *"Re-runs `propagate_sale_to_property` and `propagate_ownership_to_property` for any property touched in the past 24h. Backstops the AFTER INSERT triggers."*

Reality: both functions are **trigger-only** (`RETURNS trigger`, reference `NEW`) — they can't be called standalone from a cron context. Building B6 needed new standalone helpers.

**Drift was real and significant:**

| Domain | Properties with stale `latest_deed_date` |
|---|---:|
| dia | **1,426** |
| gov | **1,282** |

Properties whose latest sale was AFTER what `properties.latest_deed_date` recorded — meaning the trigger missed (concurrent write, hand-edited row, deferred trigger, etc.). The one-shot first run paid for the cron immediately.

## What landed

### New function: `propagate_sales_recompute(p_lookback_hours int DEFAULT 24)` on both domains

Standalone callable function that does two passes:

1. **Sale propagation drift fix** — for each property, find the canonical max-sale-date `sales_transactions` row (with `transaction_state='live'`, `sale_date IS NOT NULL`). If `properties.latest_deed_date` is older than that, OR the property was touched in the past N hours, recompute `latest_deed_date / latest_sale_price / latest_sale_grantor / latest_deed_grantee / recorded_owner_name` from that row.

2. **Owner-id propagation drift fix (dia only)** — for each property, find the unique open `ownership_history` row (post-C5 Phase 1, multi-open=0 so this is unambiguous). If `properties.recorded_owner_id` differs from that row's `recorded_owner_id`, update it.

Returns a jsonb summary: `{sales_propagation_fixed, ownership_owner_id_fixed, lookback_hours, ran_at}`. Idempotent — only writes when the canonical value actually differs.

Gov skips path 2 because `gov.ownership_history` is point-in-time only (`transfer_date`), no start/end pair, no concept of "the unique open row."

Column-name differences handled in the gov version: `buyer`/`seller` (not `buyer_name`/`seller_name`), no `recorded_owner_name` column.

### Cron scheduled on both domain DBs

`pg_cron` is installed on both dia + gov, so the cron lives where the function does (no LCC orchestration round-trip needed for a pure-SQL recompute):

```sql
cron.schedule('dia-propagate-recompute-tick', '30 3 * * *', $$ SELECT public.propagate_sales_recompute(48) $$);
cron.schedule('gov-propagate-recompute-tick', '30 3 * * *', $$ SELECT public.propagate_sales_recompute(48) $$);
```

Nightly at 03:30 UTC (off-peak), 48-hour lookback for the "touched recently" path so it overlaps any missed previous run.

### One-shot drift healing

Running the function once cleared the entire backlog:

| Path | dia | gov |
|---|---:|---:|
| sales_propagation_fixed | **1,463** | **1,341** |
| ownership_owner_id_fixed | 127 | 0 (N/A) |
| **Total** | **1,590** | **1,341** |

**2,931 properties** had stale `latest_*` columns that are now accurate. Comp views, BD priority queue, and the B8 health tile all immediately benefit.

## Plan status

- ✅ **DONE** (27, ↑1): F1-F4, C1, C2, C3 (N/A), C4, C6, C8, B8, **B6 (this round)**, B1, B2, B4, B5, B7, A1, A2, A3, A4, A5, A6, A7
- ⏳ **PARTIAL** (2): C5 (Phase 1 + Phase 2 prep) + C9 (Phase 1)
- ⬜ **TODO** (4): C7, B3, A8, A9

## Symptom tracking

| User complaint | Status |
|---|---|
| Duplicates for the same sale on the same property | ✅ FIXED + can't recur |
| Missing many elements of a sales transaction | ⏳ MEANINGFUL PROGRESS, visible in B8 tile |
| Ownership history not in unison | ✅ FIXED + auto-close trigger + CHECK + 68% historical overlap reduction |
| RCM/LoopNet 401ing | ⏳ RCM working; LoopNet PA flow pending user build |
| deed_records orphans / synthetic | ✅ FIXED + CHECK guards both |
| (new) `properties.latest_*` drift vs canonical sales/ownership | ✅ **FIXED** (2,931 properties healed; nightly cron prevents future drift) |

## Audit-log inventory

| log_id | run_id | domain | rows |
|---:|---|---|---:|
| 37 | B6_propagate_recompute_2026_05_27_001 | all | 2,931 |

## Files changed

| File | Change |
|---|---|
| `supabase/migrations/dialysis/20260527170000_dia_b6_propagate_recompute.sql` | NEW — dia function + cron |
| `supabase/migrations/government/20260527170000_gov_b6_propagate_recompute.sql` | NEW — gov function + cron |
| `docs/ownership_sales_remediation/2026-05-27_b6_session_status.md` | NEW — this doc |

No JS changes. No new Vercel routes. The propagation is pure SQL on the domain DBs.

## Cron workers active after this round (16 total, ↑2)

Existing 14 plus:
- `dia-propagate-recompute-tick` (dia, 03:30 UTC) — backstops sales/ownership triggers
- `gov-propagate-recompute-tick` (gov, 03:30 UTC) — backstops sales triggers

## Recommended priorities for next session

1. **C9 Phase 2 — first writer migration** — pick deed-parser as proof-of-concept (smallest writer; well-isolated); validates the contract module against a real writer
2. **C5 Phase 2 final** — land EXCLUDE with grandfather-WHERE clause to fully close out C5
3. **A9 — unified_contacts consolidation** (biggest remaining; Decision #1 dependency)
4. **C7 — SOS adapter framework** (lower priority per user pref for free SOS-direct scrapers)
