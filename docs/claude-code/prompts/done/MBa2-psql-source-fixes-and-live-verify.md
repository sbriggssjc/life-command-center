# MB-a2 — Fix the P-SQL producer's source queries against the live schema, apply MB-a, verify live

**Repo: `life-command-center`.** Correctness fix + live apply + verification. Flags stay OFF until §4 passes.

**Read first:** `api/_handlers/market-brief-psql-tick.js` · `api/query-comps.js` + `mcp/comps-tools.js`
(`runComps` — the shared, de-duplicated, cap-normalized comps engine every surface uses) ·
`supabase/migrations/20260911180000_lcc_mba_market_brief_producers.sql` · `docs/os/PLANNED-BACKLOG.md` §P18 MB1,
MB1c · `docs/architecture/EXEC-BRIEFS-SPEC.md` §9 (addendum 2026-09-11 "MB-a reconcile") · `CLAUDE.md` doctrines.

## Why this, why now

MB-a (PR #2301) guessed several column names from the docs and warned it hadn't checked them live. Cowork checked
them on 2026-09-11, read-only, against Dialysis_DB (`zqzrriwuavgrquhisnoa`):

| Tick source | What the code reads | What's live | Effect if run |
|---|---|---|---|
| Cap-rate band (`sales_transactions`) | `cap_rate, operator_name, address, city, state` | **No `operator_name`, `address`, `city`, `state`.** Raw `cap_rate` is set on only **37** TTM rows; **`cap_rate_final` on 106**, 94 of them not `exclude_from_market_metrics`; **66** TTM rows are excluded; `dedup_group_id` in use | PostgREST 400 → no band. Even with the columns fixed, the raw `cap_rate` band would ignore exclusions, dedup, and normalization → **a band that disagrees with every comps surface** |
| Trades since last run | same table, `address, city, state` | columns absent (live on the property/listing side) | 400 |
| On-market (`v_dia_on_market`) | `cap_rate` | column is **`current_cap_rate`** (also `last_cap_rate`, `operator`) | 400 → no median ask cap |
| CMS operator counts (`medicare_clinics`) | `…&limit=1000` | **6,695** eligible rows | **Silent truncation to ~15%** — operator counts would be wrong and look plausible. The worst of the four, because nothing would flag it |

Also found: the MB-a migration is **not applied** (no `fact_key` column, no flag rows, no cron jobs), and the
0-row `producer_runs` confirms neither tick has run.

## 1. Fix the sources

- **Cap-rate band and per-operator band:** source it from the **shared comps engine** (the same `runComps` path
  `query_comps` uses: dialysis, trailing 12 months, sales only), so the brief's band equals what brokers get from
  every other surface. If calling the engine from the tick isn't practical, reproduce its filters exactly
  (`cap_rate_final`, `exclude_from_market_metrics = false`, dedup by `dedup_group_id`, the engine's quality
  gates) **and add a parity test against the engine's output**. Operator comes from the engine's tenant/operator
  field, not a nonexistent column. Keep the 5-comp small-n floor.
- **Trades:** read from the engine's comp rows, or join `sales_transactions` → properties for address/city/state.
- **On-market:** `current_cap_rate` (document why not `last_cap_rate`).
- **CMS counts:** aggregate in SQL — an RPC/view grouped by `chain_organization` with the dedup filter, or
  PostgREST `count=exact` per operator. **No row-limit-bound client-side counting anywhere in the tick.** Add a
  test that fails if any source query result equals its limit (a truncation tripwire, reusable for later lanes).
- Sweep the RSS tick and the rest of the PSQL tick for the same problems: row limits, assumed columns.

## 2. Apply

Apply `20260911180000_lcc_mba_market_brief_producers.sql` to LCC Opps (plus any migration §1 adds). Verify:
`fact_key` column plus its unique index, both flag rows `off`, both cron jobs present. Check the cron minutes
against live `cron.job` for collisions.

## 3. Guard + ship

Tests: engine-parity (or filter-parity), the truncation tripwire, column contracts (a fixture of live column
lists per source so drift fails CI), small-n suppression, conflict marking. Full suite green. Branch → PR → CI →
merge. `api/` changed → **redeploy BOTH Railway services.**

## 4. Verify live, then flip

GET dry-run each tick: `gaps[]` must be empty, or every entry explained. POST once per tick with the flag forced
on. Report facts written, superseded and conflicted per section, and `v_market_brief_staleness` for dialysis
before and after. Check the band against a `query_comps` call for the same window and state any difference.
Show the top-5 operator clinic counts against a direct SQL count. **Then flip both flags on.**

## Ship + record

Update `PLANNED-BACKLOG.md` §P18 (MB1, MB1c, MB2), `STATUS.md`, `CURRENT-STATE.md` and the spec §9 addendum.
Your reply should include: the fixes made, apply results, the dry-run `gaps[]`, facts per section, the parity
checks, and the staleness numbers before and after.
