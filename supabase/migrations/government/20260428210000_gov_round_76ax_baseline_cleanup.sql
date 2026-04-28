-- ============================================================================
-- Round 76ax — Government baseline cleanup (catch up to dia hygiene)
--
-- Audit found gov DB lagging behind dia on every cleanup pattern fixed in
-- Rounds 76av/76aw. This brings gov to parity:
--
--   1. NULL sale_date cleanup + CHECK constraint (132 rows deleted)
--      All 132 rows had no recoverable date in any column. Sever
--      ownership_history.matched_sale_id links, then bulk delete.
--      Then add NOT NULL constraint so writers fail loudly going forward.
--
--   2. Duplicate-sale dedup (526 → 521 groups)
--      Same approach as dia 76av — keep enriched buyer/seller-bearing row
--      from each (property_id, sale_date) group, delete bare CSV imports.
--      Most gov dups have buyer/seller across both rows so dedup yield is
--      smaller than dia (only 5 cleaned). Remaining 521 fall to the new
--      data_hygiene_sweep cron.
--
--   3. Multi-unsuperseded-lease cleanup (3,644 → 448 props, -88%)
--      For each property with >1 unsuperseded lease, keep the canonical
--      (preference: dated > most recent commencement > truly-current >
--      has rent > highest lease_id) and supersede the rest. Skip
--      ambiguous cases where >1 truly-current lease exists (left for
--      human review via v_data_quality_issues).
--
--   4. recorded_owner_id backfill via sale.buyer (893 → 19 props, -98%)
--      Match sales.buyer text against recorded_owners.name via
--      normalize_entity_name(). Same precision as dia 76aw passes 1+2.
--
-- Apply on government project (scknotsqkcheojiaewwh).
-- ============================================================================

-- ── 1. NULL sale_date cleanup ──────────────────────────────────────────────
DO $$
DECLARE severed int := 0; deleted int := 0;
BEGIN
  UPDATE public.ownership_history SET matched_sale_id = NULL
   WHERE matched_sale_id IN (SELECT sale_id FROM public.sales_transactions WHERE sale_date IS NULL);
  GET DIAGNOSTICS severed = ROW_COUNT;

  DELETE FROM public.sales_transactions WHERE sale_date IS NULL;
  GET DIAGNOSTICS deleted = ROW_COUNT;

  RAISE NOTICE 'gov 76ax: severed % oh links, deleted % null-sale-date rows', severed, deleted;
END $$;

ALTER TABLE public.sales_transactions
  DROP CONSTRAINT IF EXISTS sales_transactions_sale_date_not_null;
ALTER TABLE public.sales_transactions
  ADD CONSTRAINT sales_transactions_sale_date_not_null
  CHECK (sale_date IS NOT NULL) NOT VALID;
ALTER TABLE public.sales_transactions
  VALIDATE CONSTRAINT sales_transactions_sale_date_not_null;

-- ── 2. Duplicate-sale dedup ────────────────────────────────────────────────
DO $$
DECLARE deleted int := 0;
BEGIN
  WITH dup_groups AS (
    SELECT property_id, sale_date FROM public.sales_transactions
    WHERE sale_date IS NOT NULL AND property_id IS NOT NULL
    GROUP BY 1, 2 HAVING COUNT(*) > 1
  ),
  classified AS (
    SELECT dg.property_id, dg.sale_date,
      (ARRAY_AGG(st.sale_id::text ORDER BY st.sale_id::text) FILTER (
         WHERE st.buyer IS NOT NULL OR st.seller IS NOT NULL OR st.sold_price IS NOT NULL))[1] AS keep_id,
      ARRAY_AGG(st.sale_id::text ORDER BY st.sale_id::text) FILTER (
         WHERE (st.buyer IS NULL AND st.seller IS NULL AND st.sold_price IS NULL)
            OR st.data_source IN ('comps_import','historical_csv_import')) AS bare_ids
    FROM dup_groups dg
    JOIN public.sales_transactions st USING (property_id, sale_date)
    GROUP BY dg.property_id, dg.sale_date
  ),
  mapping AS (
    SELECT keep_id, UNNEST(bare_ids) AS bare_id FROM classified
    WHERE keep_id IS NOT NULL AND bare_ids IS NOT NULL AND keep_id <> ALL(bare_ids)
  )
  DELETE FROM public.sales_transactions
   WHERE sale_id::text IN (SELECT bare_id FROM mapping);
  GET DIAGNOSTICS deleted = ROW_COUNT;

  RAISE NOTICE 'gov 76ax sales dedup: % bare deletes', deleted;
END $$;

-- ── 3. Multi-unsuperseded-lease cleanup ───────────────────────────────────
DO $$
DECLARE superseded_count int := 0;
BEGIN
  WITH ranked AS (
    SELECT lease_id, property_id,
      ROW_NUMBER() OVER (
        PARTITION BY property_id
        ORDER BY
          (commencement_date IS NULL),
          commencement_date DESC NULLS LAST,
          (CASE WHEN expiration_date IS NULL OR expiration_date >= CURRENT_DATE THEN 0 ELSE 1 END),
          annual_rent DESC NULLS LAST,
          lease_id::text DESC
      ) AS rn,
      COUNT(*) FILTER (WHERE expiration_date IS NULL OR expiration_date >= CURRENT_DATE)
        OVER (PARTITION BY property_id) AS truly_current_count
    FROM public.leases WHERE superseded_at IS NULL
  )
  UPDATE public.leases l
     SET superseded_at = NOW()
    FROM ranked r
   WHERE l.lease_id = r.lease_id
     AND r.rn > 1
     AND r.truly_current_count <= 1;
  GET DIAGNOSTICS superseded_count = ROW_COUNT;

  RAISE NOTICE 'gov 76ax multi-unsup supersede: % rows', superseded_count;
END $$;

-- ── 4. recorded_owner_id backfill via sale.buyer ──────────────────────────
WITH props_holes AS (
  SELECT p.property_id FROM public.properties p
  WHERE p.recorded_owner_id IS NULL
    AND EXISTS (SELECT 1 FROM public.sales_transactions s WHERE s.property_id = p.property_id)
),
candidate AS (
  SELECT DISTINCT ON (s.property_id) s.property_id, ro.recorded_owner_id
  FROM props_holes ph
  JOIN public.sales_transactions s ON s.property_id = ph.property_id
  JOIN public.recorded_owners ro ON normalize_entity_name(ro.name) = normalize_entity_name(s.buyer)
  WHERE s.buyer IS NOT NULL AND TRIM(s.buyer) <> ''
  ORDER BY s.property_id, s.sale_date DESC NULLS LAST, s.sale_id::text DESC
)
UPDATE public.properties p SET recorded_owner_id = c.recorded_owner_id
  FROM candidate c WHERE p.property_id = c.property_id;
