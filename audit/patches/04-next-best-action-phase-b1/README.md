# Item #4 Phase B-1 — gov mirror of `v_next_best_action`

**Branch:** `audit/04-next-best-action-phase-b1`
**Migration status:** Already applied to gov via Supabase MCP at 2026-05-17.

## What this lands

Three SQL views on gov matching dia's Phase A surface:
- `v_gap_agency_drift` — properties.agency vs leases.tenant_agency mismatch
- `v_gap_orphan_sale_owner` — sales missing the owner backlink
- `v_next_best_action` — UNION of 5 sources, ranked by gap_value DESC

After this lands, you can query the gov gap surface in one SELECT, same
shape as dia.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/04-next-best-action-phase-b1

node audit/patches/04-next-best-action-phase-b1/apply.mjs --dry
node audit/patches/04-next-best-action-phase-b1/apply.mjs --apply

git add -A
git commit -F audit/patches/04-next-best-action-phase-b1/COMMIT_MSG.txt

git checkout main
git merge --no-ff audit/04-next-best-action-phase-b1 -m "Merge audit/04-next-best-action-phase-b1: v_next_best_action gov mirror"
git push origin main
```

## Explore the new gov surface

```sql
-- Top 20 high-value gov gaps right now
SELECT rank, gap_type, gap_severity, property_id,
       gap_label, suggested_action, gap_value::bigint AS value
FROM public.v_next_best_action
WHERE gap_severity IN ('critical', 'high')
ORDER BY rank
LIMIT 20;

-- Agency-drift candidates (federal-side propagation gaps)
SELECT property_id, gap_label, suggested_action, gap_value::bigint
FROM public.v_next_best_action
WHERE gap_type LIKE 'agency_drift%'
ORDER BY gap_value DESC
LIMIT 30;

-- Cross-domain mental model: when both DBs have v_next_best_action,
-- the Phase B-2 endpoint will merge them and re-rank globally.
SELECT gap_type, count(*) AS n, max(gap_value)::bigint AS max_v
FROM public.v_next_best_action GROUP BY 1 ORDER BY 2 DESC;
```

## Phase B-2 (next session)

Backend endpoint `/api/admin?_route=next-best-action` that fans out
to dia + gov + LCC Opps, merges, re-ranks, returns top N. LCC Opps view
adds provenance conflicts + inbox triage + health alerts as gap sources.

## Phase C (after)

Home rail UI in `app.js` rendering the merged top-20 — replaces the
wrong-table Research pulse-card (audit B-13).
