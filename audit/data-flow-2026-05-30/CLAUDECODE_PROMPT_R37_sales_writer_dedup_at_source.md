# Claude Code — R37: fix the sales-transaction writers at the source (stop minting placeholders/dupes)

## Why (root-cause audit, live 2026-06-16 — see AUDIT_sales_writer_root_cause_2026-06-16.md)
R36 filtered the bad rows out of the METRICS. R37 fixes the DATA so they stop being created.
Live gov `sales_transactions`: `needs_review` = 5,181 rows, **ALL price-less, 3,951 created in
the last 30 days, newest today** — the CoStar sidebar mints a NEW price-less "sale" row on
every re-capture of a property (only 767 distinct properties ⇒ ~6.8 rows/property; **86% are
on a property that already has a real `live` priced sale**). Plus 3,313 legacy
`ownership_stub` placeholders (retired writer) and 732 `duplicate_superseded` (dedup runs
cleanup-after, not prevent-at-write, ~335/mo). Shared writer ⇒ **dia has the same bug.**

## Unit 1 — sidebar sales writer: don't mint placeholders; upsert idempotently (the core fix)
In `api/_handlers/sidebar-pipeline.js::upsertDomainSales` (applies to BOTH dia + gov):
- **No price + property already has a live priced sale ⇒ do NOT insert a row.** This kills the
  86% redundant case at the source.
- **No price + genuinely new (no live sale for the property) ⇒ do not write it to
  `sales_transactions` as a transaction.** Route it to a staging/enrichment lane (or skip
  with a logged counter). A price-less page reference is not a closed transaction. (If a
  lightweight "pending sale, awaiting price" record is genuinely wanted, it goes in a
  separate staging table, never the live transactions table that feeds metrics/CM.)
- **Idempotency / upsert on a natural key.** Match an existing sale by
  `(property_id, sale_date [+ sold_price band])` and UPDATE in place instead of INSERT — so
  a re-capture never creates a second row. This eliminates both the placeholder pile AND the
  insert-then-supersede churn (prevent-at-write replaces the 335/mo `duplicate_superseded`).
- Respect the existing `sales_transactions.sale_date NOT NULL` constraint and the cap-rate
  triggers — don't regress those.

## Unit 2 — retire the ownership-stub placeholder pattern for good
`data_source='ownership_change_stub'` / `_spe_rename` (0 rows in 30d — appears retired).
Confirm NO code path still writes a placeholder `sales_transactions` row on an ownership
change / SPE rename (search gov + dia + LCC writers). Ownership changes belong in
`ownership_history` only. If any caller remains, remove it.

## Unit 3 — consolidate the existing backlog (reversible, classify don't blind-delete)
A one-time, snapshot-backed (mirror R22's `*_deletions` reversible pattern) cleanup on gov + dia:
- **Redundant-with-live** (price-less needs_review on a property that has a `live` priced sale
  — 4,454 gov): supersede/remove (snapshot first). Pure noise.
- **Legacy `ownership_stub`** (3,313 gov): supersede/remove (snapshot first) — the mechanism
  is retired.
- **Orphan price-less** (needs_review on a property with NO live sale — ~663 gov): **do NOT
  delete** — these may be the only record of a real sale awaiting a price. Route to a review/
  enrich lane (or a Decision Center "price this sale" item). Preserve them.
- After: the DB matches the R36 canonical metrics directly (filter becomes belt-and-suspenders,
  not load-bearing), and the table stops growing ~4k junk rows/month.

## Guards / house rules
- Shared writer change is dia+gov — verify both. Reuse the existing dedup/upsert helpers; don't
  fork. Reversible/snapshot for the one-time cleanup (no blind deletes; orphan price-less
  preserved). Respect `sale_date NOT NULL` + cap-rate triggers + field-provenance.
- ≤12 LCC `api/*.js`. `node --check`; suite green. The cleanup is a migration/script applied
  to dia + gov; the writer fix ships on the Railway redeploy.
- **CM interplay:** R36's canonical filters already exclude these, so the cleanup doesn't
  change the canonical/published numbers — it makes the raw table agree with them. (The R36 CM
  cutover is still separately gated.)

## Verify live (after deploy + cleanup)
- A re-capture of an already-captured property creates **no** new `sales_transactions` row.
- `needs_review` price-less count stops growing (≈0 new/day from the sidebar).
- `duplicate_superseded` creation rate drops toward 0 (prevent-at-write).
- gov live priced sales unchanged (~5,456); redundant/stub rows snapshotted + removed; orphan
  price-less preserved in the review lane.

## Bottom line
The duplicates and placeholders aren't a metric artifact — they're an un-idempotent sidebar
writer minting a price-less row per re-capture plus a retired stub pattern. R37 makes the
ingestion consolidate/merge/dedup at write time and cleans the backlog reversibly, so the
database itself is the most accurate market picture — not a noisy table hidden behind a filter.
