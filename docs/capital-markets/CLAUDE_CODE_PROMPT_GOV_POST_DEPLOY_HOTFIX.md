# Claude Code prompt — gov post-deploy hotfix (4 issues from the live gate + gov DB logs)

> Surfaced 2026-06-22 while gating the UW#7b/UW#4c redeploy. The gov DB is HEALTHY (crons +
> checkpoints normal), but `execute_sql` queries were timing out = **connection-pooler saturation**,
> traced to the new gov developer-chain endpoint running long (held connections to statement-timeout)
> plus normal cron load. The gov postgres logs also surfaced two real pipeline bugs + one broken
> query. Receipts below. Fix in priority order; #1 is both a feature bug AND the load source.

## Issue 1 (PRIORITY) — gov developer-chain resolver: slow query → statement timeout → 500 + connection pressure
**Receipt:** `GET /api/developer-chain-resolve-tick?domain=gov` returns **500** (was 401 pre-fix, so
the UW#7b auth fix worked); `domain=dia` returns 200 (deferred no-op). gov runs LONG before failing
(a `canceling statement due to statement timeout` in the gov log), and repeated hits saturated the
connection pooler.
- **Bound + optimize the gov resolution query.** It likely walks all ~764 `trace_ownership_to_developer`
  tasks × the `ownership_history` chain unbounded. The **dry-run (GET) must be cheap** (it only needs
  to classify, not heavy-join the whole book) — page/limit it, or back it with the already-fast
  `v_developer_chain_candidate` view + a bounded LIMIT, and add appropriate indexes. The POST drain
  must be capped per tick (it likely already is — confirm) and never hold a connection to the
  statement timeout.
- **Pause its cron** (the new developer-chain-resolve cron / `lcc-r6-chain*`) until the query is
  bounded, so it stops adding connection pressure. Re-enable after the fix.
- Gate: `GET …?domain=gov` returns 200 in < ~2s with the resolvable set; no statement-timeout in the
  gov log; pooler stable.

## Issue 2 — prospect_leads insert failing: missing `lead_source`
**Receipt:** a repeating burst of `null value in column "lead_source" of relation "prospect_leads"
violates not-null constraint` (~20 in 20s, gov log). A writer inserts `prospect_leads` WITHOUT the
NOT-NULL `lead_source` → **every insert fails → prospects not created.**
- Find the writer (grep `prospect_leads` INSERT — likely a deed→prospect / sales→prospect / ownership-
  change flow or a cron) and **supply a real `lead_source`** (e.g. `'ownership_change'` / `'deed'` /
  `'sales_event'` per the originating signal). Don't just default-fill a placeholder — set the
  correct source so the prospect provenance is honest.
- Gate: the constraint violation stops recurring in the gov log; the prospects that were failing now
  insert with a correct `lead_source`.

## Issue 3 — broken cron query: `bls_employment_data.area does not exist`
**Receipt:** repeating `column bls_employment_data.area does not exist` (gov log). A query/cron
references a renamed/dropped column.
- Fix the query to the correct column/table (check the live `bls_employment_data` schema) or retire
  the cron if obsolete. Gate: the error stops recurring.

## Issue 4 (minor) — `numeric field overflow` on sales_transactions insert
**Receipt:** occasional `numeric field overflow` (gov log) on a sales insert — a value exceeds its
column precision. Identify the field + either widen the column or clamp/validate the writer. Low
frequency; lowest priority.

## DO NOT "fix" (these are constraints WORKING — expected, not bugs)
The gov log also shows `duplicate key … ux_sales_transactions_dedup_live` / `uq_st_property_date_price`
and `chk_sold_cap_rate_range` violations — these are the **dedup + cap-rate-range constraints
correctly rejecting** duplicate / out-of-band sales at write time (the clean comp set I audited).
Leave them; they're the guardrails doing their job. (If the volume is noisy, the WRITER should
pre-check before insert to avoid the failed-insert log spam — optional, not a correctness fix.)

## Gate
- gov `developer-chain-resolve-tick?domain=gov` returns 200 quickly; its cron paused until bounded.
- `prospect_leads` lead_source violations + `bls_employment_data.area` errors stop recurring in the
  gov log. Connection pooler stable (direct `SELECT 1` responsive). dia/LCC untouched.
