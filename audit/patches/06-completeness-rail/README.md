# Item #6 Phase A — Data Completeness rail on detail.js

Adds a completeness score + missing-field chips at the top of every property
detail panel. Click a chip → jumps to the tab where that field lives.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/06-completeness-rail
node audit/patches/06-completeness-rail/apply.mjs --dry      # preview
node audit/patches/06-completeness-rail/apply.mjs --apply    # write
git add -A
git commit -F audit/patches/06-completeness-rail/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/06-completeness-rail -m "Merge audit/06-completeness-rail: completeness rail on detail.js"
git push origin main
```

The two SQL views are already live on dia + gov (applied via Supabase MCP).
The .sql files in the patch are committed for repo provenance.

## Smoke test

1. Hard-reload the app.
2. Click any property in a list (or click an NBA rail row on Home) to open
   the unified detail panel.
3. Confirm a thin horizontal rail appears directly under the tab bar:
   - "COMPLETENESS" label
   - Score number (0-100)
   - Band chip (EXCELLENT / GOOD / FAIR / POOR), color-coded
   - Up to 6 dashed-outline chips for the top missing high-value fields
   - "+N more" indicator if there are more than 6 missing fields
4. Click a chip → the panel switches to the tab where that field lives.
5. Open a few different properties:
   - A dia property with no recorded owner → "Recorded owner" chip should
     be visible with weight badge "+14".
   - A gov property without an NOI → "NOI" chip with "+11".
   - A property with all 14 fields populated → no chips, "All high-value
     fields populated".
6. Close the panel and open a different property → rail refreshes for the
   new record (does not stale on the old one).

## How the score works

Server-side via `v_property_completeness` in each DB. The view checks 14
field presences, assigns each a weight (sum = 100), and produces:
- `completeness_score` integer 0-100
- `completeness_band` text
- `missing_fields` JSONB array `[{ key, label, weight, tab }, ...]` sorted
  by weight DESC

The detail panel fetches this view in the existing parallel `Promise.all`
that already loads `v_property_detail` etc., so the rail adds zero latency
to the open path.

## What's next (Phase B)

- Persisted `completeness_score` + `completeness_band` columns on
  `properties` so list views can sort and filter without joining the view.
- Nightly cron to refresh after big ingests.
- "Sort by completeness" option on dia + gov list views (closes the second
  half of audit finding B-15).
- Weight the NBA queue (`v_next_best_action`) so "almost-complete
  underwriting candidates" (band=good and missing only 1-2 fields) rank
  above stranded "poor" records.
- Field-level focus on chip click (currently switches tabs; future: scroll
  to and focus the specific input).
