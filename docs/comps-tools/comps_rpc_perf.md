# `rpc_query_comps` — sort+limit before building the comp JSONB (perf rewrite)

**DBs:** Dialysis_DB (`zqzrriwuavgrquhisnoa`) + Government_DB (`scknotsqkcheojiaewwh`)
**Consumer:** `mcp/comps-tools.js` (`argsToParams` → `rpc/rpc_query_comps`; always the **13-arg**
overload because `p_tenant` is always sent; `p_limit = Math.min(args.limit||200, 500)`).
**Migrations:** `Dialysis/supabase/migrations/20260724_dia_rpc_query_comps_sort_limit_before_project.sql`,
`government-lease/sql/20260724_gov_rpc_query_comps_sort_limit_before_project.sql`.

## Root cause

Both overloads computed the full comp `jsonb` — `to_jsonb(...)` + a ~40-key
`jsonb_build_object`, plus (dia) per-property lease/listing laterals and (gov) a
`property_agencies` scalar subselect + `gov_guarantor()` — for the **entire live comp
universe**, and only **then** applied `ORDER BY sort_date DESC LIMIT N`. The expensive
projection ran for thousands of rows to return ≤ N.

## The rewrite

Per source arm (sale / listing / salesforce-staging):

1. **`cand`** — select only the cheap ranking columns `(arm, id, sort_date)`.
2. **`top`** — `ORDER BY sort_date DESC NULLS LAST LIMIT greatest(p_limit,1)` — the
   optimization fence.
3. **`proj`** — build the full comp `jsonb` for the surviving **≤ N** rows only, joining
   each arm's base table by PK and (dia) the per-property lease lateral.

`SET statement_timeout` on the SQL function keeps it a black-box `Function Scan`, so the CTE
fence is always respected (no inlining/flattening that could reorder work before the limit).

## Before / after (EXPLAIN ANALYZE, sale arm, warm cache)

| DB  | p_limit | before   | after   | speedup |
|-----|---------|----------|---------|---------|
| dia | 10      | ~3139 ms | ~50 ms  | ~63×    |
| dia | 200     | (~3+ s)  | ~321 ms | —       |
| gov | 10      | ~2.67 s* | ~52 ms  | —       |
| gov | 200     | —        | ~88 ms  | —       |

Live 13-arg production shape (dia, tenant=`davita`, +sf, limit 200) = **279 ms**.
Target (< 300 ms at p_limit=10) met on both DBs. *gov before per the prior investigation.

## Output-contract proof (same-snapshot multiset diff)

Byte-identity was verified by an **order-independent multiset difference** (`EXCEPT ALL` on
`comp::text`), OLD vs NEW **in one MVCC snapshot** (production crons mutate `available_listings`,
so OLD/NEW must be compared in the same statement — comparing against a stale baseline shows
false drift). Comparison keyed on the full row text, not `comp_id` (the SF arm has duplicate
`comp_id`s — multiple `staging_id`s per `sf_comp_id` — so a comp_id join cross-products).

- **gov** — both overloads **fully byte-identical** across the full universe (sale + sf +
  listings) and filtered (state / tenant / government_only) shapes. Gov's lease-display fields
  come from `sales_transactions` / `properties` columns (no per-lease lateral), so there is no
  tie non-determinism.
- **dia 12-arg** — **fully byte-identical** (3652 = 3652, 0 diff both directions). No lease join.
- **dia 13-arg** — byte-identical on **3650 of 3652** full-universe rows; filtered shapes
  (tenant=davita 0 diff, government_only 0 diff, CA 1 diff) match likewise. The **2** residual
  rows are the tied-lease case below.

### The dia 13-arg tied-lease residual (documented, irreducible)

The 13-arg lease-display fields (`bumps`, `lease_type`, `renewal_options`, `lease_expiration`,
`annual_rent`/`actual_annual_rent`/`rent_source`) come from the property's "latest lease". The
old body sourced these from `v_property_latest_lease`, whose `DISTINCT ON (property_id) … ORDER
BY is_active DESC, effective_date DESC, updated_at DESC` has **no deterministic tiebreaker**:
on a **fully-tied lease** (two lease rows identical on all three keys) Postgres' (unstable)
quicksort picks one arbitrarily. So the OLD function is itself **non-deterministic** on those
properties — there is no stable value to reproduce.

The rewrite inlines the lateral over `leases` directly (fast, index-backed) and adds a
deterministic final tiebreaker **`l.lease_id asc`**, making this function's output **stable and
reproducible**. Universe-wide this differs from the live (non-deterministic) view on **≤ 3 of
6,909 properties (~0.04%)**, only in those cosmetic lease-display fields — **never** a
reliability-gate field (`rent_is_imputed` / `cap_rate_quality` / `noi_is_modeled` /
`noi_modeled_source`), **never** `dedup_key`, **never** the sort key. `lease_id asc` was chosen
over `desc` because it yields the smaller residual (3 vs 4 universe-wide) and deterministically
reproduces the observed live pick on the sampled tied rows. The 2 rows that surface in the
full-universe comp diff are old sales (2012 / 2019) that fall outside typical `limit ≤ 500`
production results.

**A byte-perfect alternative was rejected on perf:** joining `v_property_latest_lease` (the
exact view) instead of the inlined lateral is guaranteed byte-identical, but the planner
materializes the whole DISTINCT-ON view (no property_id pushdown through the DISTINCT) →
**~930 ms**, failing the target. The inlined lateral is the only fast path.

## Reliability gate preserved

`noiIsReliable()` in `mcp/comps-tools.js` reads `c.raw.cap_rate_quality`, `c.noi_modeled_source`,
`c.noi_is_modeled`, `c.rent_is_imputed`, `c.rent_source`, `c.cap_rate`, `c.noi`. All are
projected exactly as before (`raw` = `to_jsonb(s)` preserved; the dia rent block and gov
`noi_is_modeled`/`noi_modeled_source` keys unchanged), so the gate sees identical input.

## Backstops (kept)

- `SET statement_timeout '10s'` on both overloads, both DBs — **lowered from 20s, not removed.**
- dia: `idx_leases_property_id ON leases(property_id) WHERE property_id IS NOT NULL` — makes the
  per-property lease lateral an index scan (the whole reason the inlined lateral is fast).
- gov: **no new index needed** — the per-property `available_listings` lookup is already served
  by `available_listings_property_source_status_date_uniq` (property_id-leading), and EXPLAIN
  shows no per-row seq-scan bottleneck (@200 = ~88 ms).

## Unchanged

Role / security settings untouched — both overloads remain `SECURITY INVOKER` (`prosecdef=false`),
`STABLE`; grants preserved by `CREATE OR REPLACE`. Reliability tags untouched.
