# QA-29 — Dia fixpack from QA pass #8 Chrome probe (P2)

**Severity: P2.** Three small fixes found while probing the live dia
home dashboard in Chrome after QA-24..28 shipped. All low-risk
frontend-only changes; gov modal footer mirror is the only gov-side
edit and it's a one-line accuracy improvement.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/qa-29-dia-fixpack
node audit/patches/qa-29-dia-fixpack/apply.mjs --dry
node audit/patches/qa-29-dia-fixpack/apply.mjs --apply
git add -A
git commit -F audit/patches/qa-29-dia-fixpack/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/qa-29-dia-fixpack -m "Merge audit/qa-29-dia-fixpack"
git push origin main
```

## Fix 1 — Top States widget: state names were invisible

**Symptom:** The "Top States" card in the dia Clinical Metrics row showed
ranks and counts but no state names. The DOM had `"CA"`, `"TX"`, `"NY"`
etc. correctly, but they didn't render visually.

**Root cause:** The row layout uses 4 cells: rank (20px), state name
(flex:1, no min-width), bar (80px), count (50px). Plus 3×8px gaps =
24px. Total fixed = 174px. In a 4-column grid card the rendered card
column is often ~160-180px wide, so the `flex:1` state cell shrank to
0px width because the fixed-width siblings overflowed.

**Fix:** Shrink the bar from 80px → 50px and the gap from 8 → 6px, and
give the state cell an explicit `min-width: 32px` (enough for two-letter
state codes). State name now shows in every card width.

## Fix 2 — Financial estimates "108.6% of clinics"

**Symptom:** Dia Financial Estimates row showed
"9,273 of 8,535 clinics (108.6%)" — mathematically impossible.

**Root cause:** `clinic_financial_estimates` has **9,273 distinct
medicare_ids**, but `medicare_clinics` (current CMS inventory) only has
**8,535**. Verified live with SQL:
- 8,511 estimates match a clinic
- **762 estimates reference clinics that no longer exist in CMS**
  inventory (clinics removed since the estimate was generated)

The dedup logic (group by medicare_id, pick highest confidence) correctly
returned 9,273 unique medicare_ids — but the denominator (8,535) is the
*current* clinic count. Over-coverage is real.

**Fix:** Cross-reference against `diaData.inventoryChanges` (already
loaded by `loadDiaData`) to get the set of currently-tracked clinic IDs,
and filter `best` to only include estimates whose medicare_id is in
that set. After the filter, `best.length` should be 8,511 (or close)
and the subtext reads ~99.7%. Falls back to unfiltered if
`inventoryChanges` hasn't loaded yet (defensive, so the card never
shows "—").

The 762 stale estimates remain in the database for historical analysis
but are excluded from the headline coverage metric.

## Fix 3 — Unprospected Owners modal footer

**Symptom:** The QA-25 "Unprospected Owners" tile correctly showed
"532 of 1232 active owners" in the headline. But clicking the tile
opened a modal whose footer said "Showing top 100 of 250" — where
250 was the query's row-limit cap, not the real total.

**Root cause:** `_diaShowProspectTargets` rendered the footer as
`Showing top ${top.length} of ${rows.length}` — `rows.length` is capped
at the diaQuery `limit` (was 250). The true count from the
`includeCount: true` envelope was only used for the headline tile, not
the modal.

**Fix:**
- Bumped dia query limit from 250 → 1000 (current real total = 532; the
  modal table now fully contains the unprospected universe).
- Stash the true count on `window._diaUnprospectedTotal` alongside the
  rows array, and have the modal footer read it: "Showing top 100 of
  532 unprospected owners". When the fetched set is smaller than the
  total (e.g. gov side at 250 fetched out of 7,372), the footer adds
  "(N fetched)" to disambiguate.
- Mirrored the same stash+footer pattern to gov.js so both modals are
  consistent.

## Files changed

- `dialysis.js`:
  - `renderTopStatesRankedCard` — Fix 1 (CSS widths)
  - `renderFinancialMetricsInner` — Fix 2 (dedup against current clinics)
  - QA-25 widget code — Fix 3a (limit 250 → 1000, stash count)
  - `_diaShowProspectTargets` — Fix 3b (footer reads true total)
- `gov.js`:
  - QA-25 widget code — stash count alongside rows
  - `_govShowProspectTargets` — footer reads true total
- `AUDIT_PROGRESS.md` — closeout

No SQL changes. No Edge Function changes. No allowlist changes.

## Verified live (Supabase MCP, 2026-05-18)

- 9,273 distinct medicare_ids in `clinic_financial_estimates`
- 8,535 distinct in `medicare_clinics`
- 8,511 overlap → expected post-fix headline: 8,511 / 8,535 = 99.7%
- 762 stale-estimate rows confirmed
