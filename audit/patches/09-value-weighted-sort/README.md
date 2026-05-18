# Item #9 Phase A — Value-weighted sort on lists

Bumps `sold_price` / `estimated_value` to the primary sort on the three
highest-traffic CRE lists. Closes audit finding B-3.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/09-value-weighted-sort
node audit/patches/09-value-weighted-sort/apply.mjs --dry
node audit/patches/09-value-weighted-sort/apply.mjs --apply
git add -A
git commit -F audit/patches/09-value-weighted-sort/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/09-value-weighted-sort -m "Merge audit/09-value-weighted-sort: value-weighted sort on lists"
git push origin main
```

No SQL migration needed — only PostgREST `order=` query string changes.

## Smoke test

1. Hard-reload the app.
2. **Government → Sales tab** (or wherever `sales_transactions` surfaces):
   the top row should be the **largest** sale in dollar terms, not the
   most recent. Records with NULL `sold_price` fall to the bottom.
3. **Dialysis → Sales tab**: same — biggest dollar sales first.
4. **Government → portfolio properties**: the top rows should be the
   properties with the largest `estimated_value`. Properties missing
   `estimated_value` fall back through `gross_rent`, then `rba`.

## What didn't change (deliberate)

| List | Why |
|---|---|
| `available_listings` (both DBs) | "Fresh-first" is documented intent. Freshly staged OMs (NULL `asking_price`) need to surface for review. |
| `prospect_leads` | Already sorts by `priority_score.desc` — value-weighted by design. |
| `ownership_history` | Already sorts by `estimated_value.desc`. |
| Event / snapshot tables | Chronological by nature. |

## Phase B (deferred)

- Per-list sort UI: "Sort by Value · Date · Completeness" toggle.
- localStorage sort-preference persistence keyed by table name.
- Value column visible + clickable to switch sort direction.
- Apply the same treatment to `v_sales_comps` and `lease_comps` views.
