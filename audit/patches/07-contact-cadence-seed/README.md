# Item #7 — Seed cadence + inbox triage on new contacts

**Closes:** D-2, partial D-6.
**Branch:** `audit/07-contact-cadence-seed`
**Priority:** CRITICAL

## What this patch does

Adds a hook in `unpackContacts` so that every newly-created person entity
from a CoStar sidebar capture immediately gets:
- A `touchpoint_cadence` row initialized at touch 0 (via `getCadenceState`)
- An `inbox_items` row with `source_type='new_contact_qualify'` for triage

Both writes are wrapped in try/catch and never roll back the upstream
sidebar work. Re-captures of existing brokers produce no new rows.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git branch --show-current   # expected: audit/07-contact-cadence-seed

node audit/patches/07-contact-cadence-seed/apply.mjs --dry
node audit/patches/07-contact-cadence-seed/apply.mjs --apply

git status
git diff --stat
node -c api/_handlers/sidebar-pipeline.js

git add -A
git commit -F audit/patches/07-contact-cadence-seed/COMMIT_MSG.txt
git log --oneline -3
```

Merge sequence (same pattern as prior items):
```powershell
git checkout main
git merge --no-ff audit/07-contact-cadence-seed -m "Merge audit/07-contact-cadence-seed: seed cadence + inbox triage on new contacts"
git push origin main
```

## Smoke test (after deploy)

1. In Chrome, capture a CoStar listing for a property with brokers you've
   never seen before in your contact database.
2. Run on LCC Opps SQL (~1-2 min after capture):

```sql
SELECT id, title, source_type, entity_id, metadata->>'role' AS role,
       metadata->>'contact_email' AS email, created_at
FROM inbox_items
WHERE source_type = 'new_contact_qualify'
  AND created_at > now() - interval '15 minutes'
ORDER BY created_at DESC;

SELECT entity_id, current_touch, phase, priority_tier, next_touch_due
FROM touchpoint_cadence
WHERE current_touch = 0
  AND created_at > now() - interval '15 minutes'
ORDER BY created_at DESC;
```

Both should return one row per new broker captured.

3. Re-capture the same listing. Re-run the queries — no new rows should appear
   (the cadence row already exists, so `cadenceRes.is_new === false` skips
   the inbox POST).
