# QA-22 — Daily Briefing sync errors + DaVita branding + Pipeline pager

Three findings from QA pass #5 bundled into one patch.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/qa-22-daily-briefing-davita-pager
node audit/patches/qa-22-daily-briefing-davita-pager/apply.mjs --dry
node audit/patches/qa-22-daily-briefing-davita-pager/apply.mjs --apply
git add -A
git commit -F audit/patches/qa-22-daily-briefing-davita-pager/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/qa-22-daily-briefing-davita-pager -m "Merge audit/qa-22-daily-briefing-davita-pager"
git push origin main
```

---

## (a) Daily Briefing + Home team-pulse: Sync Errors 0 (wrong)

Daily Briefing widget showed `Sync Errors 0` while Pipeline banner /
Metrics tile / Sync Health tile all showed `1` (one outlook connector
in `status='error'`). Same root cause as QA-10's Metrics/Sync Health
fix — but on a different render path (`renderDailyBriefingPanel` +
`renderTeamPulse`) that QA-10 didn't touch.

**Fix:** `loadDailyBriefingData` now fetches `/api/sync?action=health`
alongside the daily briefing snapshot. Stashes `summary.error` on
`window._lccLiveSyncErrors`. Both the Daily Briefing "Sync Errors"
db-kpi tile AND the Home team-pulse "Sync Errors" pulse-card now
prefer the live value, falling back to `canonicalCounts.sync_errors`
only when the sync-health fetch failed.

Also updated the team-pulse gate so the widget shows when only the
live count is non-zero (previously hidden because
`canonicalCounts.sync_errors == 0` even though one connector was
in error state).

## (b) "Davita" → "DaVita" brand canonicalization (data fix, dia)

QA pass #5 found 2,531 rows with `"Davita …"` prefix + 115 rows with
all-caps `"DAVITA"` in `properties.tenant`. The detail panel header
showed e.g. `"Davita Lakewood Community Dialysis Center"` — should
be `"DaVita …"` (NYSE: DVA).

**Fix:**
- New IMMUTABLE `public.canonicalize_davita_brand(text)` that regex-
  replaces `(davita|DAVITA|Davita)` → `"DaVita"` with whole-word
  boundaries.
- One-shot backfill on `properties.tenant`.
- BEFORE INSERT/UPDATE trigger keeps future writes canonical.

**Verified live:** 2,531 bad rows → 0; canonical "DaVita" prefix
count went from 1,798 → 4,329 (matches: 2,531 fixed + 115 ALL-CAPS
expanded with surrounding casing). Detail panel header on dia
properties tenanted by DaVita now reads "DaVita Lakewood …".

Gov side has no `tenant` column (uses `agency` instead) so no
gov-side migration needed.

## (c) Pipeline My Work pager total mismatch

Pipeline page header showed `"View My Work 0 items"` (correct after
QA-09) but the pager below said `"Page 1 of 298 (7432 items)"` — the
7,432 figure was the canonical-inbox count from a totally different
load path. The pager key in `paginationHTML('/api/queue?view=my_work',
…)` didn't match the actual fetch URL `/api/queue?view=my_work&limit=100`,
so it pulled stale data from another slot.

**Fix:**
- Use the correct pager key (`'/api/queue?view=my_work&limit=100'`).
- Don't render the pager at all when `opsMyWorkData.length < 100`
  (no pagination needed, no risk of inheriting another slot's total).

## Files changed

- `supabase/migrations/dialysis/20260518200000_dia_qa22_davita_brand_casing.sql`
- `app.js` — `loadDailyBriefingData` parallel sync-health fetch + two
  render-site updates (Daily Briefing tile, team-pulse pulse-card)
  + team-pulse gate
- `ops.js` — Pipeline pager key + threshold guard
- `AUDIT_PROGRESS.md` (closeout)

Migration applied live via Supabase MCP on 2026-05-18.

## Summary of QA-cycle changes for sync-error display

After QA-22, ALL surfaces that display "sync errors" agree on the
same number:

| Surface | Source after QA-22 |
|---|---|
| Pipeline page banner | `connectors.filter(status==='error')` |
| Sync Health "Errors" tile | `summary.error` (QA-10) |
| Metrics "Sync Errors" tile | `summary.error` (QA-10) |
| Daily Briefing "Sync Errors" tile | `summary.error` via `_lccLiveSyncErrors` (QA-22) |
| Home team-pulse "Sync Errors" pulse-card | same (QA-22) |
