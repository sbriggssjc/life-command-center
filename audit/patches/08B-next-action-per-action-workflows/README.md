# Item #8 Phase B — Per-action inline workflows on next-action bar

The "Take action →" button on the sticky next-action bar is now
gap_type-aware. For the two highest-volume owner-research gap types,
clicking opens the state's SoS portal directly instead of switching
tabs.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/08B-next-action-per-action-workflows
node audit/patches/08B-next-action-per-action-workflows/apply.mjs --dry
node audit/patches/08B-next-action-per-action-workflows/apply.mjs --apply
git add -A
git commit -F audit/patches/08B-next-action-per-action-workflows/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/08B-next-action-per-action-workflows -m "Merge audit/08B-next-action-per-action-workflows: per-action workflows"
git push origin main
```

No SQL migration. No Studio step.

## What changes

The sticky bar at the bottom of every property detail panel now:

| Gap type | Button label | Click action |
|---|---|---|
| `missing_recorded_owner` | **"Open SoS →"** | New tab to state SoS portal |
| `llc_research_pending`   | **"Open SoS →"** | New tab to state SoS portal |
| all others               | "Take action →" | Switch to relevant tab (Phase A) |

The meta line above the button also updates: "opens Secretary of
State portal" vs "opens Rent Roll tab" etc.

## Smoke test

1. Open any gov property where the NBA queue's top gap is
   `missing_recorded_owner`.
2. The sticky bar at the bottom shows **"Open SoS →"** (was "Take
   action →" in Phase A).
3. Meta line reads "$X.XM value · opens Secretary of State portal".
4. Click → a new tab opens at the correct state's SoS portal
   (CA / DE / NY / TX / FL / etc. — 26 states mapped, Google
   fallback for the rest). The query is biased with the property
   address as the search context.
5. Now open a property where the top gap is `lease_tenant_drift`
   or `stale_active_listing` → bar still says "Take action →" and
   clicking switches tabs (Phase A behavior unchanged).

## Phase C continuations (deferred)

- `agency_drift:*` — reuse the resolve-agency-drift endpoint for
  one-click PATCH from the bar (no tab switch needed; the agency
  resolution is straightforward).
- `orphan_sale_owner` — one-click most-recent backlink (single-row
  version of A-1's logic).
- `lease_tenant_drift` — one-click back-fill of `properties.tenant`
  from the active lease.
- `cms_chain_drift:*` — one-click "use CMS chain value".

Each of these would extend `_udNextActionClick` with a new branch and
either a fetch() call to an admin endpoint or a domainPatch() helper.
~20-30 lines per gap type.
