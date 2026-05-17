# Item #4 Phase A — propagation gap views + `v_next_best_action` (dia)

**Closes:** B-1 (dia side), B-3 (dia side). Lays foundation for B-13.
**Branch:** `audit/04-next-best-action-phase-a`
**Migration status:** Already applied to dia via Supabase MCP at 2026-05-17.

## What this lands

Four SQL views on dia that unify every known data/research gap into a
single ranked queue:

- `v_gap_chain_drift` — CMS chain vs properties.tenant disagreement
- `v_gap_lease_tenant_drift` — active lease tenant vs properties.tenant
- `v_gap_orphan_sale_owner` — sales missing the owner backlink
- `v_next_best_action` — UNION of those 3 + 3 more sources, ranked

After this lands, you can query the entire dia gap surface in one SELECT.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/04-next-best-action-phase-a

node audit/patches/04-next-best-action-phase-a/apply.mjs --dry
node audit/patches/04-next-best-action-phase-a/apply.mjs --apply

git add -A
git commit -F audit/patches/04-next-best-action-phase-a/COMMIT_MSG.txt

git checkout main
git merge --no-ff audit/04-next-best-action-phase-a -m "Merge audit/04-next-best-action-phase-a: v_next_best_action (dia)"
git push origin main
```

## Explore the new surface

```sql
-- The high-priority hit list
SELECT rank, gap_type, gap_severity, property_id,
       gap_label, suggested_action, gap_value::bigint AS value
FROM public.v_next_best_action
WHERE gap_severity IN ('critical', 'high')
ORDER BY rank
LIMIT 30;

-- All operator-transition candidates (real BD intelligence)
SELECT property_id, gap_label, suggested_action, gap_value::bigint AS value
FROM public.v_next_best_action
WHERE gap_type = 'cms_chain_drift:operator_transition_candidate'
ORDER BY gap_value DESC
LIMIT 20;

-- Rollup
SELECT gap_type, gap_severity, count(*) AS n
FROM public.v_next_best_action
GROUP BY gap_type, gap_severity
ORDER BY n DESC;
```

## Phase B (next session)

- Gov mirror of the 3 propagation views + v_next_best_action.
- LCC Opps view aggregating provenance conflicts + inbox triage + health alerts.
- Backend endpoint `/api/admin?_route=next-best-action` that fans out + merges.
- Home rail UI in `app.js` — replaces the wrong-table Research pulse-card.
