# Claude Code prompt — QA#1: portfolio price bleed-through (source fix)

Paste the block below into Claude Code, run from the **life-command-center** repo.
It also contains SQL migrations to apply to the **Dialysis_DB** and **Government**
Supabase projects (Claude Code can apply them, or run them yourself).

---

## Context (verified 2026-06-03, do not re-investigate from scratch)

CoStar sidebar captures write a **portfolio's aggregate sale price onto every
constituent property** as that property's `sold_price`, with no per-property
allocation. Result: implausible per-property prices that pollute the Next Best
Action list, property value, and cap-rate math.

- Dialysis median sale = **$2.98M**. Bleed clusters found (identical
  `sold_price` + `sale_date` across multiple distinct `property_id`):
  - dia: **$950M × 5 properties** (2023-09-12), $25.1M × 2, $22.5M × 2
  - gov: $379.5M × 2 (2017-02-21), $142M × 2, $119.08M × 2
- All are classified `transaction_type='Investment'` — the existing
  `classifySaleType` "Portfolio" branch only triggers on the literal word
  "portfolio" in notes, and these rows have **empty notes**, so it misses them.
- `exclude_from_market_metrics` is set on **4 of 5** $950M rows but is
  **never read by any consumer** — grep shows it is only written (in
  `classifySaleType`), never filtered on. It is a dead flag.
- The NBA value comes from the `v_next_best_action` view (one per domain DB),
  whose `gap_value` derives from the latest sale's `sold_price`. It ignores
  `exclude_from_market_metrics`, so $950M shows as the property "value."

The reliable bleed signature is: **the same `sold_price` (> ~10× domain median)
appears with the same `sale_date` on more than one distinct `property_id`.**
A genuine single-property sale never shares an identical price+date with a
different property.

## Task — three layers, smallest-risk first

### 1. Make `exclude_from_market_metrics` a live flag (consumption fix)
In the **Dialysis_DB** and **Government** Supabase projects, update the
`v_next_best_action` view so any sale with `exclude_from_market_metrics = true`
**OR** `sold_price IS NULL` does not contribute its `sold_price` to `gap_value`
/ property value. (Read the current view def first with
`pg_get_viewdef('public.v_next_best_action'::regclass, true)` — preserve every
other column and the `gap_priority_score` logic; only change how the value is
sourced.) Do the same anywhere cap-rate/comps derive value from `sold_price`
(check the dia + gov cap-rate frameworks). Add this as idempotent migrations in
`DialysisProject/sql/` and `GovernmentProject/sql/` (follow each repo's existing
migration naming).

### 2. Backfill the existing bleed rows (data fix, idempotent)
Migration on **both** domain DBs. Null the per-property price on bleed-signature
rows, set the exclude flag uniformly, and preserve the aggregate in notes:

```sql
WITH bleed AS (
  SELECT sold_price, sale_date
  FROM   public.sales_transactions
  WHERE  sold_price IS NOT NULL
    AND  sold_price > 20000000          -- dia; use 60000000 for gov
  GROUP  BY sold_price, sale_date
  HAVING count(DISTINCT property_id) > 1
)
UPDATE public.sales_transactions s
SET    exclude_from_market_metrics = true,
       notes = left(coalesce(s.notes,'')
              || ' [DQ 2026-06-03: per-property price '
              || to_char(s.sold_price,'FM$999,999,999')
              || ' nulled — multi-property/portfolio aggregate bled through CoStar'
              || ' sidebar; not a valid single-property sale price]', 2000),
       sold_price = NULL,
       sold_price_psf = NULL
FROM   bleed b
WHERE  s.sold_price = b.sold_price AND s.sale_date = b.sale_date
  AND  s.sold_price IS NOT NULL;       -- idempotent: skip already-nulled rows
```
(`sold_price_psf` exists on dia; drop that line for gov if the column is absent.
RHS references the OLD row values, so `notes` captures the price being nulled.)

### 3. Guard ingestion so it can't recur (prevention fix)
In `api/_handlers/sidebar-pipeline.js`, inside `upsertDomainSales` (the price is
parsed at `const soldPrice = parseCurrency(sale.sale_price);` ~line 4579, written
into `saleData.sold_price` ~line 4813):

Before writing, detect the bleed signature and refuse to store an aggregate as a
per-property price:
- If a sale row for a **different** `property_id` already exists with the **same
  `sold_price` and `sale_date`** (query `sales_transactions` for that price+date,
  excluding the current property), treat this as a portfolio aggregate: set
  `sold_price = null`, `exclude_from_market_metrics = true`, and append a
  `[portfolio-aggregate]` note. Log `[sale-price-bleed] property=… price=…`.
- Also soft-guard on magnitude: if `soldPrice` exceeds a per-domain ceiling
  (dia: 50_000_000; gov: 250_000_000), set `exclude_from_market_metrics = true`
  and note it for human review (do NOT auto-null on magnitude alone — large gov
  buildings are legitimately expensive; magnitude is a flag, the duplicate
  price+date signature is the auto-null trigger).
- Mirror the existing `isJunkTenant`-style defensive pattern and keep the regex/
  thresholds as named constants near the top of the file.

## Verify + ship
- `node --check api/_handlers/sidebar-pipeline.js`; run `python -m pytest` / the
  repo's JS tests if present. Add a unit test that a second property with an
  identical price+date gets `sold_price` nulled + flagged.
- Function count unchanged (this is a `_handlers` edit, not a new `api/*.js`).
- After the view migrations + backfill, re-query: the dia NBA must no longer show
  the $950M rows, and `SELECT max(sold_price) FROM sales_transactions` should be a
  plausible single-property figure (well under $100M for dia).
- Branch `claude/qa1-portfolio-price-bleed-<sessionId>`; end with the merge +
  deploy commands per repo convention.
```
