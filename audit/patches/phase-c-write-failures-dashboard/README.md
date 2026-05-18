# Phase C — Silent-write failures dashboard

A widget on the Sync Health page that surfaces the silent-write
telemetry (`ingest_write_failures`) you've been collecting all sprint.
Closes the observability loop — now visible in-app, not just in Studio.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/phase-c-write-failures-dashboard
node audit/patches/phase-c-write-failures-dashboard/apply.mjs --dry
node audit/patches/phase-c-write-failures-dashboard/apply.mjs --apply
git add -A
git commit -F audit/patches/phase-c-write-failures-dashboard/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/phase-c-write-failures-dashboard -m "Merge audit/phase-c-write-failures-dashboard: silent-write dashboard"
git push origin main
```

No SQL migration. No Studio step.

## What you'll see

Open **Sync Health** (More drawer). Below the connector cards, a new
widget appears:

```
Silent-Write Failures  [last 24h]                                  ↻

┌───────────┬───────────┬───────────┬──────────────────┐
│ Total     │ Labeled   │ Unlabeled │ Distinct labels  │
│   315     │   315     │     0     │       12         │
└───────────┴───────────┴───────────┴──────────────────┘

LABEL                                  PATH                STATUS  COUNT  LAST SEEN
─────────────────────────────────────────────────────────────────────────────────
upsertDomainSales:initialInsert        sales_transactions  409     264    2m ago
autoStageGovComp                       sf_comps_staging    400      45    7m ago
autoScrapeListings:recordCheck         rpc/lcc_record_...  400      ...   ...
```

Hover any row for a sample `error_detail` tooltip showing the actual
Postgres error message.

After deploying all the labeling work from A-2/A-3/A-4, the "Unlabeled"
stat should drop to near 0. Once silent failures stop entirely, the
widget shows an empty-state checkmark.

## Backend

```
GET /api/admin?_route=write-failures-rollup&hours=24

{
  ok: true,
  window_hours: 24,
  totals: { total, labeled, unlabeled, distinct_labels },
  top_combos: [
    { label, path, http_status, count, latest_at, sample_detail },
    ...
  ]
}
```

## Phase C punch list — still pending

| Item | Effort |
|---|---|
| Sort/chip helper adoption per tab (matview hurdle on gov sales) | Small × 6 |
| Item #8 Phase B — per-action workflows | Small |
| client_errors consumption sweep | Medium |
| pushProvenance gating sweep | Medium |
| Item #3 Phase C — external enrichment | Multi-week |
