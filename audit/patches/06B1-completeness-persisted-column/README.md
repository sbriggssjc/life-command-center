# Item #6 Phase B-1 — Persisted completeness column

Caches the Phase A `v_property_completeness` score + band as
denormalized columns on the `properties` table on both dia + gov,
with a nightly pg_cron refresh.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/06B1-completeness-persisted-column
node audit/patches/06B1-completeness-persisted-column/apply.mjs --dry
node audit/patches/06B1-completeness-persisted-column/apply.mjs --apply
git add -A
git commit -F audit/patches/06B1-completeness-persisted-column/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/06B1-completeness-persisted-column -m "Merge audit/06B1-completeness-persisted-column: persisted completeness column"
git push origin main
```

Both SQL migrations are **already applied** to dia + gov via MCP. This
patch only commits the `.sql` files for repo provenance plus the
audit-doc closeout. No Studio step required.

## Verify (anytime)

```sql
-- Both DBs, run separately:

-- 1. Every property has a score
SELECT count(*) FILTER (WHERE completeness_score IS NOT NULL),
       count(*) AS total
  FROM public.properties;

-- 2. Cron is scheduled
SELECT jobname, schedule, command
  FROM cron.job
 WHERE jobname = 'refresh_property_completeness_nightly';

-- 3. Distribution
SELECT completeness_band, count(*)
  FROM public.properties
 GROUP BY 1 ORDER BY 2 DESC;

-- 4. Manual refresh (returns 0 updated if everything is already aligned)
SELECT * FROM public.refresh_property_completeness();
```

## Live distribution as of 2026-05-17

| Band | Dia | Gov |
|---|---:|---:|
| Excellent (90+) | 121 | 788 |
| Good (70–89) | 660 | 7,455 |
| Fair (40–69) | 4,707 | 2,362 |
| Poor (<40) | 9,731 | 6,843+ |

(Gov: 17,454 total, up 6 from earlier in the sprint — normal ingest activity.)

## What's next

**Phase B-2 — NBA queue weighting.** Modify `v_next_best_action` so
`gap_value` is multiplied by a completeness factor. Concretely: when
two properties both have a `missing_recorded_owner` gap at $5M value,
prefer the one that's 75% complete over the one that's 30% complete —
because closing the owner gap on the 75% one delivers a near-finished
underwriting.

**Phase B-3 — List sort UI.** Add a "Sort by: Value · Date ·
Completeness" toggle to gov + dia list views, with localStorage
persistence. Plus a visible completeness band chip in list rows.
