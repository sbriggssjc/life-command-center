# QA-16 + QA-17 — Dia financial estimates keyset + Gov ownership-chain fallback

Two P0 findings from the post-QA-15 fresh walkthrough. Bundled because
both are small one-file fixes surfaced by a single Chrome MCP console
read.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/qa-16-17-financial-keyset-and-ownership-chain-fallback
node audit/patches/qa-16-17-financial-keyset-and-ownership-chain-fallback/apply.mjs --dry
node audit/patches/qa-16-17-financial-keyset-and-ownership-chain-fallback/apply.mjs --apply
git add -A
git commit -F audit/patches/qa-16-17-financial-keyset-and-ownership-chain-fallback/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/qa-16-17-financial-keyset-and-ownership-chain-fallback -m "Merge audit/qa-16-17-financial-keyset-and-ownership-chain-fallback"
git push origin main
```

---

## QA-16 — dia `clinic_financial_estimates` statement timeout (P0)

### Symptom (live console)

```
[ERROR] dialysis.js:147
diaQuery clinic_financial_estimates:
  HTTP 500 {"error":"Supabase returned 500",
  "detail":"{\"code\":\"57014\",
  \"message\":\"canceling statement due to statement timeout\"}"}
```

Fires every time the Business page (or any surface that lazy-loads
financial estimates) is opened.

### Root cause

`dialysis.js` lazy-load paginated `clinic_financial_estimates` with
`is_latest=eq.true` in 1000-row pages using **OFFSET**. With 36,538
qualifying rows = 37 pages. OFFSET pagination is O(n²) overall:

| Page | Execution time (EXPLAIN ANALYZE) |
|---|---|
| Page 1 (offset 0) | 53 ms |
| Page 30 (offset 30,000) | **1,356 ms** |
| Page 37 (offset 36,000) | ~1,700 ms |

Each page is independent and one of the later ones exceeded the
authenticated role's `statement_timeout`. The frontend's `count=false`
flag was already set, so this was not a count issue — it was the
OFFSET seek cost.

### Fix

Two parts:

1. **New partial keyset index** —
   `idx_cfe_latest_keyset ON clinic_financial_estimates(estimate_id) WHERE is_latest=true`.
   Without it, Postgres uses the regular PK and filters out ~8K
   non-latest rows per keyset request. With it, keyset scans run
   straight off the partial index.

2. **`dialysis.js` lazy loader switched from OFFSET to keyset pagination.**
   Order by `estimate_id.asc`, pass the previous page's last
   `estimate_id` as `filter2=estimate_id=gt.<id>` on the next request.
   100-iteration safety cap to prevent infinite loop in pathological cases.

### Verified

```
EXPLAIN ANALYZE SELECT … FROM clinic_financial_estimates
                WHERE is_latest=true AND estimate_id > 100000
                ORDER BY estimate_id ASC LIMIT 1000
```

| | Before keyset | After keyset (no index) | After keyset (with index) |
|---|---|---|---|
| Execution | 1,356 ms | 650 ms | **4.5 ms** |

Total page-load time across the 37 pages drops from ~24 seconds
(and frequently timing out) to ~170 ms.

---

## QA-17 — second `v_ownership_chain` caller still using `property_id` on gov (P0)

### Symptom (live console)

```
[ERROR] gov.js:121
govQuery v_ownership_chain:
  HTTP 400 {"error":"Supabase returned 400",
  "detail":"…column v_ownership_chain.property_id does not exist…"}
```

Still fires on every gov property detail panel open even after
QA-08 merged. That patch fixed `_udOwnerBeginProspecting` (line ~5620)
but missed a second caller at line ~228 in the main fetch path.

### Root cause

`detail.js` line 228:
```js
const chainFilter = leaseNumber
  ? `lease_number=eq.${encodeURIComponent(leaseNumber)}`
  : mainFilter;                    // ← falls back to property_id=eq.X
```

When the gov property record has no `lease_number` available
(common — only ~50% of gov properties are GSA-leased), the fallback
sent `property_id=eq.X` to `v_ownership_chain`, which 400s on gov.

### Fix

On gov, **no fallback** — skip the chain fetch entirely when
`lease_number` is missing. No useful chain rows are available for
a non-leased gov property anyway, so returning `{ data: [], count: 0 }`
is the right result.

```js
if (db === 'gov') {
  if (leaseNumber) {
    const chainFilter = `lease_number=eq.${encodeURIComponent(leaseNumber)}`;
    promises.push(qFn('v_ownership_chain', '*', { filter: chainFilter, … }));
  } else {
    promises.push(Promise.resolve({ data: [], count: 0 }));
  }
}
```

Dia path unchanged.

---

## Files changed

- `supabase/migrations/dialysis/20260518170000_dia_qa16_cfe_latest_keyset_index.sql`
- `dialysis.js` — `clinic_financial_estimates` lazy-loader switched to keyset
- `detail.js` — gov chain fetch falls back to empty array instead of property_id
- `AUDIT_PROGRESS.md` (closeout)

Migration applied live via Supabase MCP on 2026-05-18.
