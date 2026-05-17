# Bug-fix #1 — Add `inbox_items.flag_removed_at` column

Surfaced in production Postgres logs during Item #6 triage:
```
ERROR: column inbox_items.flag_removed_at does not exist
```

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b bugfix/01-inbox-flag-removed-at
node audit/patches/bug-01-inbox-flag-removed-at/apply.mjs --dry
node audit/patches/bug-01-inbox-flag-removed-at/apply.mjs --apply
git add -A
git commit -F audit/patches/bug-01-inbox-flag-removed-at/COMMIT_MSG.txt
git checkout main
git merge --no-ff bugfix/01-inbox-flag-removed-at -m "Merge bugfix/01-inbox-flag-removed-at: add inbox_items.flag_removed_at"
git push origin main
```

## Run the migration

**Important:** LCC Opps (project `xengecqvemvfknjvbvrq`) was intermittently
timing out via Supabase MCP during this triage. Apply via **Supabase Studio
SQL Editor** instead — it uses a separate connection path and should succeed.

1. Open https://supabase.com/dashboard/project/xengecqvemvfknjvbvrq/sql/new
2. Paste the contents of
   `supabase/migrations/20260517240000_lcc_inbox_items_flag_removed_at.sql`
3. Run.
4. Verify with:
   ```sql
   SELECT column_name
   FROM information_schema.columns
   WHERE table_name = 'inbox_items' AND column_name = 'flag_removed_at';
   ```
   Should return one row.

## Smoke test

1. Hard-reload the LCC app.
2. Open Postgres logs in Supabase Studio. The
   `column inbox_items.flag_removed_at does not exist` error should stop
   appearing.
3. Home load should be perceptibly snappier (one fewer failed round-trip
   per email-load request).
4. Open an email's flag in Outlook → unflag it → wait for next sync →
   confirm the row in `inbox_items` shows a populated `flag_removed_at`.
