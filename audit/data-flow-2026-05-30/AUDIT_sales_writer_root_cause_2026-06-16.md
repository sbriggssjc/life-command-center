# Audit — root cause of the duplicate / placeholder rows inflating market counts (2026-06-16)

R36 filters bad rows out of the METRICS. This is the source fix: stop the writers from
creating them, and consolidate what exists, so the DB itself is the accurate market picture.

## The gov `sales_transactions` state machine (live)
| transaction_state | rows | priced | created last 30d | newest | verdict |
|---|---|---|---|---|---|
| **live** | 5,456 | 5,456 | 2,905 | today | real sales — healthy |
| **needs_review** | 5,181 | **0** | **3,951** | **today** | ACTIVE bug — price-less placeholders |
| ownership_stub | 3,313 | 17 | 0 | 2026-03-27 | legacy placeholder mechanism (retired) |
| duplicate_superseded | 732 | 732 | 335 | today | dedup running — but cleanup-after, not prevent-at-write |

## Root cause #1 (ACTIVE, biggest) — sidebar mints price-less sale rows on every re-capture
The CoStar sidebar sales writer (`api/_handlers/sidebar-pipeline.js::upsertDomainSales`,
`data_source='costar_sidebar'`) writes a `sales_transactions` row with **no `sold_price`**
(state `needs_review`) — and does it **again on every re-capture of the same property**:
- 5,181 price-less needs_review rows, **3,951 created in the last 30 days**, newest TODAY.
- **4,454 (86%) are on a property that ALREADY has a `live` priced sale** → pure redundant
  noise.
- Only **767 distinct properties** behind 5,181 rows ≈ **6.8 price-less rows per property**.
So re-capturing a property's page (which references a sale but no closed price, or where the
price didn't extract) mints a NEW row each time — no idempotency key, no "skip when no price",
no "match the existing sale." This is the dominant ongoing count inflation (the CM ~10× /
overview 126-vs-61). Shared writer ⇒ **dia has the same bug** (dia sold-TTM cm-def 253 vs
canonical 167).

## Root cause #2 (LEGACY, frozen) — ownership-change placeholder "sales"
`data_source='ownership_change_stub'` / `_spe_rename` wrote a placeholder `sales_transactions`
row (state `ownership_stub`, no price) for every ownership change / SPE rename — 3,313 rows,
**0 in the last 30 days (stopped 2026-03-27)**. The mechanism appears retired but the rows
remain and inflated the all-time CM count. Confirm no code path still calls it; the
"placeholder sale per ownership change" pattern should be gone for good.

## Root cause #3 — dedup is cleanup-after, not prevent-at-write
`duplicate_superseded` = 732 priced rows, 335 in the last 30 days — the dedup IS running and
catching duplicates, but the fact that ~335/month are still being CREATED then superseded
means the upsert isn't idempotent on a natural key: it INSERTs a new row then a separate pass
supersedes it. Prevent-at-write (match property_id + sale_date + price and UPDATE) is cleaner
and removes the superseded churn.

## The fix doctrine (consolidate / merge / dedup at the source)
1. **Don't mint a transaction without a real sale.** A price-less page reference is not a
   transaction. The sidebar writer should: skip writing a `sales_transactions` row when
   there's no `sold_price` AND the property already has a live priced sale (the 86% case);
   for a genuinely-new price-less sale reference, hold it in a staging/enrichment lane, not
   the live transactions table.
2. **Idempotency / upsert on a natural key** (property_id + sale_date [+ price band]) so
   re-capture UPDATEs the existing row instead of inserting a duplicate — kills both the
   6.8×-per-property placeholder pile AND the superseded churn (prevent-at-write).
3. **Retire the ownership-stub pattern** for good (confirm no caller) — ownership changes
   belong in `ownership_history`, never as placeholder sales.
4. **Consolidate the existing backlog (reversible/snapshot):** supersede/discard the 4,454
   redundant-with-live needs_review rows + the 3,313 legacy ownership_stub rows; the ~663
   price-less needs_review on properties with NO live sale are potentially the only record of
   a real sale → route to review/enrich (do NOT blind-delete). After cleanup, the DB matches
   the canonical metrics (R36) instead of relying on the filter to hide noise.

## Why it matters
R36 made the NUMBERS correct by filtering; R37 makes the DATA correct so the filter is
belt-and-suspenders, the table stops growing ~4k junk rows/month, and every consumer
(including anything that reads sales_transactions directly) sees the true market. → R37 prompt.
