# Item #2, Phase A — pg_cron schedule for `lcc-llc-research-tick`

**Closes:** A-1 (queue-drainer half), B-5 (cron half).
**Branch:** `audit/02-research-queue-drain`
**Priority:** CRITICAL
**Migration status:** Already applied to LCC Opps via Supabase MCP at 2026-05-17.

## What this patch does

Two things, both small:

1. Adds `supabase/migrations/20260517140000_lcc_llc_research_tick_cron.sql`
   — the .sql for the cron job that I already applied to LCC Opps. This file
   in the repo is the historical record; it'll be picked up by any new
   environment provisioning (branch DBs, restored snapshots, fresh local dev).
2. Updates `AUDIT_PROGRESS.md` — flips item #1 to DONE with merge SHA,
   item #2 to IN PROGRESS (Phase A landed), and documents two discoveries
   from the item-#2 investigation that change scope for item #5.

## Apply

```powershell
cd C:\Users\scott\life-command-center

# Confirm you're on the right branch
git branch --show-current   # expected: audit/02-research-queue-drain

# Dry-run
node audit/patches/02-research-queue-drain/apply.mjs --dry

# Apply
node audit/patches/02-research-queue-drain/apply.mjs --apply

# Inspect
git status
git diff --stat

# Commit
git add -A
git commit -F audit/patches/02-research-queue-drain/COMMIT_MSG.txt
git log --oneline -3
```

## Verify the cron is live (any time after applying)

You can run this from any SQL client connected to LCC Opps
(or via the Supabase dashboard SQL editor):

```sql
-- Existence and config
SELECT jobid, jobname, schedule, active, command
FROM cron.job
WHERE jobname = 'lcc-llc-research-tick';
-- Expected: 1 row, schedule='*/30 * * * *', active=true

-- After the next :00 or :30 boundary, recent runs:
SELECT runid, status, start_time, end_time, return_message
FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname='lcc-llc-research-tick')
ORDER BY end_time DESC LIMIT 5;
-- Expected: rows appear, status='succeeded'.

-- Drain progress on the gov side:
-- (Run against the GOVERNMENT db, not LCC Opps)
SELECT status, count(*) FROM public.llc_research_queue GROUP BY status;
-- If OPENCORPORATES_API_KEY is set in Vercel, you'll see 'queued' count
-- decrease over time as ticks process rows. If unset, 'queued' stays
-- constant; that's expected and the UI in Phase B handles the manual path.
```

## What this patch does NOT do

- **Does NOT include UI changes.** The Owner Research Queue tab in
  `gov.js` and `dialysis.js` is Phase B, a separate commit on this
  same branch.
- **Does NOT fix the ownership_research_queue silent-write bug.** That
  was moved to item #5 (provenance integrity) after the investigation
  revealed it's a column-schema mismatch, not a missing pipeline.

## If something goes wrong

The apply script is atomic. Failure paths:

- **Migration file already exists:** That's fine if it has the same
  content. If it differs, you'll have a merge conflict on `git add`.
  Resolve by inspecting both versions.
- **AUDIT_PROGRESS.md anchor mismatch:** Means item #1 or item #2 row
  was already manually edited. The script logs a warning and skips
  rather than aborting. You can hand-edit the table if needed and
  re-run `--apply` to pick up the appended sections.

Recovery before commit: `git restore supabase/migrations/20260517140000_lcc_llc_research_tick_cron.sql AUDIT_PROGRESS.md`

Recovery after commit but before push: `git reset --hard HEAD~1`

To reverse the cron job itself (in case you want to stop it firing):
```sql
SELECT cron.unschedule('lcc-llc-research-tick');
```
