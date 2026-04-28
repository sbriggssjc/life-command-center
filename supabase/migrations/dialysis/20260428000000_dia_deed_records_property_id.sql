-- ============================================================================
-- Round 76ae — link dia.deed_records to properties via property_id
--
-- BEFORE: dia.deed_records had no FK to properties. The sidebar writer
-- (upsertDialysisDeedRecords) accepted propertyId as a parameter but never
-- wrote it. Every deed inserted from the CoStar Sale History parser landed
-- orphaned — no way to surface "show me deeds for this property."
--
-- AFTER: deed_records.property_id is a real FK. New deeds carry it.
-- Existing rows are backfilled where we can join via document_number to
-- sales_transactions (which has property_id linked).
--
-- Apply on dialysis Supabase project (zqzrriwuavgrquhisnoa).
-- ============================================================================

ALTER TABLE public.deed_records
  ADD COLUMN IF NOT EXISTS property_id integer
    REFERENCES public.properties(property_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS deed_records_property_id_idx
  ON public.deed_records(property_id);

-- ── Backfill ───────────────────────────────────────────────────────────────
-- sales_transactions has no document_number column, so we can't join on the
-- recorded doc#. Best effort: match on buyer_name + seller_name + sale_date.
-- Most legacy rows will stay orphaned; the value of this migration is in the
-- forward path — upsertDialysisDeedRecords now writes property_id directly.

WITH dedup_links AS (
  SELECT DISTINCT ON (dr.id)
    dr.id           AS deed_id,
    st.property_id  AS property_id
  FROM public.deed_records dr
  JOIN public.sales_transactions st
    ON UPPER(TRIM(st.buyer_name))  = UPPER(TRIM(dr.grantee))
   AND UPPER(TRIM(st.seller_name)) = UPPER(TRIM(dr.grantor))
   AND st.sale_date = dr.recording_date
  WHERE dr.property_id IS NULL
    AND dr.grantor IS NOT NULL
    AND dr.grantee IS NOT NULL
  ORDER BY dr.id, st.sale_date DESC NULLS LAST
)
UPDATE public.deed_records dr
   SET property_id = dl.property_id
  FROM dedup_links dl
 WHERE dr.id = dl.deed_id;

-- ── Audit notice ───────────────────────────────────────────────────────────
DO $$
DECLARE
  total_rows integer;
  linked_rows integer;
  orphan_rows integer;
BEGIN
  SELECT COUNT(*) INTO total_rows  FROM public.deed_records;
  SELECT COUNT(*) INTO linked_rows FROM public.deed_records WHERE property_id IS NOT NULL;
  orphan_rows := total_rows - linked_rows;
  RAISE NOTICE 'deed_records: % total, % linked to a property, % still orphaned',
    total_rows, linked_rows, orphan_rows;
END $$;
