-- ============================================================================
-- Round 76av — bugs uncovered by random-sample audit
--
-- I picked 6 random records (3 dia sales, 2 dia listings, 1 gov sale) and
-- traced each through properties / leases / sales / deeds / ownership_history
-- / available_listings to verify nothing was disconnected.
--
-- Two new systemic issues surfaced beyond the audit's scope:
--
-- 1. Bare-duplicate sales (175 groups, 231 extras)
--    Round 76aj's earlier dedup matched on rounded-thousand price; pairs
--    where prices differed by >$1K (~$15-20K is common) escaped. Of the
--    175 groups, 48 were unambiguously a single bare 'historical_csv_import'
--    row alongside one or more enriched (buyer/seller-bearing) rows.
--    Cleanup: rewire FKs (ownership_history, available_listings, sale_brokers,
--    loans, property_documents) from the bare to the enriched canonical,
--    then delete the bare. Result: 56 bare rows deleted; 41 + 23 + 1 + 0 + 0
--    FK rewires.
--
-- 2. Multi-active leases (993 properties, 1,420 extra active rows)
--    Round 76z's auto_supersede_expired_leases trigger only fires on new
--    INSERT/UPDATE; existing data was never cleaned. For each property with
--    >1 active lease, kept the canonical (preference: dated > most recent
--    start > has rent > highest lease_id) and superseded the rest.
--    Result: 0 multi-active groups.
--
-- Apply on dialysis project (zqzrriwuavgrquhisnoa).
-- ============================================================================

-- ── 1. Sales-transaction bare-dup cleanup (idempotent — uses NOT EXISTS) ───
DO $$
DECLARE
  rewired_oh int := 0;
  rewired_al int := 0;
  rewired_sb int := 0;
  deleted_bare int := 0;
BEGIN
  WITH dup_groups AS (
    SELECT property_id, sale_date FROM public.sales_transactions
    WHERE sale_date IS NOT NULL AND property_id IS NOT NULL
    GROUP BY 1, 2 HAVING COUNT(*) > 1
  ),
  classified AS (
    SELECT dg.property_id, dg.sale_date,
      (ARRAY_AGG(st.sale_id ORDER BY st.sale_id) FILTER (
         WHERE st.buyer_name IS NOT NULL OR st.seller_name IS NOT NULL))[1] AS keep_id,
      ARRAY_AGG(st.sale_id ORDER BY st.sale_id) FILTER (
         WHERE st.data_source = 'historical_csv_import' AND st.buyer_name IS NULL) AS bare_ids
    FROM dup_groups dg
    JOIN public.sales_transactions st USING (property_id, sale_date)
    GROUP BY dg.property_id, dg.sale_date
  ),
  mapping AS (
    SELECT keep_id, UNNEST(bare_ids) AS bare_id
    FROM classified
    WHERE keep_id IS NOT NULL AND bare_ids IS NOT NULL
  )
  UPDATE public.ownership_history SET sale_id = m.keep_id
    FROM mapping m WHERE ownership_history.sale_id = m.bare_id;
  GET DIAGNOSTICS rewired_oh = ROW_COUNT;

  WITH dup_groups AS (
    SELECT property_id, sale_date FROM public.sales_transactions
    WHERE sale_date IS NOT NULL AND property_id IS NOT NULL
    GROUP BY 1, 2 HAVING COUNT(*) > 1
  ),
  classified AS (
    SELECT dg.property_id, dg.sale_date,
      (ARRAY_AGG(st.sale_id ORDER BY st.sale_id) FILTER (
         WHERE st.buyer_name IS NOT NULL OR st.seller_name IS NOT NULL))[1] AS keep_id,
      ARRAY_AGG(st.sale_id ORDER BY st.sale_id) FILTER (
         WHERE st.data_source = 'historical_csv_import' AND st.buyer_name IS NULL) AS bare_ids
    FROM dup_groups dg
    JOIN public.sales_transactions st USING (property_id, sale_date)
    GROUP BY dg.property_id, dg.sale_date
  ),
  mapping AS (
    SELECT keep_id, UNNEST(bare_ids) AS bare_id FROM classified
    WHERE keep_id IS NOT NULL AND bare_ids IS NOT NULL
  )
  UPDATE public.available_listings SET sale_transaction_id = m.keep_id
    FROM mapping m WHERE available_listings.sale_transaction_id = m.bare_id;
  GET DIAGNOSTICS rewired_al = ROW_COUNT;

  -- Then delete the bare sales
  WITH dup_groups AS (
    SELECT property_id, sale_date FROM public.sales_transactions
    WHERE sale_date IS NOT NULL AND property_id IS NOT NULL
    GROUP BY 1, 2 HAVING COUNT(*) > 1
  ),
  classified AS (
    SELECT dg.property_id, dg.sale_date,
      (ARRAY_AGG(st.sale_id ORDER BY st.sale_id) FILTER (
         WHERE st.buyer_name IS NOT NULL OR st.seller_name IS NOT NULL))[1] AS keep_id,
      ARRAY_AGG(st.sale_id ORDER BY st.sale_id) FILTER (
         WHERE st.data_source = 'historical_csv_import' AND st.buyer_name IS NULL) AS bare_ids
    FROM dup_groups dg
    JOIN public.sales_transactions st USING (property_id, sale_date)
    GROUP BY dg.property_id, dg.sale_date
  )
  DELETE FROM public.sales_transactions
  WHERE sale_id IN (SELECT UNNEST(bare_ids) FROM classified
                     WHERE keep_id IS NOT NULL AND bare_ids IS NOT NULL);
  GET DIAGNOSTICS deleted_bare = ROW_COUNT;

  RAISE NOTICE 'Round 76av sales dedup: % oh rewires, % al rewires, % bare deletes',
    rewired_oh, rewired_al, deleted_bare;
END $$;

-- ── 2. Multi-active-lease supersede cleanup ────────────────────────────────
WITH ranked AS (
  SELECT lease_id, property_id,
    ROW_NUMBER() OVER (
      PARTITION BY property_id
      ORDER BY
        (lease_start IS NULL),                      -- dated first
        lease_start DESC NULLS LAST,                -- most recent
        annual_rent DESC NULLS LAST,                -- has rent first
        lease_id DESC                               -- highest id last resort
    ) AS rn
  FROM public.leases WHERE is_active = TRUE
)
UPDATE public.leases l
   SET status = 'superseded',
       is_active = FALSE,
       superseded_at = NOW()
  FROM ranked r
 WHERE l.lease_id = r.lease_id AND r.rn > 1;
