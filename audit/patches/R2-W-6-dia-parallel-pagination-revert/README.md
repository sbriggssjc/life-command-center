# R2-W-6 — diaQueryAll parallel pagination revert

**Branch:** `audit/r2-w-6-dia-parallel-pagination-revert` (off `origin/main`)
**Closes:** R2-W-6 (HIGH) from `audit/ROUND_2_FINDINGS_2026-05-19.md`

## What this does

Reverts `diaQueryAll` (in `dialysis.js`) from QA-27's parallel
`Promise.all`-pagination back to a serial while-loop with a 120s timeout
fuse. Mirrors QA-33's gov revert. Closes the perf-cliff risk that QA-33's
closeout explicitly called out as still-pending on dia.

## How to apply

The replacement to `dialysis.js` was already performed by the Cowork session
that produced this patch (Python-via-bash because the file is >500 KB, per
`audit/SANDBOX_TOOLING_NOTES.md`). The apply.mjs verifier confirms the
revert is in place and appends the closeout block:

```bash
node audit/patches/R2-W-6-dia-parallel-pagination-revert/apply.mjs
node audit/patches/R2-W-6-dia-parallel-pagination-revert/apply.mjs --apply
```

If for any reason `dialysis.js` reverted (e.g. someone re-applied an old
copy), here is the Python edit to re-do it:

```python
PATH = 'dialysis.js'
with open(PATH, 'r') as f: src = f.read()
OLD = '''// QA-27 (2026-05-18): parallel pagination — mirror of QA-26's govQueryAll
// fix. First page fetched with includeCount=true; remaining pages issued in
// parallel via Promise.all. For full-table reads (medicare_clinics 8.5k rows,
// true_owners 3.4k, etc.) this turns N sequential round-trips into 1 +
// parallel batch. Wall-clock drops from N × ~400ms to first + slowest_parallel
// (~800ms-1.2s regardless of N).
async function diaQueryAll(table, select, params = {}) {
  const pageSize = 1000;
  const firstPage = await diaQuery(table, select, { ...params, limit: pageSize, offset: 0, includeCount: true });
  const firstData = firstPage.data || [];
  const total = firstPage.count || firstData.length;
  if (total <= pageSize) return firstData;
  const pages = [];
  for (let off = pageSize; off < total; off += pageSize) {
    pages.push(diaQuery(table, select, { ...params, limit: pageSize, offset: off }));
  }
  const others = await Promise.all(pages);
  let all = firstData;
  for (const rows of others) all = all.concat(rows || []);
  return all;
}'''
NEW = '''// R2-W-6 (2026-05-19): reverted to serial pagination. QA-27's parallel fix
// (mirror of QA-26's govQueryAll) caused the same perf cliff that QA-33
// just rolled back on gov: ~N concurrent HTTP requests at page-load
// overwhelm Vercel/Supabase/browser. dia tables are smaller than gov
// (medicare_clinics 8.5k, true_owners 3.4k) so the regression is less
// dramatic, but the failure mode is identical when dashboards stack
// multiple diaQueryAll calls in Promise.all. Going back to one-at-a-time
// pagination — slower but predictable. A throttled-parallel approach
// (concurrency=4) is the better long-term fix; deferred for both gov + dia.
// Callers that need a true count (e.g. v_prospect_targets) keep using
// diaQuery directly with includeCount=true — that single call is fine.
async function diaQueryAll(table, select, params = {}) {
  let all = [];
  let offset = 0;
  const pageSize = 1000;  // PostgREST max-rows cap
  const maxTime = 120000; // 2-minute total timeout fuse
  const start = Date.now();
  while (true) {
    if (Date.now() - start > maxTime) {
      console.warn('diaQueryAll(' + table + ') total timeout after ' + Math.round((Date.now() - start) / 1000) + 's — returning ' + all.length + ' rows');
      break;
    }
    const rows = await diaQuery(table, select, { ...params, limit: pageSize, offset });
    all = all.concat(rows || []);
    if (!rows || rows.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}'''
assert OLD in src and src.count(OLD) == 1
with open(PATH, 'w') as f: f.write(src.replace(OLD, NEW))
```

After running the Python edit, verify integrity:

```bash
wc -l dialysis.js    # should be ~10,936 lines
tail -3 dialysis.js  # should end with a valid closing brace
```

Then run `apply.mjs --apply` to write the closeout block.

## Verification (post-apply)

```bash
grep -c "R2-W-6 (2026-05-19)" dialysis.js   # 1
grep -c "Promise.all(pages)" dialysis.js     # 0
```

In the browser: open the dia dashboard, watch the network tab. Pagination
should stack sequentially, no burst of 8+ concurrent `/api/dia-query` calls
on cold load. The QA-29 Unprospected Owners modal should still read 532 (it
uses `diaQuery` with `includeCount=true` directly, untouched by this revert).

## Rollback

Re-run the Python edit with OLD and NEW swapped. Note: the only reason to
roll back is if the serial perf is intolerable AND the throttled-parallel
follow-up isn't ready yet. The QA-33 closeout established that parallel-
pagination is a known cliff.

## Closes / blocks

- Closes: **R2-W-6** (HIGH)
- Captures: throttled-parallel (concurrency=4) follow-up for both
  `govQueryAll` and `diaQueryAll`. See the closeout's "Out of scope" section.

## Files

- `dialysis.js` — diaQueryAll body replaced (function at line 174)
- `audit/patches/R2-W-6-dia-parallel-pagination-revert/apply.mjs`
- `audit/patches/R2-W-6-dia-parallel-pagination-revert/README.md`
- `audit/patches/R2-W-6-dia-parallel-pagination-revert/COMMIT_MSG.txt`
- `audit/ROUND_2_FINDINGS_2026-05-19.md` (closeout block appended by apply.mjs)
