# Agency-drift Phase B — Missing-property handler + filter toggle

Extends the agency-drift widget shipped in A-5 to handle the second
drift_kind on gov: `lease_agency_but_property_agency_null` (46 cases
where the lease has tenant_agency but `properties.agency` is NULL).

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/phase-c-agency-drift-phase-b
node audit/patches/phase-c-agency-drift-phase-b/apply.mjs --dry
node audit/patches/phase-c-agency-drift-phase-b/apply.mjs --apply
git add -A
git commit -F audit/patches/phase-c-agency-drift-phase-b/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/phase-c-agency-drift-phase-b -m "Merge audit/phase-c-agency-drift-phase-b: missing-property handler"
git push origin main
```

No SQL migration. No Studio step. Reuses the resolve endpoint from A-5.

## What's new in the widget

The Agency Drift Queue widget header now has a 2-button toggle:

```
Agency Drift Queue  [10]      [Disagreement | Missing]  [↻]
```

- **Disagreement** (default, 808 cases) — same as A-5. Side-by-side
  red/green chips, "Use lease value" button.
- **Missing** (46 cases) — italic "(blank)" placeholder + green lease
  chip, "Fill in from lease" button. Single-click resolution since
  there's no conflict to judge.

Your chosen mode persists across page reloads in
`localStorage.lcc.adrift.kind`.

## Smoke test

1. App → More drawer → Research.
2. Agency Drift widget shows the new toggle in its header.
3. Click **Missing** → up to 15 rows appear with "(blank)" + green
   lease chip + "Fill in from lease" button.
4. Click **Fill in from lease** on a row → confirm → row disappears
   (drift resolved).
5. Toggle back to **Disagreement** → original A-5 view.

## Phase C punch list — still pending

- Item #3 Phase C — external enrichment pipeline (13,131 NULL-owner properties)
- Item #8 Phase B — per-action inline workflows on next-action bar
- Sort/chip helper adoption per tab (6 tabs)
- pushProvenance gating sweep
- client_errors consumption sweep
- ingest_write_failures admin dashboard
