# T4c RECOVERY — on-market-date backfill from Salesforce Comp__c (2026-06-24)

Recovery step after T4c Item 1 (PR #1327): fill the **held** `on_market_date`
rows (`on_market_date_source='unestablished'`) on dia + gov `available_listings`
with the real `Comp__c.On_Market_Date__c`, keyed by the intake
`seed_data.sf_entity_id`.

## The chain

```
dia/gov available_listings (held: on_market_date_source='unestablished')
  ^ listing_id
  |  extraction_result.promotion_listing_id   (+ match_domain dialysis|government)
staged_intake_items (LCC Opps)
  |  seed_data.sf_entity_id  = Comp__c Id (18-char, prefix a1Y)
  v
Comp__c.On_Market_Date__c   (top-level in sf_sync_log.payload, then RETAINED in
                             lcc_sf_comp_on_market — survives the 30d prune)
```

## What shipped (live + committed)

| DB | Artifact | Purpose |
|----|----------|---------|
| LCC Opps | `lcc_sf_comp_on_market` (table) | Durable Comp__c→OMD map. Survives the `sf-sync-log-prune` 30d window. |
| LCC Opps | `lcc_harvest_sf_comp_on_market()` + cron `lcc-sf-comp-omd-harvest` (`7 * * * *`) | Hourly harvest of comp OMD + CreatedDate from `sf_sync_log` (prefix `a1Y`). Prune-proof: a fresh full crawl is age-0, harvested within the hour, weeks before the prune. |
| LCC Opps | `v_lcc_on_market_backfill_map` (view) | Per held-linked listing → recoverable OMD (high) / CreatedDate (low fallback). |
| dia + gov | `lcc_on_market_backfill_log` (table) | Reversibility/audit ledger (prior provenance per backfilled listing). |
| dia + gov | `lcc_apply_on_market_backfill(p_rows jsonb, p_dry_run, p_batch_tag)` | Fill-**held-only** backfill. Dry-run by default. Idempotent + re-runnable. |

Backfilled rows get `on_market_date_source='sf_on_market_date'`,
`on_market_date_confidence='high'` (or `sf_created_date`/`low` for the
CreatedDate fallback). **`listing_date` is never touched** — only the
`on_market_date` provenance columns.

## Results (live, 2026-06-24)

| Domain | Held before | Backfilled now | Held after | Held & SF-linked still held (→ full pull) | Held & NOT SF-linked (other-source gap) |
|--------|------------:|---------------:|-----------:|------------------------------------------:|----------------------------------------:|
| dia    | 1686 | **13** | 1673 | 324 | 1349 |
| gov    | 915  | **55** | 860  | 327 | 533  |

- The 73 recoverable listings (15 dia + 58 gov) intersect the **453 retained
  comps with OMD**; 68 were held and were filled, 5 were `unestablished_historical`
  (intended pre-surge history) and were **left untouched** (see below).
- Recovered dates span **2017–2026** (only 5 of 68 are June-2026) — genuinely
  de-clustered, confirming the artifact listing_date was the wrong (ingest-clock)
  date for 12 of the 13 dia rows.
- `synthetic_from_sale`, `master_curated`, `unestablished_historical` counts
  **unchanged** on both DBs.

## Why only 68 now — and the required full pull (Scott)

`sf_sync_log` retains only **535 distinct comps (453 with OMD)** — the prune
(`sf-sync-log-prune`, 30d) removed the rest. Of the 941 held-linked comps
(460 dia + 481 gov), only ~73 survived in the log. The other **~651 held-linked
comps (324 dia + 327 gov) were pruned** and are NOT recoverable from any LCC
table.

The Salesforce OAuth lives in the **Power Automate "SF → LCC: Object Sync"
flow**, not in any Supabase function reachable from the dev environment
(`intake-salesforce` is a *receiver* — it only ingests what PA posts). So the
**full Comp__c pull must be triggered by Scott**:

1. Run a **full** PA "SF → LCC: Object Sync" crawl for **Comp__c** (reset the
   watermark so it re-fetches every comp, not just the active/changed set). The
   crawler already selects `On_Market_Date__c` (it rides the raw payload).
2. The hourly `lcc-sf-comp-omd-harvest` cron captures every comp into
   `lcc_sf_comp_on_market` (or run `SELECT public.lcc_harvest_sf_comp_on_market();`
   on LCC Opps to harvest immediately).
3. Re-run the backfill (below). With SF's real ~97% OMD coverage this resolves
   the ~324 dia + ~327 gov held-linked listings.

> Optional hardening: extend `intake-salesforce/index.ts` to upsert
> `lcc_sf_comp_on_market` on every comp `handleObjects` batch. Not done here —
> the hourly harvest off `sf_sync_log` is lower-risk (never touches the hot
> ingest path) and sufficient given the 30d prune headroom.

## Re-run the backfill (after a full pull, or any time)

Dry-run, then apply, per domain. Build the payload on **LCC Opps** from the
recovery-map view, then call the **domain** function with it:

```sql
-- 1) On LCC Opps — get the payload for one domain ('dialysis' or 'government'):
SELECT jsonb_agg(jsonb_build_object(
         'listing_id', listing_id,
         'on_market_date', COALESCE(on_market_date, created_date_fallback),
         'source',     CASE WHEN on_market_date IS NOT NULL THEN 'sf_on_market_date' ELSE 'sf_created_date' END,
         'confidence', CASE WHEN on_market_date IS NOT NULL THEN 'high' ELSE 'low' END,
         'sf_comp_id', sf_comp_id))
       FILTER (WHERE COALESCE(on_market_date, created_date_fallback) IS NOT NULL)
FROM public.v_lcc_on_market_backfill_map
WHERE match_domain = 'dialysis';   -- or 'government'

-- 2) On the matching domain DB — dry-run, then real:
SELECT * FROM public.lcc_apply_on_market_backfill('<payload>'::jsonb, true);   -- dry-run
SELECT * FROM public.lcc_apply_on_market_backfill('<payload>'::jsonb, false);  -- apply
```

The function is **fill-held-only** (`on_market_date_source='unestablished'`),
so re-runs never re-touch an already-backfilled or curated/synthetic row.

## Reversibility

Every write is logged with its prior provenance. To revert a batch on a domain DB:

```sql
UPDATE public.available_listings a
SET on_market_date            = l.prior_on_market_date,
    on_market_date_source     = l.prior_source,
    on_market_date_confidence = l.prior_confidence
FROM public.lcc_on_market_backfill_log l
WHERE a.listing_id::text = l.listing_id
  AND l.batch_tag = 't4c_recovery'
  AND a.on_market_date_source = 'sf_on_market_date';
```

Or drop the whole recovery: `DROP TABLE lcc_sf_comp_on_market` +
`lcc_apply_on_market_backfill` / `lcc_on_market_backfill_log` and unschedule
`lcc-sf-comp-omd-harvest`.

## Held but NOT SF-comp-linked (the other-source gap)

- **dia 1349 / gov 533** held listings do not trace to any SF-comp intake (no
  `seed_data.sf_entity_id` → `promotion_listing_id` link). The full Comp__c pull
  will NOT date these — they need the email / CoStar (platform) ladder, or are
  genuinely dateless and stay held. Reported, not fabricated.
- A safe widening of the gov linkage (e.g. `sf_entity_id` ↔ a gov
  `available_listings` column, or exact comp Name/City) was evaluated and is
  **not** pursued: no deterministic non-fuzzy key exists, and fuzzy
  address/tenant matching risks dating a re-listing with a stale vintage.

## NOT in this step (next gate)

Item 3 — repointing the dia+gov added/DOM/ramp **timing views** at
`on_market_date`. Until then the recovered dates are **stored but the charts
still read `listing_date`**. The repoint must preserve the sold−196d synthetic
anchor and hold only the artifact-dated ACTIVE rows, to the
`dropped_pub = 0` (published history ≤ 2026-03-31 byte-identical) gate. Note:
the 5 `unestablished_historical` rows that have a recoverable SF date were left
at their historical artifact date *precisely* to keep published months
byte-identical; upgrading them is a decision for that gate, not this one.
