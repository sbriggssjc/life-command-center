# Item #8 Phase B-3 — Next-action dispatcher: orphan_sale_owner

Single-row version of the A-1 bulk backfill. The sticky next-action bar
now handles orphan_sale_owner inline — one-click backlink of the most-
recent sale to the property's current owner.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/08B3-next-action-orphan-sale
node audit/patches/08B3-next-action-orphan-sale/apply.mjs --dry
node audit/patches/08B3-next-action-orphan-sale/apply.mjs --apply
git add -A
git commit -F audit/patches/08B3-next-action-orphan-sale/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/08B3-next-action-orphan-sale -m "Merge audit/08B3-next-action-orphan-sale: orphan_sale_owner handler"
git push origin main
```

No SQL migration. New endpoint runs against existing tables on both DBs.

## What changes

When a property's top NBA gap is `orphan_sale_owner`, the bar at the
bottom of the detail panel shows:

- Button: **"Backlink sale →"** (was "Take action →")
- Meta line: "$X.XM value · attributes sale to property's current owner"

Click → asyncConfirm explains the safety check → POSTs to the new
endpoint → toast → bar disappears.

## Safety guarantee

Mirrors A-1: the endpoint verifies that the sale_id passed in is the
MOST-RECENT sale for the property before PATCHing. Earlier sales had
different buyers (the property has changed hands since) — auto-
attributing them to today's owner would corrupt history.

If the sale isn't the most-recent, the endpoint returns 409 with the
actual most-recent sale_id. The UI surfaces this as a warn toast:
"Earlier sale — needs ownership_history resolution; most-recent
sale_id: X."

If the property has no `recorded_owner_id` yet, the endpoint also
returns 409 with a friendly error → toast: "Property has no
recorded_owner yet — resolve missing_recorded_owner first."

## Smoke test

1. Open any property whose top NBA gap is `orphan_sale_owner`
   (find one via the NBA Home rail — there are 1,029 on gov and 31
   on dia after A-1's bulk backfill).
2. The bar shows **"Backlink sale →"**.
3. Click → confirm dialog → confirm.
4. Toast: "Sale backlinked to owner".
5. Verify in Studio:
   - The sale row in `sales_transactions` now has `recorded_owner_id`
     matching the property's `recorded_owner_id`.
   - The NBA queue count for `orphan_sale_owner` dropped by 1.

## Per-action dispatcher coverage

| Gap type | Button | Action |
|---|---|---|
| missing_recorded_owner | "Open SoS →" | SoS portal (B) |
| llc_research_pending | "Open SoS →" | SoS portal (B) |
| agency_drift:agency_disagreement | "Use lease value →" | PATCH (B-2) |
| agency_drift:lease_agency_but_property_agency_null | "Fill from lease →" | PATCH (B-2) |
| **orphan_sale_owner** | **"Backlink sale →"** | **PATCH (B-3)** |
| lease_tenant_drift | "Take action →" | Tab switch — B-4 candidate |
| stale_active_listing | "Take action →" | Tab switch |
| cms_chain_drift:* | "Take action →" | Tab switch — B-4 candidate |
