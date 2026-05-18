# Item #8 Phase B-4 — Next-action dispatcher: tenant_drift handlers

Two more one-click PATCH branches on the sticky next-action bar
(dia-only). Closes the per-action workflow loop on every gap type
that has a sensible automated answer.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/08B4-next-action-tenant-drift
node audit/patches/08B4-next-action-tenant-drift/apply.mjs --dry
node audit/patches/08B4-next-action-tenant-drift/apply.mjs --apply
git add -A
git commit -F audit/patches/08B4-next-action-tenant-drift/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/08B4-next-action-tenant-drift -m "Merge audit/08B4-next-action-tenant-drift: tenant_drift handlers"
git push origin main
```

No SQL migration.

## What changes

| Gap type | Volume | Button | Action on click |
|---|---:|---|---|
| `lease_tenant_drift` | 3,544 | **"Use lease tenant →"** | PATCH `dia.properties.tenant` from `v_gap_lease_tenant_drift.lease_tenant` |
| `cms_chain_drift:cms_chain_but_property_tenant_null` | 40 | **"Use CMS chain →"** | PATCH `dia.properties.tenant` from `v_gap_chain_drift.cms_chain` |
| `cms_chain_drift:operator_transition_candidate` | 2,522 | "Take action →" | Tab-switch — judgment call, stays manual |

## Smoke test

1. Open any dia property whose top NBA gap is `lease_tenant_drift`
   (3,544 to choose from — find one via the NBA Home rail).
2. The bar at the bottom shows **"Use lease tenant →"**.
3. Click → confirm dialog shows the proposed tenant value.
4. Confirm → toast "Updated tenant from lease" → bar disappears.
5. Verify in Studio (dia):
   - `properties.tenant` is now the lease's tenant
   - `properties.updated_at` is fresh
6. Repeat on a property with `cms_chain_drift:cms_chain_but_property_tenant_null`
   (only 40 of these, harder to find — query
   `SELECT property_id FROM v_gap_chain_drift WHERE drift_kind = 'cms_chain_but_property_tenant_null' LIMIT 1`).

## Per-action dispatcher coverage

| Gap type | Button | Action |
|---|---|---|
| missing_recorded_owner | "Open SoS →" | SoS portal (B) |
| llc_research_pending | "Open SoS →" | SoS portal (B) |
| agency_drift:agency_disagreement | "Use lease value →" | PATCH (B-2) |
| agency_drift:lease_agency_but_property_agency_null | "Fill from lease →" | PATCH (B-2) |
| orphan_sale_owner | "Backlink sale →" | PATCH (B-3) |
| **lease_tenant_drift** | **"Use lease tenant →"** | **PATCH (B-4)** |
| **cms_chain_drift:cms_chain_but_property_tenant_null** | **"Use CMS chain →"** | **PATCH (B-4)** |
| cms_chain_drift:operator_transition_candidate | "Take action →" | Tab switch (intentional) |
| stale_active_listing | "Take action →" | Tab switch |

**Auto-resolvable gap coverage:**
- **dia:** 5 of 6 gap types (only `operator_transition_candidate` stays manual).
- **gov:** 5 of 5 gap types (only `stale_active_listing` stays manual — the "re-verify listing status" action is judgment-heavy).
