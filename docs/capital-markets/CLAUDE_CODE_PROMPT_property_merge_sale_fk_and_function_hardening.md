# Claude Code prompt — property-merge FK fix (commit + dia parity) + harden the merge function

> Scott hit a 500 in the Decision Center `property_merge` lane consolidating a GSA
> Tallahassee duplicate (keep vs drop 23343):
> `merge_failed 23503: update or delete on sales_transactions violates FK
> available_listings_sale_transaction_id_fkey — Key (sale_id)=(0f97d6b5…) still
> referenced from available_listings`. Root-caused live by the gate; the gov FK fix is
> ALREADY APPLIED LIVE (verified). This prompt makes it durable in the repo, fixes the
> identical dia gap, and hardens the merge function so the failure mode can't recur fatally.

## Root cause (confirmed)
`gov_merge_property(p_keep_id, p_drop_id)` loops every FK that references `properties`,
re-points each child's `property_id` from drop→keep, and **on `unique_violation` DELETEs
the dropped child row instead**. For `sales_transactions` that fallback deletes the
dropped property's duplicate sale — but several FKs pointing at `sales_transactions` were
`NO ACTION`, so Postgres refused the delete (23503). The DELETE runs **inside** the
`when unique_violation` handler, so the 23503 isn't caught by the sibling `when others`
and propagates as a fatal 500.

## Already applied LIVE to gov (migration `gov_merge_sale_fk_set_null_unblock`, verified)
Three gov FKs → `ON DELETE SET NULL` (matching dia's existing convention for the same
links); after the change ALL 8 FKs referencing `sales_transactions` are CASCADE or
SET NULL, none NO ACTION:
```sql
ALTER TABLE public.available_listings  DROP CONSTRAINT available_listings_sale_transaction_id_fkey,
  ADD CONSTRAINT available_listings_sale_transaction_id_fkey
      FOREIGN KEY (sale_transaction_id) REFERENCES public.sales_transactions(sale_id) ON DELETE SET NULL;
ALTER TABLE public.ownership_history   DROP CONSTRAINT ownership_history_sale_id_fkey,
  ADD CONSTRAINT ownership_history_sale_id_fkey
      FOREIGN KEY (sale_id) REFERENCES public.sales_transactions(sale_id) ON DELETE SET NULL;
ALTER TABLE public.property_documents  DROP CONSTRAINT property_documents_sale_id_fkey,
  ADD CONSTRAINT property_documents_sale_id_fkey
      FOREIGN KEY (sale_id) REFERENCES public.sales_transactions(sale_id) ON DELETE SET NULL;
```
No data loss: a deleted duplicate sale just nulls the child's stale pointer; the
listing/doc/ownership rows survive.

## Unit 1 — commit the gov migration
Add the SQL above as a committed migration in `supabase/migrations/government/`
(idempotent: guard each with a check that the constraint's `confdeltype <> 'n'` before
drop/re-add, or use `DROP CONSTRAINT IF EXISTS` + `ADD`). It's already live, so the
migration is for repo/replay parity — make it a safe no-op re-apply.

## Unit 2 — dia parity (same bug will hit dia merges)
dia (`dia_merge_property`) has the same delete-on-collision path, and these FKs to
`sales_transactions` are still `NO ACTION`:
`broker_market_coverage.sale_id`, `loans.sale_id`, `property_documents.sale_id`.
Apply the same `ON DELETE SET NULL` (committed migration in
`supabase/migrations/dialysis/`), so a dia property merge doesn't 500 the same way.
Verify post-change: zero NO ACTION FKs referencing dia `sales_transactions`.
(dia `available_listings.sale_transaction_id` + `ownership_history.sale_id` are already
SET NULL — leave them.)

## Unit 3 — harden the merge function (both domains)
The schema fix removes the known blockers, but the function's structure makes ANY future
blocked delete fatal. In `gov_merge_property` and `dia_merge_property`:
- Wrap the `when unique_violation` fallback `DELETE` in its OWN `BEGIN … EXCEPTION WHEN
  others THEN` block so a blocked/failed delete is RECORDED in the returned `rewired`
  jsonb (e.g. `<tbl>.<col>_delete_failed`) instead of aborting the whole merge.
- **Better (preferred):** for the `sales_transactions` collision specifically, before
  deleting the dropped duplicate sale, re-point its child references
  (`available_listings.sale_transaction_id`, `property_documents.sale_id`,
  `ownership_history.sale_id`, `broker_*`, `contacts`, `loans`) to the SURVIVING keep-side
  sale, then delete — so the links follow the merge instead of nulling. If matching the
  surviving sale is ambiguous, fall back to SET NULL (now safe) + record it.
- Keep the function idempotent and transactional (it already runs in one statement); add a
  short comment block documenting the collision/secondary-FK handling.

## Verification / acceptance
- Re-run the GSA Tallahassee merge (keep vs drop 23343) — succeeds, `property_deleted=1`,
  `rewired` shows the sales/listings handled; the formerly-blocking listing
  `68957c6f…` survives on the kept property with `sale_transaction_id` either re-pointed
  or nulled.
- A dia property-merge with a colliding sale referenced by a (formerly NO ACTION) child
  succeeds.
- Both functions: a simulated still-blocked delete records into `rewired` and does NOT
  500.
- `node --check` / suite green; no api/*.js change (DB-only round) — ≤12 functions
  unaffected.

## Guardrails
- Migrations committed + idempotent (applied-live-then-commit parity). Provenance: this is
  a structural FK/role fix, no business-data writes. Don't touch unrelated constraints.
- Don't regress the cleaned lease records or any prior round's artifacts.
