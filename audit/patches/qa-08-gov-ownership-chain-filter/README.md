# QA-08 — Gov `v_ownership_chain` filter shape fix (P0)

**Severity: P0.** Every "Begin Prospecting" click on a gov property
silently emptied `_udCache.chain` because the refresh query used the
wrong filter shape for gov. After clicking the action, the Ownership
tab's chain timeline went blank until the user reloaded the panel.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/qa-08-gov-ownership-chain-filter
node audit/patches/qa-08-gov-ownership-chain-filter/apply.mjs --dry
node audit/patches/qa-08-gov-ownership-chain-filter/apply.mjs --apply
git add -A
git commit -F audit/patches/qa-08-gov-ownership-chain-filter/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/qa-08-gov-ownership-chain-filter -m "Merge audit/qa-08-gov-ownership-chain-filter: gov v_ownership_chain filter shape fix"
git push origin main
```

## What was broken

`v_ownership_chain` has different shapes per domain:

| Domain | Columns relevant to filter |
|---|---|
| dia | `property_id`, `transfer_date`, `from_owner`, `to_owner`, ... |
| gov | `ownership_id`, `lease_number`, `address`, `city`, `state`, `transfer_date`, `from_owner`, `to_owner`, ... — **no `property_id`** |

`detail.js` actually knew this — the main panel fetch at line ~222
already dispatches `gov→lease_number=eq.X` vs `dia→property_id=eq.X`.
But the refresh-after-Begin-Prospecting path at line ~5620 hard-coded
`property_id=eq.X` for both domains, so on gov the request returned:

```
HTTP 400 {
  "error": "Supabase returned 400",
  "detail": "{\"code\":\"42703\",\"message\":
             \"column v_ownership_chain.property_id does not exist\"}"
}
```

Console showed this on every Begin Prospecting click. The
`.catch(() => [])` swallowed the error, so `_udCache.chain` became
`[]` and the Ownership tab re-rendered with no rows.

## Fix

One-block change in `_udOwnerBeginProspecting` (`detail.js`).
Mirrors the existing dispatch at line 222:

```js
const propId   = _udCache?.ids?.property_id   || _udCache?.property?.property_id;
const leaseNum = _udCache?.ids?.lease_number  || _udCache?.property?.lease_number;
const chainFilter = (db === 'gov' && leaseNum)
  ? 'lease_number=eq.' + encodeURIComponent(leaseNum)
  : (propId ? 'property_id=eq.' + propId : null);
if (chainFilter) {
  const chainRes = await qFn('v_ownership_chain', '*',
    { filter: chainFilter, order: 'transfer_date.desc', limit: 50 })
    .catch(() => []);
  _udCache.chain = Array.isArray(chainRes) ? chainRes : (chainRes?.data || []);
}
```

## Verified live

Via Chrome MCP with the deployed v15 Edge Function and a gov property
with `lease_number = 'LDC02050'`:

```js
await window.govQuery('v_ownership_chain', '*',
  { filter: 'lease_number=eq.LDC02050',
    order: 'transfer_date.desc', limit: 50 })
// → { count: 2, data: [
//      { ownership_id: '19be4192…',
//        from_owner: 'Museum Of The Bible, Inc..The',
//        to_owner:   'Woc Llc',
//        transfer_date: '2016-11-01' },
//      …
//    ] }
```

Before the fix: same call with `property_id=eq.{N}` → HTTP 400.

## Files changed

- `detail.js` — one block (~10 lines) in `_udOwnerBeginProspecting`
- `AUDIT_PROGRESS.md` — closeout

## Follow-ups (separate patches)

Still queued from the 2026-05-18 QA pass:
- **P1** "Open Activities" stat conflict (Home vs Pipeline vs Metrics)
- **P1** Sync error count contradicts itself
- **P1** Public REITs + same-entity duplicates in `llc_research_queue`
- **P2** Casing/UX nits

## Optional follow-up: add `property_id` to gov v_ownership_chain

Would make the frontend dispatch unnecessary. Not in this patch
because the dia/gov filter dispatch is already an established pattern
in the codebase (the main fetch at line 222 uses it) and the view
join cost would need profiling. Worth doing as a "uniformity"
cleanup when there's appetite for it.
