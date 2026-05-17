# Item #1 — Fire `runListingBdPipeline` from sidebar + OM intake

**Closes:** A-1 (partial), D-1, D-5
**Branch:** `audit/01-bd-pipeline-trigger`
**Priority:** CRITICAL

## What this patch does

Three coordinated changes that make every CoStar sidebar capture and every
flagged-email OM intake auto-queue T-011 (same-asset-state) and T-012
(geographic-proximity) BD drafts for peer-owner outreach. Previously these
fired only from the Salesforce listing webhook — see the audit doc D-1/D-5
findings for details.

## Apply

From PowerShell at the repo root:

```powershell
cd C:\Users\scott\life-command-center
git branch --show-current   # verify: audit/01-bd-pipeline-trigger

# 1. Copy the apply script into the repo (it lives in the sandbox by default)
#    You can either copy the whole audit/patches/ folder, or just this one item.
#    Replace <SANDBOX_OUTPUTS_PATH> with the path where Claude saved the patch.
#    If you're not sure, ask Claude to print it.
# Example:
#   Copy-Item -Recurse <SANDBOX_OUTPUTS_PATH>\audit\patches\01-bd-pipeline-trigger .\audit\patches\

# 2. Dry-run the patch — no files mutated. Verifies every anchor matches.
node audit/patches/01-bd-pipeline-trigger/apply.mjs --dry

# 3. If the dry-run reports OK on all three files, apply for real:
node audit/patches/01-bd-pipeline-trigger/apply.mjs --apply

# 4. Verify edits look right
git status
git diff --stat

# 5. Syntax check (fast sanity test before commit)
node -c api/_handlers/sidebar-pipeline.js
node -c api/_handlers/intake-promoter.js

# 6. Commit
git add -A
git commit -F audit/patches/01-bd-pipeline-trigger/COMMIT_MSG.txt

# 7. Push (when ready)
# git push -u origin audit/01-bd-pipeline-trigger
```

## Smoke test (recommended)

After commit, exercise the new code path against a real CoStar capture:

1. In your browser, open a CoStar property page for an asset type + state
   where you know you have peer-owner contacts in the LCC entities table.
   (Example: a dialysis property in Oklahoma if you have OK-based dialysis
   owners as contacts.)

2. Click "Send to LCC" from the Chrome extension and wait for the sidebar
   pipeline to finish.

3. Query the inbox:

   ```sql
   SELECT id, title, source_type, metadata->>'template_id' AS template,
          metadata->>'match_reason' AS reason, created_at
     FROM inbox_items
    WHERE source_type = 'listing_bd_trigger'
      AND created_at > now() - interval '10 minutes'
    ORDER BY created_at DESC;
   ```

   You should see T-011 (`same_asset_type_state`) and/or T-012
   (`geographic_proximity`) rows.

4. **Critical regression check:** capture the SAME CoStar listing again
   (re-run the sidebar). Re-run the SELECT above — there should be NO new
   inbox rows from this second capture. The `insertedListingId` gate
   should suppress re-fires for the same listing.

## If something goes wrong

The apply script is atomic per-file: it buffers all edits in memory and
only `fs.writeFile` after every replacement succeeds. If an anchor fails
to match (codebase drifted since the patch was authored), the script
aborts cleanly with `❌ FAILED: [<label>] anchor NOT FOUND` and writes
nothing.

Recovery:
- Hard rollback before commit: `git restore api/_handlers/sidebar-pipeline.js api/_handlers/intake-promoter.js AUDIT_PROGRESS.md`
- After commit but before push: `git reset --hard HEAD~1`

If the dry-run reports anchor failures, paste the failure output back to
Claude — anchors are easy to update.

## Files included in this patch folder

- `apply.mjs` — the apply script (run from repo root)
- `COMMIT_MSG.txt` — the exact commit message
- `README.md` — this file

## What this does NOT do

- Does NOT build the signal-router that consumes `listing_created` (that's
  audit finding D-7, deferred). For now `writeListingCreatedSignal` fires
  for telemetry but has no downstream consumer.
- Does NOT cap inbox-item volume on a single capture. If a single listing
  matches 200 peer owners, all 200 get queued. We can add a `limit` arg
  later if it becomes noise.
- Does NOT dedupe inbox items across re-captures of the SAME listing on
  consecutive days. The `insertedListingId` gate suppresses same-row
  re-fires; new INSERTs of nearly-identical listings (rare) will queue
  again. Acceptable for now.
