# Claude Code prompt — gov post-deploy hotfix (4 issues from the live gate + gov DB logs)

> **RE-AUDIT STATUS (2026-06-22, gov DB back online):** gov DB is healthy/recovered. NONE of the DB
> fixes are applied yet (CC was blocked during the outage) — apply now: (1) bounded
> `v_developer_chain_candidate` migration is NOT live (no LATERAL); (4) `bid_ask_spread` is still
> `numeric(6,4)`; (2) lead_source diagnosis was WRONG (see corrected section — do NOT patch the
> propagate functions). cron 143 (LCC Opps) correctly still paused. Issue 3 (bls) is code-fixed,
> ships on the next Python pipeline run.

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

## Issue 2 — prospect_leads insert failing: missing `lead_source` — CORRECTED DIAGNOSIS (re-audit 2026-06-22)
**Receipt:** a burst of `null value in column "lead_source" of relation "prospect_leads"
violates not-null constraint` (~20 in 20s, gov log).
**CORRECTION (verified live, gov DB):** the original guess (`propagate_deed_to_property` /
`propagate_parcel_owner_to_property`) is **WRONG — neither function touches `prospect_leads`**, and
**no function/procedure in ANY schema has an `INSERT INTO prospect_leads`** (checked `pg_proc` across
all schemas). So the inserter is **application code or dynamic SQL**, not a pg function. Do NOT patch
the propagate functions.
**Impact is MINOR, not pipeline-blocking:** leads ARE being created normally — 12,849 total, 933 in
the last 24h, latest 2026-06-22 11:16, sources populated (ownership_change 7,729, gsa_new_award 4,412,
lcc_intake_om 461, cmbs_discovery 204, …). The NULL-`lead_source` failures are a **narrow path** (a
specific app writer / code branch that omits `lead_source`), losing a small number of leads.
- **Re-investigate the real writer:** the failing path is likely an edge branch in the
  `ownership_change` or `gsa_new_award` writer (the two dominant sources) that occasionally inserts
  without `lead_source`, OR a dynamic-SQL insert. Find it (search app code for `prospect_leads`
  inserts that don't include `lead_source` on every branch; check for an EXECUTE/dynamic insert) and
  set the correct source.
- Gate: the constraint violation stops recurring in the gov log; the previously-failing path inserts
  with a correct `lead_source`. (Lower priority than Issues 1/4 — it's narrow.)

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
