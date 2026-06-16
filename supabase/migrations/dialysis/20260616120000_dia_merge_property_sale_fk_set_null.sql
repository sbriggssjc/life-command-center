-- ============================================================================
-- Unit 2 (dia) — parity with the gov sale-FK unblock (Unit 1).
--
-- dia_merge_property has the same delete-on-collision path as gov, and these FKs
-- referencing sales_transactions were still ON DELETE NO ACTION:
--   broker_market_coverage.sale_id, loans.sale_id, property_documents.sale_id
-- so a dia property merge with a colliding duplicate sale referenced by one of
-- them would 500 the same way gov did. (The deployed dia function works around it
-- by explicitly DELETing those child rows first — which silently DISCARDS them.)
-- Flipping the three to ON DELETE SET NULL fixes the failure mode AND lets the
-- child rows survive (the hardened function in Unit 3 re-points them to the
-- surviving sale, or leaves a nulled pointer, instead of deleting them).
--
-- available_listings.sale_transaction_id and ownership_history.sale_id are
-- already SET NULL — left as-is. sale_brokers.sale_id is CASCADE — left as-is.
-- After this change zero FKs referencing public.sales_transactions are NO ACTION.
--
-- Idempotent: each constraint is only rebuilt when not already SET NULL.
-- Provenance: structural FK fix only; no business-data writes.
-- ============================================================================

DO $$
BEGIN
  IF (SELECT confdeltype FROM pg_constraint
        WHERE conname = 'broker_market_coverage_sale_id_fkey'
          AND conrelid = 'public.broker_market_coverage'::regclass) <> 'n' THEN
    ALTER TABLE public.broker_market_coverage
      DROP CONSTRAINT broker_market_coverage_sale_id_fkey;
    ALTER TABLE public.broker_market_coverage
      ADD CONSTRAINT broker_market_coverage_sale_id_fkey
      FOREIGN KEY (sale_id) REFERENCES public.sales_transactions(sale_id)
      ON DELETE SET NULL;
  END IF;

  IF (SELECT confdeltype FROM pg_constraint
        WHERE conname = 'loans_sale_id_fkey'
          AND conrelid = 'public.loans'::regclass) <> 'n' THEN
    ALTER TABLE public.loans
      DROP CONSTRAINT loans_sale_id_fkey;
    ALTER TABLE public.loans
      ADD CONSTRAINT loans_sale_id_fkey
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
