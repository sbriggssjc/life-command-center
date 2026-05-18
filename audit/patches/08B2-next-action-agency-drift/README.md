# Item #8 Phase B-2 — Next-action dispatcher: agency_drift handler

The sticky next-action bar now handles agency_drift gap types inline —
one-click PATCH instead of switching tabs.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/08B2-next-action-agency-drift
node audit/patches/08B2-next-action-agency-drift/apply.mjs --dry
node audit/patches/08B2-next-action-agency-drift/apply.mjs --apply
git add -A
git commit -F audit/patches/08B2-next-action-agency-drift/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/08B2-next-action-agency-drift -m "Merge audit/08B2-next-action-agency-drift: agency_drift handler"
git push origin main
```

No SQL migration. No new endpoint — reuses `/api/admin?_route=resolve-agency-drift` from A-5.

## What changes

| Gap type | Phase A | Phase B-2 |
|---|---|---|
| `agency_drift:agency_disagreement` | "Take action →" → switch to Overview tab | **"Use lease value →"** → confirm → PATCH → done |
| `agency_drift:lease_agency_but_property_agency_null` | "Take action →" → switch to Overview tab | **"Fill from lease →"** → confirm → PATCH → done |

The meta line above the button also updates:
- "$X.XM value · patches properties.agency from active lease" (disagreement)
- "$X.XM value · fills properties.agency from active lease" (null property)

## Smoke test

1. Open any gov property whose top NBA gap is `agency_drift:agency_disagreement` (find via the NBA Home rail).
2. The bar at the bottom shows **"Use lease value →"**.
3. Click → asyncConfirm prompts with the lease's tenant agency.
4. Confirm → toast "Updated agency from lease" → bar disappears.
5. Verify on gov Studio:
   ```sql
   SELECT agency, agency_canonical, agency_full_name, updated_at
     FROM public.properties WHERE property_id = <id>;
   ```
   The three agency fields now reflect the lease tenant; `updated_at` is fresh.

## Per-action dispatcher coverage

After this merge:

| Gap type | Button label | Action |
|---|---|---|
| `missing_recorded_owner` | "Open SoS →" | New tab to SoS portal (B) |
| `llc_research_pending` | "Open SoS →" | New tab to SoS portal (B) |
| **`agency_drift:agency_disagreement`** | **"Use lease value →"** | **PATCH (B-2)** |
| **`agency_drift:lease_agency_but_property_agency_null`** | **"Fill from lease →"** | **PATCH (B-2)** |
| `lease_tenant_drift` | "Take action →" | Switch to Rent Roll (A) — B-3 candidate |
| `orphan_sale_owner` | "Take action →" | Switch to Deal History (A) — B-3 candidate |
| `stale_active_listing` | "Take action →" | Switch to Overview (A) |
| `cms_chain_drift:*` | "Take action →" | Switch to Operations (A) |

## Phase B-3 candidates (deferred)

- **`orphan_sale_owner`** — one-click most-recent backlink. Mirrors
  A-1's logic but per-row (only acts on the most-recent sale per
  property to preserve historical attribution).
- **`lease_tenant_drift`** — one-click back-fill of
  `properties.tenant` from the active lease.
- **`cms_chain_drift:cms_chain_but_property_tenant_null`** — one-click
  "use CMS chain value" (writes `properties.tenant` from CMS).
