# Claude Code prompt — T9e: repair the 413 dangling property_sale_events → sales_transactions pointers + prevent recurrence

> Surfaced during T9d (CC repaired one, `5701`). `property_sale_events.sales_transaction_id` has **413**
> pointers to `sales_transactions` rows that no longer exist (deleted during the prior sale-cleanup that
> bulk-removed ~350 unrecoverable rows, without nulling the referencing pointers). This is the
> `fn_listing_close_if_sold` landmine's cousin — dangling FKs break the close-on-sale path + any sale-event
> join. Bounded, reversible, high-certainty cleanup + a forward guard so it can't recur. dia
> `zqzrriwuavgrquhisnoa`. Reversible (backup); ≤12 api/*.js.

## Receipts (grounded live 2026-06-27)
`property_sale_events` (2,734 rows; cols incl. own `sale_date`, `price`, `buyer/seller/broker_name`, `source`,
`sales_transaction_id`, `ownership_history_id`). **413** rows have a `sales_transaction_id` with no matching
`sales_transactions.sale_id`. All carry their own `price` (395/413) — the events have independent data; only
the pointer is broken. 0 carry an `ownership_history_id`. Breakdown:
- **86** uniquely re-linkable — exactly ONE `sales_transactions` row on the same `property_id` within 31d of
  the event's `sale_date`.
- **103** ambiguous — multiple candidate sales on the property within 31d.
- **224** no event `sale_date` (all have a `price`) — can't date-match; the referenced sale is genuinely gone.
- 0 dated events with no candidate (every dated event has ≥1 candidate).

## Unit 1 — re-link the 86 unique matches
Repoint `sales_transaction_id` to the single matching `sales_transactions.sale_id` (same `property_id`,
`abs(sale_date - event.sale_date) <= 31`). **Guard:** only re-link when the candidate sale's price is
consistent with the event's `price` (within a tolerance, e.g. ±2%) OR the event price is null — do not link a
price-mismatched sale. Report any skipped on price mismatch.

## Unit 2 — re-link the 103 ambiguous via tiebreak, else null+flag
Among the multiple candidates, pick the sale that (a) matches the event `price` within tolerance AND (b) is
closest in date; break further ties with `buyer_name`/`seller_name` match. If exactly one candidate clears the
price+name test, re-link it. If none/2+ remain ambiguous, **null** `sales_transaction_id` and flag
(`notes`/a `t9e_review` marker) for optional manual review — do NOT guess a link.

## Unit 3 — null the 224 no-date orphans
Their referenced sale was deleted and there's no date to match. **Null** `sales_transaction_id` (keep the event
row + its own `price`/buyer/seller data — do NOT delete the events; they're the surviving record of the sale
event). Flag in `notes` that the linked txn was purged.

## Unit 4 — prevent recurrence (forward-safe)
Add a real FK `property_sale_events.sales_transaction_id → sales_transactions(sale_id) ON DELETE SET NULL`
(after the cleanup leaves 0 dangling, so the constraint can be created/validated). Then a future
`sales_transactions` delete nulls the pointer instead of orphaning it. If a hard FK is too strict for the
ingest path, a delete-trigger that nulls referencing pointers is an acceptable equivalent — state which.

## Unit 5 — verify the close-on-sale path tolerates this
Confirm `fn_listing_close_if_sold` (hardened in T9d Unit 4) no longer trips on a dangling/null
`sales_transaction_id` (it should match on `property_id`+`sale_date`, not a raw FK deref). Re-run a synthetic
sale on a test property to confirm no crash; clean up (0 residue).

## Gate (verify live)
- **0** dangling `property_sale_events.sales_transaction_id` (none pointing to a non-existent sale).
- 86 re-linked (price-guarded); the 103 ambiguous re-linked-where-confident else nulled+flagged; 224 nulled
  (events retained with their data). Report the final re-linked / nulled / flagged counts.
- FK `ON DELETE SET NULL` (or equivalent guard) in place; a test sale-delete nulls the pointer, doesn't orphan.
- `fn_listing_close_if_sold` synthetic test passes (0 residue). Reversible (backup table `t9e_*`); idempotent;
  dia only; ≤12 api/*.js. No `sales_transactions` or listing rows altered (this is property_sale_events
  pointer hygiene only).

## Boundaries
- Pointer hygiene + a forward guard only — re-link to a REAL matching sale (price-guarded) or null; never
  fabricate a sale or a link, never delete an event that carries its own data. The events' own
  price/buyer/seller data is preserved throughout.
