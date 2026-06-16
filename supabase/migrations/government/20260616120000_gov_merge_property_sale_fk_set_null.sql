-- ============================================================================
-- Unit 1 (gov) — unblock the property-merge sale dedup at the schema level.
--
-- ALREADY APPLIED LIVE to the gov DB (verified). This migration is committed for
-- repo / replay parity and is a safe no-op re-apply (each constraint is only
-- rebuilt when it is not already ON DELETE SET NULL).
--
-- Root cause of the Decision Center `property_merge` 500 (23503): when
-- gov_merge_property re-points a dropped property's children to the keep side,
-- a sales_transactions row that collides on a unique key is DELETED instead.
-- Several FKs that reference sales_transactions were ON DELETE NO ACTION
-- (available_listings.sale_transaction_id, ownership_history.sale_id,
-- property_documents.sale_id), so Postgres refused the delete and the error
-- propagated as a fatal 500. Flipping them to ON DELETE SET NULL (dia's existing
-- convention for the same links) lets the child rows survive with a nulled
-- pointer when their dropped duplicate sale is removed. No data loss — only a
-- stale pointer to a deleted duplicate is cleared.
--
-- After this change ALL FKs referencing public.sales_transactions are SET NULL
-- or CASCADE — none NO ACTION.
--
-- Provenance: structural FK fix only; no business-data writes.
-- ============================================================================

DO $$
BEGIN
  IF (SELECT confdeltype FROM pg_constraint
        WHERE conname = 'available_listings_sale_transaction_id_fkey'
          AND conrelid = 'public.available_listings'::regclass) <> 'n' THEN
    ALTER TABLE public.available_listings
      DROP CONSTRAINT available_listings_sale_transaction_id_fkey;
    ALTER TABLE public.available_listings
      ADD CONSTRAINT available_listings_sale_transaction_id_fkey
      FOREIGN KEY (sale_transaction_id) REFERENCES public.sales_transactions(sale_id)
      ON DELETE SET NULL;
  END IF;

  IF (SELECT confdeltype FROM pg_constraint
        WHERE conname = 'ownership_history_sale_id_fkey'
          AND conrelid = 'public.ownership_history'::regclass) <> 'n' THEN
    ALTER TABLE public.ownership_history
      DROP CONSTRAINT ownership_history_sale_id_fkey;
    ALTER TABLE public.ownership_history
      ADD CONSTRAINT ownership_history_sale_id_fkey
      FOREIGN KEY (sale_id) REFERENCES public.sales_transactions(sale_id)
      ON DELETE SET NULL;
  END IF;

  IF (SELECT confdeltype FROM pg_constraint
        WHERE conname = 'property_documents_sale_id_fkey'
          AND conrelid = 'public.property_documents'::regclass) <> 'n' THEN
    ALTER TABLE public.property_documents
      DROP CONSTRAINT property_documents_sale_id_fkey;
    ALTER TABLE public.property_documents
      ADD CONSTRAINT property_documents_sale_id_fkey
      FOREIGN KEY (sale_id) REFERENCES public.sales_transactions(sale_id)
      ON DELETE SET NULL;
  END IF;
END $$;
