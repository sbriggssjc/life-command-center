# Item #5, Phase A — surface silent domain-DB write failures

**Closes:** A-3 (the table + instrumentation half — call-site migration + D-13 = Phase B).
**Branch:** `audit/05-provenance-integrity`
**Priority:** CRITICAL
**Migration status:** Already applied to LCC Opps via Supabase MCP at 2026-05-17.

## What this patch does

Adds a single global hook so every non-2xx PostgREST write response from
either domain DB lands a row in `public.ingest_write_failures` on LCC Opps.
No per-call-site change needed — the instrumentation is at `domainQuery`,
which every writer goes through.

After this lands, the silent-failure pattern that has been masking schema
mismatches and FK violations for an unknown duration becomes queryable in
seconds.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git branch --show-current   # expected: audit/05-provenance-integrity

node audit/patches/05-provenance-integrity/apply.mjs --dry
node audit/patches/05-provenance-integrity/apply.mjs --apply

git status
git diff --stat
node -c api/_shared/ops-db.js
node -c api/_shared/domain-db.js
node -c api/_handlers/sidebar-pipeline.js

git add -A
git commit -F audit/patches/05-provenance-integrity/COMMIT_MSG.txt
git log --oneline -3
```

## After deploy: confirm instrumentation is firing

Run from LCC Opps SQL editor any time after the next sidebar capture or
OM intake:

```sql
-- See what's been failing
SELECT id, occurred_at, domain, method, path, http_status,
       error_summary, fields_attempted, label, caller_file
FROM v_ingest_write_failures_recent
ORDER BY occurred_at DESC LIMIT 20;

-- Rollup for pattern detection
SELECT label, domain, n, http_statuses, first_seen, last_seen
FROM v_ingest_write_failures_by_label
ORDER BY n DESC LIMIT 20;
```

You should see entries appear within ~minutes of the next CoStar sidebar
capture against a gov property (the D-13 ownership_research_queue writers
will fail with HTTP 400 immediately).

## What this does NOT do

- **Does NOT gate pushProvenance / recordCoStarFieldsProvenance** on the
  PATCH `.ok` flag. Phase B will migrate those 47 call sites in
  sidebar-pipeline.js so field_provenance stops recording ghost writes.
- **Does NOT fix the D-13 column-schema mismatch** in the two
  ownership_research_queue writers. Phase B will either rewrite them
  to use the correct AI-pipeline schema or remove them as redundant.
- **Does NOT alert.** The ingest_write_failures table accumulates rows
  for query; daily-briefing / Teams surfacing is a follow-up.

## Reversal

Before commit: `git restore api/_shared/ops-db.js api/_shared/domain-db.js api/_handlers/sidebar-pipeline.js AUDIT_PROGRESS.md`
After commit:  `git reset --hard HEAD~1`
To remove the table: `DROP TABLE public.ingest_write_failures CASCADE;` on LCC Opps.
