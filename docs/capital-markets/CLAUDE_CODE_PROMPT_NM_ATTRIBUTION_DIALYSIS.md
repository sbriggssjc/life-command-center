# Claude Code prompt — apply the NM-attribution fix to DIALYSIS (+ find why its live feed has 0 Internal)

> Mirror of the gov NM-attribution fix (`gov_promote_nm_comps`, live-feed primary, Internal-only,
> match-don't-duplicate). Scott asked to apply it to dialysis and check for NM sales slipping through
> the same crack. Grounded live on dia `zqzrriwuavgrquhisnoa` 2026-06-23 — dia has the same
> architecture and the same stale-source crack, PLUS an upstream gap gov didn't have. Receipts-first;
> conservative; reversible.

## Receipts (live, 2026-06-23)
- dia NM-tagged sales decline like gov: 2021=51, 2022=38, 2023=15, 2024=15, 2025=18, **2026=2**
  (of 95 total) — and `is_northmarq_source` is `salesforce_comp` 115 / `salesforce` 41 / **null 217**.
- dia attribution depends on the **manual `sf_internal_comp_export`** — 280 rows, **frozen at sold_date
  2025-12-19, zero 2026** (same staleness that broke gov).
- **The dia-specific gap:** the live `sf_comp_staging` (`source_system='salesforce'`) carries recent
  comps (2026=9, 2025=2, 2023=4) but **0 are `Comp_Type__c='Internal'`** — they're ALL `External`
  market comps. So dia has **nothing live to attribute** (gov's fix consumed live Internal comps; dia
  has none).
- No fallback signal: **0 dia sales** have a Northmarq broker (`listing_broker`/`procuring_broker
  ilike '%northmarq%'`) but untagged — CoStar doesn't record NM as the dia broker, so dia NM deals are
  only knowable from Salesforce.

## The ask — two parts

### Part A — build the dia pipeline (mirror gov, generalize don't fork)
Create `dia_promote_nm_comps(dry_run, ...)` + a daily cron, **structurally identical to the verified
`gov_promote_nm_comps`** (PR #305 / `claude/affectionate-bardeen-qn1f71`):
- Primary source = live `sf_comp_staging` (`source_system='salesforce'`), `sf_internal_comp_export`
  demoted to historical supplement.
- **Internal-only** (`raw_row->>'Comp_Type__c'='Internal'`); never tag `External`/`Manual`.
- **Match-don't-duplicate** — tag the existing CoStar sale; keep the CoStar recorded price; collapse
  NM-comp stub rows via `exclude_from_market_metrics=true` (the gov pattern). Dedup staging first.
- Create-from-comp only when genuinely absent; guard `$0`/null price.
- Distinct `is_northmarq_source` for the recovered set; reversible via a `dia_nm_comp_promote_log`.
- Carry over gov's hard-won guards: agency/operator-token corroboration (avoid same-city false
  matches), candidate-based dedup across property_ids, the double-count guard.
- **Reconcile the 217 null-source legacy NM tags** opportunistically (attach a source where a comp
  match exists) but DON'T untag them blindly — they're real NM deals from an older backfill.

### Part B — the upstream gap (the real dia blocker): why 0 Internal in the live feed?
Part A future-proofs dia, but with 0 Internal comps in the live feed it recovers nothing today.
Investigate and report (don't guess):
1. **Does the dia Salesforce sync pull Internal comps at all?** Compare the dia vs gov SF comp sync
   config/filter — gov's live feed has Internal comps, dia's has 0. Is the dia sync filtering to
   External, or is the dia gov-comp object simply not tagging dialysis deals `Internal`?
2. **Are there dia NM deals in the other live SF staging** (`sf_deal_staging`, `sf_listing_staging`)
   that never reach `sf_comp_staging` as Internal? Check recency + Comp_Type/stage.
3. Report the count of dia NM deals that exist in Salesforce (any staging) for 2024-2026 vs what's
   tagged — sized like the gov trace. If the answer is "dia NM deals aren't entered as Internal in
   SF," that's a Salesforce data-entry / sync-config finding for Scott, not a pipeline bug — surface
   it clearly with the evidence.

## Gate (verify live)
- `dia_promote_nm_comps` runs idempotently, Internal-only, no duplicates (the gov gate, on dia).
- Part B produces a clear verdict: either dia Internal comps now flow into the live feed and attribute
  (count rises), OR a documented finding that dia NM deals aren't reaching SF as Internal (with the
  per-year SF-vs-tagged numbers), so Scott knows whether the fix is a code change or a data-entry/sync
  change on his side.
- dia manual `sf_internal_comp_export` staleness (frozen 2025-12-19) is documented; the cron no longer
  depends on a manual re-upload once Internal comps flow live.

## Boundaries
Don't fork the gov function gratuitously — generalize/parallel it. Conservative matching over
coverage. Reversible. Don't untag the 217 legacy NM rows. Don't touch the chart code.
