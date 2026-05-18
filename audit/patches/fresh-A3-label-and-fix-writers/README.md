# Fresh audit A-3 — Label + fix unlabeled writers

Three root-cause fixes that resolve **426 daily silent 4xx failures**
across `sf_comps_staging`, `leases`, and `rpc/lcc_record_listing_check`.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/fresh-A3-label-and-fix-writers
node audit/patches/fresh-A3-label-and-fix-writers/apply.mjs --dry
node audit/patches/fresh-A3-label-and-fix-writers/apply.mjs --apply
git add -A
git commit -F audit/patches/fresh-A3-label-and-fix-writers/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/fresh-A3-label-and-fix-writers -m "Merge audit/fresh-A3-label-and-fix-writers: label + fix writers"
git push origin main
```

Both SQL migrations (lvh CHECK on dia + gov) already applied via MCP.

## What's in the patch

| Fix | Volume | Root cause |
|---|---:|---|
| sf_comps_staging column map rewrite | 178/24h | Writer sent columns that don't exist in the table. Real schema: `street/sold_price/sold_date/building_sf/...`. Buyer + seller names now stash in `raw_row` jsonb. |
| gov leases dateless-active skip | 98/24h | `gov_reject_dateless_active_lease` trigger correctly rejects active leases with both dates NULL. Writer now short-circuits with a log message before the POST. |
| listing_verification_history CHECK expansion | 150/24h | The auto-scrape path writes `check_result='inferred_active'` when the timer expires without sale evidence. CHECK now allows it (in addition to `still_available/price_changed/off_market/sold/unreachable/manual_review_needed`). |

Plus 4 new writer labels for telemetry hygiene: `autoStageGovComp`,
`upsertGovernmentLeases:insert`, `autoScrapeListings:recordCheck`,
`availabilityPromotionSweep:recordCheck`, `entitiesHandler:recordListingCheck`.

## Smoke test (a few hours after Railway redeploys)

```sql
-- On LCC Opps:
SELECT path, http_status, count(*)
  FROM public.ingest_write_failures
 WHERE occurred_at > now() - interval '1 hour'
   AND label IS NULL
 GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 10;
```

Expected after this and the A-2 / A-4 patches deploy: the
`sf_comps_staging`, `leases`, `rpc/lcc_record_listing_check`,
`sales_transactions`, and `loans` rows all drop out of the
`label IS NULL` bucket. The total 24h volume of unlabeled 4xx
should fall from 579 to <30.

## Fresh-audit punch list after this patch

- A-1 ✅ orphan sale backfill (1,596 NBA gaps closed)
- A-2 ✅ sales POST labeled
- **A-3 ✅** label + fix unlabeled writers (426/24h closed)
- A-4 ✅ loans status normalized + CHECK loosened
- A-5 📋 agency-drift review UI (last one)
