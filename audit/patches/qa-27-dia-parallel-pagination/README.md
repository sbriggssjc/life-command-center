# QA-27 — Dia parallel pagination + diaQuery count opt-in (P1 perf)

**Severity: P1 perf.** Mirror of QA-26's gov fix. The dia home dashboard
had the same serial-pagination problem — `diaQueryAll` fetched 1000-row
pages one after another instead of in parallel. Couldn't be fixed without
first refactoring `diaQuery`, which hardcoded `count=false` in its URL
builder and therefore couldn't surface the Content-Range total.

## Apply

```powershell
cd C:\Users\scott\life-command-center
git checkout -b audit/qa-27-dia-parallel-pagination
node audit/patches/qa-27-dia-parallel-pagination/apply.mjs --dry
node audit/patches/qa-27-dia-parallel-pagination/apply.mjs --apply
git add -A
git commit -F audit/patches/qa-27-dia-parallel-pagination/COMMIT_MSG.txt
git checkout main
git merge --no-ff audit/qa-27-dia-parallel-pagination -m "Merge audit/qa-27-dia-parallel-pagination"
git push origin main
```

## Three changes

### 1. `diaQuery` — opt-in count via `includeCount: true`

Previously: `count=false` was hardcoded into the URL. The legacy comment
correctly noted that views compute from 1M+ row tables and count=exact
doubles query cost — so the default still skips count.

New: callers can pass `includeCount: true`. When true:
- The URL builder no longer forces `count=false` (Edge Function default = count=exact)
- The function returns `{ data, count }` instead of just `data`

Every existing call site keeps its old behavior (no `includeCount`
key = same array return, same `count=false` query).

### 2. `diaQueryAll` — parallel pagination

Same fix as QA-26's `govQueryAll`. First page fetched with
`includeCount: true`, remaining pages issued via `Promise.all`.

Live dia table sizes touched by `diaQueryAll`:

| Table              | Rows    | Pages @ 1000 | Serial cost |
|--------------------|--------:|-------------:|------------:|
| medicare_clinics   |   8,535 |            9 |     ~3.6 s  |
| ownership_history  |  12,310 |           13 |     ~5.2 s  |
| true_owners        |   3,422 |            4 |     ~1.6 s  |
| salesforce_activities (filtered) | ~varies | varies | varies |

Wall-clock drops from N × ~400 ms serial to first + parallel batch ≈ ~800 ms regardless of N.

### 3. Ownership coverage block parallelized

The dia ownership-coverage widget on the home dashboard awaited
`ownership_history` THEN `true_owners` THEN (conditional on
ownersWithSF) `salesforce_activities` serially. Now the first two run
via `Promise.all`. The third still depends on the result of the first
two so it stays sequential.

### Bonus: QA-25 widget now uses real count

The QA-25 dia "Unprospected Owners" widget's denominator was previously
capped at limit=250 because diaQuery only returned the row array. With
`includeCount: true` available, the widget now reports the **true total
of 532** unprospected owners instead of the truncated 250.

## Expected speedup (dia home dashboard)

| Phase                        | Before    | After     |
|------------------------------|----------:|----------:|
| loadDiaData top-level Promise.all | ~3–5 s | ~1–2 s |
| Ownership coverage widget    | ~8–12 s   | ~1–2 s    |

The dia loadDiaData was already Promise.all'd at the top level (better
than gov was), but the inner serial pagination of
`v_clinic_inventory_latest_diff` (the slowest member of that Promise.all)
was the actual bottleneck. With parallel pagination, all members of
the top-level Promise.all finish in roughly the same time.

## Backward compatibility

`diaQuery` continues to return an array by default — no existing call
site changes behavior. Only `diaQueryAll` (which now opts in internally)
and the QA-25 widget call (now explicitly opts in) get the envelope.

## Files changed

- `dialysis.js` — `diaQuery` (count opt-in), `diaQueryAll` (parallel),
  ownership-coverage block (Promise.all), QA-25 widget (uses count)
- `AUDIT_PROGRESS.md` (closeout)

No SQL changes. No Edge Function changes. No allowlist changes.
