# QA-10 — Sync error count reconciliation (P1)

**Severity: P1.** Three surfaces disagreed about how many sync errors
the operator should care about. Pipeline header alarmed the user, but
Sync Health and Metrics both insisted everything was fine.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/qa-10-sync-error-reconcile
node audit/patches/qa-10-sync-error-reconcile/apply.mjs --dry
node audit/patches/qa-10-sync-error-reconcile/apply.mjs --apply
git add -A
git commit -F audit/patches/qa-10-sync-error-reconcile/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/qa-10-sync-error-reconcile -m "Merge audit/qa-10-sync-error-reconcile: sync error count reconciliation"
git push origin main
```

## The conflict (before)

| Surface | Stat | Value | Source |
|---|---|---|---|
| Pipeline page header | "⚠ 1 connector failing: outlook" | **1** | `connectors.filter(c => c.status==='error'\|\|'degraded').length` |
| Sync Health page "Errors" tile | "0 unresolved sync issues" | **0** | `unresolved_errors.length` from `/api/sync?action=health` |
| Metrics page "Sync Errors" tile | "0 connectors" | **0** | `work_counts.sync_errors` row count from `/api/queue?view=work_counts` |

Three different counts of the same conceptual thing.

## Root cause

Two distinct concepts got conflated under the label "Sync Errors":

1. **Connector status errors** — connector accounts currently in
   `status='error'` (or `'degraded'`). What the Pipeline banner counts.
   Live in `summary.error` from `/api/sync?action=health`.

2. **Sync log error rows** — rows in the `sync_errors` table that have
   not been resolved. What `work_counts.sync_errors` counts. Live in
   `unresolved_errors[]` from `/api/sync?action=health`.

These diverge regularly:
- A connector can be in `status='error'` (e.g. OAuth expired) with
  zero rows in `sync_errors` because no sync attempt has been logged.
- The `sync_errors` table can have unresolved rows for a connector
  that's now `healthy` (errors from past attempts that have since
  recovered).

For the operator, the live connector status is the actionable signal.
The sync_errors log is more of an audit trail.

## What this patch does

**Two-line fix in `ops.js`:**

### 1. Sync Health page — "Errors" summary tile

```diff
- html += metricCardHTML('Errors', unresolvedErrors.length,
-                        'unresolved sync issues',
-                        unresolvedErrors.length > 0 ? 'red' : 'green');
+ html += metricCardHTML('Errors', summary.error || 0,
+                        'connectors in error state',
+                        (summary.error || 0) > 0 ? 'red' : 'green');
```

The "Recent Errors" widget below this tile still renders the
`unresolved_errors[]` list for diagnostics — just without a misleading
duplicate count tile.

### 2. Metrics page — "Sync Errors" tile

```diff
- html += metricCardHTML('Sync Errors', c.sync_errors || 0,
-                        'connectors',
-                        c.sync_errors > 0 ? 'red' : 'green');
+ const liveSyncErrors = (syncHealthRes.ok && syncHealthRes.data?.summary)
+   ? (syncHealthRes.data.summary.error || 0)
+   : (c.sync_errors || 0);
+ html += metricCardHTML('Sync Errors', liveSyncErrors,
+                        'connectors in error state',
+                        liveSyncErrors > 0 ? 'red' : 'green');
```

`renderMetricsPage` already fetches `/api/sync?action=health` for
the "Operational Signals" section — this just uses the same response.
Falls back to `c.sync_errors` if the sync-health endpoint failed.

## After

All three surfaces read from `summary.error`:

| Surface | Value | Source |
|---|---|---|
| Pipeline page header | **1** | connectors filter (unchanged) |
| Sync Health "Errors" tile | **1** | `summary.error` |
| Metrics "Sync Errors" tile | **1** | `summary.error` (with fallback) |

Verified live via Chrome MCP: `summary.error: 1` on the current
session, with one outlook connector in `status='error'` (last_error:
`"object is not iterable…"`).

## What we did NOT change

- The **Home team-pulse "Sync Errors" pulse-card** (`app.js` line
  ~7018) still uses `canonicalCounts.sync_errors`. That widget only
  renders for managers/owners AND only when at least one of
  open_actions / open_escalations / sync_errors / in_progress is > 0,
  so it's gated separately. Fixing it requires loading sync-health
  into Home's render flow — a bigger change. The widget is
  manager-only and gated on multiple signals, so a stale 0 there is
  far less user-visible than the Sync Health / Metrics tiles fixed
  here.
- The **work_counts.sync_errors** server-side definition. Could be
  redefined to count connector-status errors at the SQL level, but
  that's a Supabase MV change with broader blast radius.

## Follow-ups (separate patches)

Still queued from the 2026-05-18 QA pass:
- **P1** Public REITs + same-entity duplicates in `llc_research_queue`
- **P2** Casing/UX nits documented in `outputs/lcc-qa-pass-2026-05-18.docx`
- **Optional** redefine `work_counts.sync_errors` SQL to use connector
  status (would let Home team-pulse fix itself with no client change)
