# Fresh audit A-5 — Agency drift review UI

Last fresh-audit finding. Surfaces 807 gov agency-disagreement cases
(204 excellent-band) in a second Research-page widget below the LLC
Research widget from #2B.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/fresh-A5-agency-drift-review-ui
node audit/patches/fresh-A5-agency-drift-review-ui/apply.mjs --dry
node audit/patches/fresh-A5-agency-drift-review-ui/apply.mjs --apply
git add -A
git commit -F audit/patches/fresh-A5-agency-drift-review-ui/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/fresh-A5-agency-drift-review-ui -m "Merge audit/fresh-A5-agency-drift-review-ui: agency-drift review UI"
git push origin main
```

No SQL migration. No Studio step.

## What this gives you

A second widget at the top of **Research**, directly below the LLC
Research widget. For each row:

```
PROP_AGENCY           vs   LEASE_TENANT_AGENCY
  red-tinted chip          green-tinted chip
[Use lease value] [Open detail]
```

- **Use lease value** — async-confirm prompt → PATCHes
  `gov.properties.agency / agency_canonical / agency_full_name` to
  the lease tenant value → row disappears (drift resolved).
- **Open detail** — opens the unified property detail panel for full
  context.

## Smoke test (post-Railway redeploy)

1. App → More drawer → **Research**. Two widgets stacked.
2. The Agency Drift widget shows up to 15 rows ordered by deal value DESC.
3. Click **Use lease value** on the top row → toast confirms → row gone.
4. On Supabase Studio (gov):
   ```sql
   SELECT count(*) FROM public.v_gap_agency_drift
    WHERE drift_kind = 'agency_disagreement';
   -- Should drop by 1 after the previous step.
   ```

## Fresh audit punch list

| Finding | Status |
|---|---|
| A-1 — orphan sale backfill | ✅ |
| A-2 — sales POST label | ✅ |
| A-3 — label + fix unlabeled writers | ✅ |
| A-4 — loans status normalized + CHECK loosened | ✅ |
| **A-5 — agency-drift review UI** | **✅ shipping now** |

Fresh audit is fully closed.

## Phase C carry-forward (unchanged)

- Item #3 Phase C — external enrichment pipeline for 13,131 NULL-owner
  properties.
- Item #8 Phase B — per-action inline workflows on the next-action bar.
- Sort/chip helper adoption per tab (sales, listings, portfolio,
  prospects, ops, loans).
- pushProvenance gating sweep across remaining ~30 call sites.
- client_errors consumption — migrate ad-hoc console.warn+showToast.
- ingest_write_failures admin dashboard widget.
- Agency-drift Phase B — bulk mode + `lease_agency_but_property_
  agency_null` handler.
