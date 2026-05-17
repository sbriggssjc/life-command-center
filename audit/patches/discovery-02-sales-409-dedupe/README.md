# Discovery patch #2 — sales_transactions 409 dedupe recovery

**Trigger:** Residual 26+ 409s/capture visible after Discovery #1.
**Closes:** Task #23 — sales_transactions partial-unique-index conflicts.
**Branch:** `audit/discovery-02-sales-409-dedupe`

## What this patch does

When the sidebar tries to INSERT a new `sales_transactions` row and the
partial unique index `uq_st_property_date_price` rejects it (because the
upstream fuzzy-lookup missed an exact-match row inserted by another
writer), the new code:

1. Detects the 409 + unique-index name match.
2. Looks up the conflicting row by exact `(property_id, sale_date,
   sold_price)`.
3. PATCHes the existing row through the same `filterByFieldPriority`
   gate as the normal upstream-lookup branch.
4. Continues the same post-write flow (close listings, link brokers,
   push provenance) using the recovered sale_id.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/discovery-02-sales-409-dedupe

node audit/patches/discovery-02-sales-409-dedupe/apply.mjs --dry
node audit/patches/discovery-02-sales-409-dedupe/apply.mjs --apply

git status
git diff --stat
node -c api/_handlers/sidebar-pipeline.js

git add -A
git commit -F audit/patches/discovery-02-sales-409-dedupe/COMMIT_MSG.txt

git checkout main
git merge --no-ff audit/discovery-02-sales-409-dedupe -m "Merge audit/discovery-02-sales-409-dedupe: defensive 409 recovery in upsertDomainSales"
git push origin main
```

## Verify after deploy

```sql
-- 409 count should drop after the next gov sidebar capture
SELECT label, http_status, count(*) AS n
FROM v_ingest_write_failures_recent
WHERE http_status = 409
  AND occurred_at > now() - interval '15 minutes'
GROUP BY label, http_status
ORDER BY n DESC;
```

Look for `[upsertDomainSales:409Recovery]` log lines in Vercel function
logs confirming the recovery path is firing.
