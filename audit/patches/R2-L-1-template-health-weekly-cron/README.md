# R2-L-1 — Template health weekly rollup + history table

**Branch:** `audit/r2-l-1-template-health-weekly-cron` (off `origin/main`)
**Closes:** R2-L-1 (HIGH) from `audit/ROUND_2_FINDINGS_2026-05-19.md`

## What this does

Schedules `evaluateTemplateHealth()` to run automatically every Monday
06:00 UTC and persist the results to a new `template_health_history` table
on LCC Opps. Closes the first half of the learning-loop gap caught in
Round 2 — input now has a scheduled cadence; the second half (D-3's
`record_send` writer) makes the input non-empty.

## How to apply

```bash
node audit/patches/R2-L-1-template-health-weekly-cron/apply.mjs
node audit/patches/R2-L-1-template-health-weekly-cron/apply.mjs --apply
```

Then apply the SQL migration via Supabase MCP on **LCC Opps**
(`xengecqvemvfknjvbvrq`):

```
supabase/migrations/20260519120000_lcc_r2_l1_template_health_history_and_cron.sql
```

The `?action=health-rollup` handler in `api/operations.js` deploys with the
next Vercel push.

## Verification (post-apply)

```sql
-- On LCC Opps
\d public.template_health_history
SELECT * FROM cron.job WHERE jobname = 'lcc-template-health-rollup';
-- Expected: 1 row, schedule='0 6 * * 1', active=true

-- Trigger a one-shot manual run (also exercises the handler)
SELECT public.lcc_cron_post(
  '/api/operations?_route=draft&action=health-rollup',
  '{"lookback_days": 120, "persist": true}'::jsonb,
  'vercel'
);

-- Verify history row landed
SELECT * FROM public.template_health_history ORDER BY recorded_at DESC LIMIT 5;
```

## Rollback

```sql
-- On LCC Opps
SELECT cron.unschedule('lcc-template-health-rollup');
DROP TABLE IF EXISTS public.template_health_history;
```

Revert the api/operations.js change by removing the `action === 'health-rollup'`
block (74 lines) after the existing `action === 'health'` handler.

## Closes / blocks

- Closes: **R2-L-1** (HIGH)
- Captures: **R2-L-1b** (trend sparkline UI), **R2-L-1c** (week-over-week
  regression alert in daily briefing). Both deferred until the history
  table has enough rows for trend analysis to be meaningful.
- Depends on **D-3** (Outlook sent capture flow) for the underlying
  template_sends data to actually populate. Without D-3, every rollup
  row will show `total_sends=0` — a clean baseline.

## Files

- `supabase/migrations/20260519120000_lcc_r2_l1_template_health_history_and_cron.sql`
- `api/operations.js` (added `?action=health-rollup` handler)
- `audit/patches/R2-L-1-template-health-weekly-cron/apply.mjs`
- `audit/patches/R2-L-1-template-health-weekly-cron/README.md`
- `audit/patches/R2-L-1-template-health-weekly-cron/COMMIT_MSG.txt`
- `audit/ROUND_2_FINDINGS_2026-05-19.md` (closeout block appended by apply.mjs)
