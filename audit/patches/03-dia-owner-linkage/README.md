# Item #3, Phase A — wire `resolveOwnerLinks` for dia domain

**Closes:** A-2 (forward-looking half — backfill = Phase B, deferred).
**Branch:** `audit/03-dia-owner-linkage`
**Priority:** CRITICAL

## What this patch does

Adds a `resolveOwnerLinksDia` sibling function in `intake-promoter.js`
that mirrors the gov logic with dia column names. Replaces the dia
early-return (`owner_resolution_not_implemented_for_dialysis`) with a
dispatcher that routes dia matches to the new function.

After this lands, every dia OM intake from now on will:

1. Read the property's current `recorded_owner_id` / `true_owner_id` state.
2. Choose an owner-name signal: `snapshot.seller_name` →
   `property.assessed_owner` → parsed from `property.notes`.
3. Normalize the name (strip LLC/LP/Inc/Corp suffixes).
4. ILIKE-match against `recorded_owners.{name,normalized_name}` and
   `true_owners.{name,normalized_name}`.
5. PATCH the FK columns on properties.
6. Call `reconcilePropertyOwnership('dialysis', ...)` to denormalize the
   `recorded_owner_name` / `true_owner_name` columns.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git branch --show-current   # expected: audit/03-dia-owner-linkage

node audit/patches/03-dia-owner-linkage/apply.mjs --dry
node audit/patches/03-dia-owner-linkage/apply.mjs --apply

git status
git diff --stat
node -c api/_handlers/intake-promoter.js   # syntax check

git add -A
git commit -F audit/patches/03-dia-owner-linkage/COMMIT_MSG.txt
git log --oneline -3
```

## What this does NOT do

- **No backfill.** 13,338 historical NULL-owner dia properties stay NULL
  until Phase B (a one-shot Node script) lands. Phase A only affects new
  intakes.
- **No new owner records.** Only links to existing `recorded_owners` /
  `true_owners`. New-owner creation is `sidebar-pipeline.js`'s job.

## Smoke test (optional but recommended)

Pick a dia property that has a recent OM in `staged_intake_items` AND a
NULL `recorded_owner_id`, AND a matching name in `recorded_owners`:

```sql
-- Find a smoke-test candidate (run against the dia DB)
SELECT p.property_id, p.address, p.assessed_owner,
       r.recorded_owner_id, r.name AS recorded_owner_name
  FROM public.properties p
  JOIN public.recorded_owners r
    ON r.normalized_name ILIKE '%' || regexp_replace(
         lower(p.assessed_owner), '\b(llc|lp|inc|corp|llp|co|ltd|pllc)\b', '', 'gi'
       ) || '%'
 WHERE p.recorded_owner_id IS NULL
   AND p.assessed_owner IS NOT NULL
   AND length(p.assessed_owner) > 5
 LIMIT 5;
```

Pick one, note its `property_id`, manually re-trigger the OM intake
(re-flag the original email in Outlook), then re-query — `recorded_owner_id`
should now be populated.

## If something goes wrong

- Anchor failure: paste the failure label back; codebase may have drifted.
- Recovery before commit: `git restore api/_handlers/intake-promoter.js AUDIT_PROGRESS.md`
- Recovery after commit: `git reset --hard HEAD~1`
