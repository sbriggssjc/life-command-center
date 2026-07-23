# Claude Code Prompt — Make `rpc_query_comps` Sort+Limit BEFORE Building the Comp JSONB (Dialysis_DB + Government_DB)

## Why (root cause, measured live 2026-07-23)
`rpc_query_comps` builds the **full comp `jsonb` for every row in the live-sales universe**
(`jsonb_build_object(...)` with ~40 keys **plus `to_jsonb(s)` of the entire sales row as `'raw'`**),
and only **then** does `ORDER BY sort_date DESC LIMIT p_limit`. So a `limit 10` pull still constructs
jsonb for thousands of rows it immediately discards.

Measured, `p_limit=10`, sale arm:
- **Dialysis:** ~3,007 live sales → full materialization **10.26s** before an index fix, **3.56s** after.
- **Government:** ~4,566 gov live sales → **2.67s** (plus a per-row `property_agencies` SubPlan).

The Supabase **anon** PostgREST role has `statement_timeout=3s` (authenticated=8s). The MCP calls as anon,
so the dialysis RPC returned **HTTP 500** (statement timeout) on every MCP/`synthesize_comps` call while
admin SQL (30s) succeeded. Two stopgaps are already live and must stay until this lands:
1. `CREATE INDEX idx_available_listings_property_id ON available_listings(property_id) WHERE property_id IS NOT NULL`
   (dialysis) — turned a per-row Seq Scan on `available_listings` into an Index Scan (10.3s→3.56s).
2. `ALTER FUNCTION public.rpc_query_comps(... 12 args ...) / (... 13 args w/ p_tenant ...) SET statement_timeout TO '20s'`
   on **both** DBs — function-scoped override so the anon 3s cap doesn't fire.

These unblock today but leave every comps pull at multi-second latency. **This prompt is the real fix:
defer the expensive projection until after sort+limit, so the RPC touches jsonb for only ~N rows.**

## Objective
Rewrite both overloads of `rpc_query_comps` on **both** DBs so that, per source arm, the query first
selects only the **cheap** columns needed to rank (`sort_date` + the row key/id + the discriminator),
`UNION ALL`s the arms, `ORDER BY sort_date DESC NULLS LAST LIMIT greatest(p_limit,1)`, and **only then**
builds the full comp `jsonb` for the surviving ≤N rows. Output contract must be **byte-identical** to today
(same keys, same values, same `dedup_key`, same ordering) — this is purely a plan/latency change.

## Implement (per DB, both the 12-arg and 13-arg overloads)
1. **Candidate CTE (cheap).** For each arm (dia sale / dia listing / SF staging; gov sale / gov listing /
   SF staging), select `arm` (a text discriminator), the primary key (`s.sale_id` / `al.listing_id` /
   `st.staging_id`), and `sort_date`. Keep **all existing WHERE predicates and joins that affect row
   selection or filtering** (state/type/date/sf/tenant filters, the gov `government_type` filter, the
   `p_include_sf` / `p_include_onmkt` gates, the dedup-relevant joins). Do **not** build any jsonb here.
2. **Rank once.** `top AS (SELECT * FROM candidates ORDER BY sort_date DESC NULLS LAST LIMIT greatest(p_limit,1))`.
3. **Project the survivors.** Join `top` back to each arm's tables **by (arm, id)** and build the exact
   same `jsonb_build_object(...) || jsonb_build_object(...)` payload the current function returns for that
   arm — including `to_jsonb(row)` for `'raw'`, the `coalesce(ll.annual_rent, p.anchor_rent, p.rent_imputed)`
   rent tiering, `rent_source`/`rent_is_imputed`, `anchor_tenant`/`tenant_count`/`term_weight_basis`/
   `wavg_*` term fields, `comp_tenant()`/`census_suppressed()`/`dia_normalize_address()` (dia) and the gov
   equivalents. Final `SELECT comp FROM projected ORDER BY sort_date DESC NULLS LAST` (LIMIT already applied).
   - Net effect: `to_jsonb(row)` and the 40-key builder run for **≤N rows**, not the whole universe.
4. **Preserve the contract exactly.** Diff old-vs-new output for several parameter sets (below) and require
   an empty diff. If a clean per-arm rejoin is impractical for an arm, an acceptable equivalent is wrapping
   the current per-arm `SELECT` so its jsonb expression is only evaluated after a `sort_date`-ranked
   `LIMIT` — but verify via `EXPLAIN` that jsonb is **not** computed for discarded rows (no projection
   below the Sort/Limit for the expensive columns).

## Verify (report before/after for each)
- `EXPLAIN (ANALYZE, BUFFERS)` execution time, `p_limit=10` and `p_limit=200`, sale arm, each DB — target
  **< 300 ms** at `p_limit=10` (from 3.56s dia / 2.67s gov).
- **Output-contract diff:** for `('sale',…,false,true,false,10,null::text)`, gov-only
  `('sale',…,true,true,false,25,null::text)`, a `p_tenant` case (e.g. DaVita), and an `p_include_onmkt=true`
  case — assert `array_agg(comp ORDER BY …)` is identical old vs new (build via a temporary renamed copy of
  the old function, compare, then swap).
- Confirm the reliability gate still sees the same fields (`rent_is_imputed`, `cap_rate_quality`,
  `noi_is_modeled`, `noi_modeled_source`) so `noiIsReliable()` in `mcp/comps-tools.js` is unaffected.
- Re-run the real MCP path (`query_comps` verticals dialysis, then gov-only) and confirm **no HTTP 500**,
  `warnings: []`, and the same `excluded_unreliable_noi` behavior.

## After it lands
- Keep the `available_listings(property_id)` index (still correct).
- You may lower the function `statement_timeout` override from `'20s'` to a smaller safety margin (e.g.
  `'10s'`) but **do not remove it** — it stays as a backstop. Note the change in the plan doc.
- Add the same plain `available_listings`/listings `(property_id)` index on **Government_DB** if the gov
  listing arm shows an equivalent per-row Seq Scan (check `EXPLAIN`; add only if missing).

## Deliverable
Idempotent, reversible migrations on both DBs (rename-old → create-new → verify-diff → drop-old), plus a
note in `docs/data-quality/model_forward_rent_noi_cap_plan.md` (or a new `comps_rpc_perf.md`) recording the
before/after `EXPLAIN` timings, the empty output-diff proof, and that the function timeout override + index
remain as backstops.

## Guardrails
- **Zero change** to the comp output contract — same keys, values, dedup_key, and ordering. Prove it with the diff.
- Both overloads, both DBs, same shape.
- Logged, reversible, dry-run/diff first. Don't touch the reliability tags or the RPC's role/security settings.
