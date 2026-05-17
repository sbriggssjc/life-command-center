# Bug-fix #2 + #3 — LCC Opps intake pipeline schema drift

Two production errors found during Item #6 triage, both in the
`staged_intake_*` pipeline on LCC Opps. Combined into one patch because
they hit the same handler family.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b bugfix/02-03-intake-schema-drift
node audit/patches/bug-02-03-intake-schema-drift/apply.mjs --dry
node audit/patches/bug-02-03-intake-schema-drift/apply.mjs --apply
git add -A
git commit -F audit/patches/bug-02-03-intake-schema-drift/COMMIT_MSG.txt
git checkout main
git merge --no-ff bugfix/02-03-intake-schema-drift -m "Merge bugfix/02-03-intake-schema-drift: intake schema drift repair"
git push origin main
```

## Run the migration

Apply via **Supabase Studio SQL Editor** on project `xengecqvemvfknjvbvrq`
(LCC Opps) — MCP was still timing out at apply-time on 2026-05-17.

1. Open https://supabase.com/dashboard/project/xengecqvemvfknjvbvrq/sql/new
2. Paste the contents of
   `supabase/migrations/20260517250000_lcc_intake_schema_drift_repair.sql`
3. Run.

The migration is **idempotent + safe**: the DO-block inspects
`information_schema` and only `ALTER`s if `inline_data` is currently
`bytea`. The CHECK is dropped + re-added cleanly.

## Verify

```sql
-- 1. inline_data is back to text
SELECT data_type FROM information_schema.columns
WHERE table_name='staged_intake_artifacts' AND column_name='inline_data';
-- → text

-- 2. CHECK now allows 'matched' and 'no_match'
SELECT pg_get_constraintdef(c.oid)
FROM pg_constraint c JOIN pg_class t ON c.conrelid=t.oid
WHERE t.relname='staged_intake_items'
  AND c.conname='staged_intake_items_status_check';
-- → CHECK (status IN ('queued', 'processing', 'review_required', 'failed',
--                     'finalized', 'discarded', 'matched', 'no_match'))
```

## Smoke test

1. Hard-reload the LCC app.
2. Open the sidebar, attach a small PDF or paste a screenshot.
3. Confirm:
   - No `invalid input syntax for type bytea` error in Postgres logs.
   - A row appears in `staged_intake_artifacts` with non-null `inline_data`.
   - A matching row in `staged_intake_items` with `status='queued'`.
4. Open the LCC inbox, click into the staged row, hit "approve" or "no match".
   - No `staged_intake_items_status_check` violation in Postgres logs.
   - `staged_intake_items.status` updates to `'matched'` or `'no_match'`.
