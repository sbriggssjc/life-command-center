# Discovery patch #1 — gov schema mirror + loans CHECK expansion

**Trigger:** Item #5 instrumentation surfaced 5 silent-failure patterns within 2 minutes.
**Closes:** 3 of those 5 patterns (the schema-drift ones).
**Branch:** `audit/discovery-01-gov-schema-mirror`
**Migration status:** Already applied to gov via Supabase MCP at 2026-05-17 18:05 UTC.

## What this patch does

Mirrors 3 columns from dia onto gov and expands the gov `loans_loan_type_check`
constraint so the sidebar's loan/owner/ownership-history writes stop failing
silently on the gov side.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/discovery-01-gov-schema-mirror

node audit/patches/discovery-01-gov-schema-mirror/apply.mjs --dry
node audit/patches/discovery-01-gov-schema-mirror/apply.mjs --apply

git status
git diff --stat

git add -A
git commit -F audit/patches/discovery-01-gov-schema-mirror/COMMIT_MSG.txt

# Merge
git checkout main
git merge --no-ff audit/discovery-01-gov-schema-mirror -m "Merge audit/discovery-01-gov-schema-mirror: gov schema mirror + loans CHECK expansion"
git push origin main
```

## Verify after deploy

```sql
-- On LCC Opps — silent failures should drop after next sidebar capture
SELECT label, count(*) AS n
FROM v_ingest_write_failures_recent
WHERE occurred_at > now() - interval '15 minutes'
GROUP BY label
ORDER BY n DESC;
```

Labels for `upsertDomainOwners:linkOwnershipToSale`, `upsertDomainOwners:linkSaleToOwner`,
and `upsertDomainLoans:financing` should disappear from the recent set.
