# Item #4 Phase B-2 — cross-domain endpoint for `v_next_best_action`

**Branch:** `audit/04-next-best-action-phase-b2`

## What this lands

A single HTTP endpoint that fans out to both domain DBs, merges, re-ranks,
and returns the unified next-best-action queue. ~80 lines of JS in admin.js.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/04-next-best-action-phase-b2

node audit/patches/04-next-best-action-phase-b2/apply.mjs --dry
node audit/patches/04-next-best-action-phase-b2/apply.mjs --apply

git status
git diff --stat
node -c api/admin.js

git add -A
git commit -F audit/patches/04-next-best-action-phase-b2/COMMIT_MSG.txt

git checkout main
git merge --no-ff audit/04-next-best-action-phase-b2 -m "Merge audit/04-next-best-action-phase-b2: cross-domain endpoint"
git push origin main
```

## Try it (after deploy)

```bash
# Top 10 unified gaps across both domains
curl -H "X-LCC-Key: $LCC_API_KEY" \
  "https://tranquil-delight-production-633f.up.railway.app/api/admin?_route=next-best-action&limit=10"

# Just critical gaps
curl -H "X-LCC-Key: $LCC_API_KEY" \
  "https://tranquil-delight-production-633f.up.railway.app/api/admin?_route=next-best-action&severity=critical&limit=20"

# Just CMS chain transitions on dia
curl -H "X-LCC-Key: $LCC_API_KEY" \
  "https://tranquil-delight-production-633f.up.railway.app/api/admin?_route=next-best-action&domain=dia&gap_type=cms_chain_drift:operator_transition_candidate"
```

Expected `total_merged` is in the 30,000s once both views are live.

## Phase B-3 (deferred)

Build `v_next_best_action_ops` on LCC Opps adding gap sources native to
that DB (provenance conflicts, inbox triage, health alerts). Then extend
this handler to also fetch from LCC Opps via opsQuery.

## Phase C (deferred)

Home rail UI in `app.js` calling this endpoint and rendering the merged
top-20 ranked gaps.
