# Item #6 Phase B-2 — NBA queue completeness weighting

Builds on B-1 (persisted completeness column). The `v_next_best_action`
view now multiplies `gap_value` by a completeness factor so
"near-finished" records' open gaps rank above same-dollar gaps on
records that would need 5+ more closures to be useful.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/06B2-nba-completeness-weighting
node audit/patches/06B2-nba-completeness-weighting/apply.mjs --dry
node audit/patches/06B2-nba-completeness-weighting/apply.mjs --apply
git add -A
git commit -F audit/patches/06B2-nba-completeness-weighting/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/06B2-nba-completeness-weighting -m "Merge audit/06B2-nba-completeness-weighting: NBA completeness weighting"
git push origin main
```

Both SQL migrations already live on dia + gov via MCP. This patch only
commits the `.sql` files for repo provenance + the audit-doc closeout.

## What changed

Before:
```sql
gap_value = <per-gap-type formula>
ORDER BY gap_value DESC
```

After:
```sql
raw_gap_value      = <per-gap-type formula>           (same as before)
weighted_gap_value = raw_gap_value * CASE band
   WHEN 'excellent' THEN 1.50
   WHEN 'good'      THEN 1.25
   WHEN 'fair'      THEN 1.00
   WHEN 'poor'      THEN 0.80
   ELSE 1.00 END
gap_value          = weighted_gap_value               (API alias)
ORDER BY weighted_gap_value DESC
```

New columns exposed: `raw_gap_value`, `completeness_band`,
`completeness_score`. Existing callers (admin endpoint, NBA Home rail)
continue to work unchanged — they sort by `gap_value`, which now
encodes the weighting.

## Smoke test

In Supabase Studio (either DB):

```sql
-- Inspect the top 15 with multiplier transparency:
SELECT rank, gap_type, completeness_band,
       gap_value::bigint     AS weighted,
       raw_gap_value::bigint AS raw,
       round((gap_value / NULLIF(raw_gap_value, 0))::numeric, 2) AS multiplier,
       left(gap_label, 60)   AS label
  FROM public.v_next_best_action
 ORDER BY rank
 LIMIT 15;
```

You should see the `multiplier` column showing 0.80 / 1.00 / 1.25 / 1.50
depending on each property's band — confirming the weighting is in effect.

Then hard-reload the LCC app and open Home. The NBA rail should reflect
the new ordering — properties in `excellent`-band that were ranked lower
on raw $ value should now appear higher on weighted $ value.

## What's next (Phase B-3, deferred)

- **List sort UI** — "Sort by: Value · Date · Completeness" toggle on
  dia + gov list views, with localStorage persistence keyed by table.
- **Completeness-band chip** in list rows.
- Cheap because the B-1 column is indexed.
