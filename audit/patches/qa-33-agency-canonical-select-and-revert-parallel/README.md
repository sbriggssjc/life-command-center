# QA-33 — Hotfix: agency_canonical in SELECT + revert QA-26 parallel pagination

**Severity: P1 hotfix.** Chrome verification of QA-24..30 surfaced two
serious regressions in production:

1. **QA-24 is dead code.** The DB has `agency_canonical = 'VA'` correctly
   for all VA rows (migration ran fine), but the frontend never fetches
   that column. The Agency Breakdown chart still shows the pre-QA-24
   fragmented state (VA split across 3 buckets, SSA split, USDA split).
2. **QA-26 is a perf regression.** Full gov dashboard load now takes
   ~194 seconds with browser unresponsive mid-load. The parallel
   pagination flood (~60 concurrent HTTP requests at startup)
   overwhelms Vercel/Supabase/browser.

This patch fixes both.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/qa-33-agency-canonical-select-and-revert-parallel
node audit/patches/qa-33-agency-canonical-select-and-revert-parallel/apply.mjs --dry
node audit/patches/qa-33-agency-canonical-select-and-revert-parallel/apply.mjs --apply
git add -A
git commit -F audit/patches/qa-33-agency-canonical-select-and-revert-parallel/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/qa-33-agency-canonical-select-and-revert-parallel -m "Merge audit/qa-33-agency-canonical-select-and-revert-parallel"
git push origin main
```

## Fix 1 — Add `agency_canonical` to properties SELECT

The portfolio properties query in `_loadPaginatedQuery('properties', ...)`
listed ~30 columns but never `agency_canonical`. QA-24 added the
column to the DB and wired `p.agency_canonical || p.agency` into the
chart's groupBy, but the property objects never had the canonical
field — every row's `agency_canonical` was `undefined`, so the fallback
to raw `.agency` always fired.

**Live JS probe confirmed (2026-05-18):**

```json
"va_samples": [
  { "agency": "VETERANS AFFAIRS", "has_canonical_field": false },
  { "agency": "VETERANS AFFAIRS", "has_canonical_field": false },
  { "agency": "VETERANS AFFAIRS", "has_canonical_field": false }
]
```

Fix: add `'agency_canonical'` to the SELECT, between `agency` and
`agency_full_name`. After this deploys, the Agency Breakdown chart will
show VA correctly grouped at the top with ~1,875 properties.

## Fix 2 — Revert QA-26 parallel pagination

**Live timings (2026-05-18):**
- Time to `govConnected = true`: ~3 s
- Time to `govDataLoaded = true` (Phase 1 complete): ~18 s (was supposed
  to be ~1.5 s)
- Time to full data load (Phase 2 + ownership coverage): **~194 s**
- Browser screenshot tool **timed out mid-load** for ~60 s — renderer
  unresponsive while parsing ~60 simultaneous JSON responses

The QA-26 fix issued all pagination requests in parallel via
`Promise.all` after learning the total from a count query. In theory
this drops N round-trips to first-page + slowest-parallel-page. In
practice it overwhelms:
- Vercel's edge worker pool (likely a few concurrent slots)
- Supabase PostgREST connection pool
- The browser's response-parsing thread (HTTP/2 multiplexing doesn't
  parallelize JSON.parse)

Going back to serial pagination. Predictable, slower, but the dashboard
becomes usable. A throttled-parallel approach (concurrency=4) is the
better long-term fix — captured as a follow-up, not in this hotfix.

Reverts:
- `govQueryAll` → serial while-loop with 120s timeout fuse
- `_loadPaginatedQuery` → serial while-loop
- Ownership-coverage block → sequential awaits (instead of Promise.all
  over `ownership_history` + `true_owners` + `v_prospect_targets`)

Note: QA-27's parallel pagination on the **dia** side is NOT reverted
here. Need to probe dia separately first to confirm if it's also a
regression. Will address in a follow-up if needed.

## What this does NOT touch

- The QA-24 SQL migration — still correct, still wanted. `agency_canonical`
  is populated on every property. Once the SELECT change ships, the
  chart will display the canonical groupings.
- QA-25 widget — works correctly (verified live).
- QA-27 (dia parallel pagination) — separate investigation needed.
- QA-28/29/30 — unaffected by this patch.

## Files changed

- `gov.js` — `agency_canonical` added to SELECT; `govQueryAll`,
  `_loadPaginatedQuery`, and ownership-coverage block reverted to serial
- `AUDIT_PROGRESS.md` — closeout

No SQL changes. No Edge Function changes. No allowlist changes.
