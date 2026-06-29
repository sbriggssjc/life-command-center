# Claude Code (GovernmentProject) — ORE Unit F: fix the backfill selector (NULL-source excludes every row)

## Why (live dry-run 2026-06-29)

The first `python -m src.sos_detail_fetcher --states FL,AZ --limit 50` dry-run
returned **`scanned: 0`** — it never reached the SOS sites. Root cause is a SQL
NULL footgun in the backfill selector, not the fetchers:

The selector filters `source=neq.sos_direct` (PostgREST). But the
`entity_registry_records.source` column was just added and is **NULL on all rows**
(0 `sos_direct` yet). In SQL, `NULL <> 'sos_direct'` evaluates to NULL (not true),
so a `neq` filter **excludes every NULL row** → 0 matches.

Verified live on gov (`scknotsqkcheojiaewwh`):
- FL+AZ total = **902**, all 902 `source IS NULL`.
- `source <> 'sos_direct'` matches **0** (the bug).
- `source IS NULL OR source <> 'sos_direct'` matches **902** (the fix).

## The fix (one line)

In `src/sos_detail_fetcher.py`, the backfill candidate query: replace the
`source=neq.sos_direct` filter with a NULL-inclusive form so already-NULL
(un-fetched / AI-inferred) rows are eligible and only true `sos_direct` rows are
skipped. PostgREST:
```
# was:  ...&source=neq.sos_direct
# use:  ...&or=(source.is.null,source.neq.sos_direct)
```
(Equivalently, build the filter so the intent — "rows NOT already sos_direct,
including NULLs" — holds; the `or=(source.is.null,source.neq.sos_direct)` form is
the idiomatic PostgREST way.) Keep the rest of the selector (state filter, limit,
the idempotent skip of `source='sos_direct'`) unchanged — the skip still works once
rows start getting tagged.

## Verify

- Add/extend a unit test asserting the candidate filter includes a NULL-source row
  and excludes a `sos_direct` row (so this NULL footgun can't regress).
- `python -c "import src.sos_detail_fetcher"`; `pytest tests/unit/test_sos_detail_fetcher.py -q`.
- The real proof is Scott's re-run of the live dry-run:
  `python -m src.sos_detail_fetcher --states FL,AZ --limit 50` should now report
  `scanned: 50` (not 0) and begin exercising the FL Sunbiz / AZ eCorp fetchers —
  which is where the actual live URL/markup validation finally happens.

## Bottom line

One NULL-comparison fix in the backfill selector — the column is all-NULL, so
`neq` matched nothing. After the fix the dry-run scans the 902 FL/AZ rows and we
get our first real look at live SOS fetch behavior.
