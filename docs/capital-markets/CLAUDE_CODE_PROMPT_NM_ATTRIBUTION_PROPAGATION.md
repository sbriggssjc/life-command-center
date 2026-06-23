# Claude Code prompt — fix Northmarq-brokered attribution on gov sales (SF staging → sales propagation)

> ⚠️ **CORRECTION (2026-06-23, post-resolution) — this prompt's premise was WRONG; do not reuse as-is.**
> It pointed at `sf_comps_staging` as "staged NM comps." Live `source_system` shows that table is
> **1,447 `costar_sidebar` (CoStar market captures) + 187 `salesforce_ascendix`** — NOT Northmarq
> comps. Matching `is_northmarq` off it would have **mass-attributed the whole market to Northmarq**.
> The real NM source is **`sf_internal_comp_export` (127 rows, NM-only object)** with buy/sell side in
> `sf_comp_staging.Direct_Co_Broke__c`. CC correctly caught this and built the fix off the right table
> (see `gov_promote_nm_comps` + cron `gov-nm-comp-promote`, PR #304). **Root-cause lesson: verify a
> table's `source_system`/provenance before asserting what it contains** — the schema alone isn't
> enough. The diagnosis below (NM tags collapse, propagation-not-collection) was correct; only the
> source-table identification was wrong.

> From the June-22 capital-markets chart review (gov comment 7/9, audit
> `CM_EXPORT_CHART_AUDIT_2026-06-22.md` RC10). Scott's own government brokered deals have all but
> vanished from the report since 2023. Grounded live on gov `scknotsqkcheojiaewwh` — this is a
> **propagation gap, not a collection gap**: the SF comps are in staging, they're just never linked.
> Receipts-first; conservative matching (never false-tag a non-NM sale); reversible; gate against the
> numbers below.

## Receipts (live, 2026-06-23)
NM-brokered gov sales tagged on `sales_transactions` (vs total) — collapses while total stays healthy:

| Year | total gov sales | `is_northmarq` | `is_northmarq_source` populated |
|---|---|---|---|
| 2021 | 971 | 17 | 17 |
| 2022 | 928 | 12 | 8 |
| 2023 | 628 | 3 | 2 |
| 2024 | 598 | **1** | **0** |
| 2025 | 1,304 | **2** | **0** |
| 2026 | 465 | **0** | **0** |

But the Salesforce comps ARE in staging and freshly imported — and **none are processed/linked**:

| `sf_comps_staging.sold_date` yr | comps in staging | `linked_sale_id` set | `processed` | last import |
|---|---|---|---|---|
| 2021 | 162 | **0** | **0** | 2026-06-20 |
| 2022 | 179 | **0** | **0** | 2026-06-23 |
| 2023 | 104 | **0** | **0** | 2026-06-19 |
| 2024 | 88 | **0** | **0** | 2026-06-18 |
| 2025 | 128 | **0** | **0** | 2026-06-18 |
| 2026 | 62 | **0** | **0** | 2026-06-18 |

**Root cause:** `is_northmarq` was set on historical sales by a one-time backfill
(`sales_is_northmarq_backfill_20260529`, May 2026) that matched through ~2023 and stopped. The
**ongoing** `sf_comps_staging → sales_transactions` match/promotion step (which should set
`linked_sale_id`, `processed`, and stamp `is_northmarq` / `is_northmarq_source='salesforce_comp'` /
`is_northmarq_buyside`) is **not running** — `processed`/`linked_sale_id` are 0 for ALL years, even the
ones that got tagged. So ~723 staged NM comps (2021–2026), including 278 for 2024–26, sit unprocessed.

## The ask

1. **Find why the staging promotion isn't running.** Locate the code/function/cron that consumes
   `sf_comps_staging` and writes `processed`/`linked_sale_id` + the `is_northmarq*` stamps (Round 74
   "salesforce_authoritative_nm" lineage). Confirm whether it exists and is dormant, was never wired,
   or silently errors. NOTE there are two similarly-named tables (`sf_comps_staging` and
   `sf_comp_staging`) plus `sf_internal_comp_export` — confirm which is canonical before building on it.

2. **Match staged NM comps to gov `sales_transactions`** conservatively — `normalized_address` +
   `sold_date` (± a tolerance) + `sold_price`/`sold_cap_rate` corroboration. On a confident match:
   set `linked_sale_id`, `processed=true`, and on the sale stamp `is_northmarq=true`,
   `is_northmarq_source='salesforce_comp'`, `is_northmarq_buyside` where the comp indicates buy-side.
   **Never tag a sale without a confident SF-comp match** (no blanket year tagging).

3. **NM comps with no matching gov sale** (NM-brokered deals CoStar didn't capture): Salesforce is the
   authoritative source for Northmarq's own deals (Round 74). Decide + implement, GATED: create the
   `sales_transactions` row from the SF comp (tagged `data_source` = SF, `is_northmarq=true`) vs leave
   unlinked with a reason. Report how many fall in this bucket before bulk-creating.

4. **Make it ongoing, not another one-time backfill.** Wire the promotion so newly-imported staged
   comps get matched/linked on a schedule (the staging table is being refreshed through 2026-06-23, so
   the importer works — only the promotion is missing). Idempotent; safe to re-run.

## Gate (verify against live before calling done)
- NM-tagged gov sales for **2024 / 2025 / 2026** rise from 1 / 2 / 0 toward the matchable share of the
  88 / 128 / 62 staged comps; `is_northmarq_source` is populated (no longer 100% null from 2024).
- `sf_comps_staging.processed` / `linked_sale_id` are no longer 0 for matched rows.
- Spot-check 5 newly-tagged 2025 sales against their SF comp (address + price + date) — no false
  positives.
- Re-run the chart's NM series — recent NM volume/count is no longer ~0.
- Reversible (the match writes are auditable like the `sales_is_northmarq_backfill_*` table; keep one).

## Boundaries
LCC-side / gov-DB attribution only; don't alter the SF importer (it works) or the chart code (the
chart is correct once the data is tagged). Conservative matching over coverage — a missed tag is
better than a false NM attribution on someone else's deal. ≤12 api/*.js if any endpoint is touched.
