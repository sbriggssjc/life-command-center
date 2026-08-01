-- ============================================================================
-- Issue #710 - field_source_priority schema drift for folder-feed listing asks
--
-- Target: LCC Opps (xengecqvemvfknjvbvrq)
--
-- The 20260719120000 Stage B advisory registry cross-joined generic reported
-- price/cap field names onto both available_listings and sales_transactions.
-- That was too broad: dia/gov available_listings use different live ask columns,
-- so the daily schema-validity audit flagged folder_feed_bov/master rules whose
-- columns do not exist. Worse, valid listing ask columns were left at sentinel
-- priority 9999 even though confirmed OM/BOV asking price/cap should outrank
-- aggregator/calc values for our own listings.
--
-- This migration narrows the listing rules to live columns and assigns the
-- confirmed folder-feed ask fields the same trust tier as factual folder-feed
-- lease abstracts (45). Sales/analytic quarantine rules remain separate.
-- ============================================================================

-- Remove dead rules that can never match a live available_listings column.
DELETE FROM public.field_source_priority
 WHERE source IN ('folder_feed_bov', 'folder_feed_master')
   AND (
     (target_table = 'dia.available_listings'
      AND field_name IN (
        'asking_cap',
        'asking_price',
        'listing_price',
        'original_price',
        'sold_cap_rate',
        'last_price_change'
      ))
     OR
     (target_table = 'gov.available_listings'
      AND field_name IN (
        'asking_cap',
        'listing_price',
        'sold_cap_rate',
        'sold_price'
      ))
   );

-- Confirmed folder-feed BOV/Master ask fields are authoritative listing inputs.
-- Priority 45 mirrors folder_feed_lease factual writes: below manual/county/
-- recorded proof, above OM extraction and aggregator/sidebar captures.
INSERT INTO public.field_source_priority
  (target_table, field_name, source, priority, min_confidence, enforce_mode, notes)
SELECT v.target_table, v.field_name, s.source, 45, 0, 'warn',
       'Issue #710: confirmed folder-feed BOV/Master listing ask price/cap on live available_listings column; authoritative for our own listing ask.'
FROM (VALUES
  -- dia.available_listings ask-price/cap shape
  ('dia.available_listings', 'initial_price'),
  ('dia.available_listings', 'last_price'),
  ('dia.available_listings', 'initial_cap_rate'),
  ('dia.available_listings', 'current_cap_rate'),
  ('dia.available_listings', 'cap_rate'),
  ('dia.available_listings', 'price_change_date'),
  -- gov.available_listings ask-price/cap shape
  ('gov.available_listings', 'asking_price'),
  ('gov.available_listings', 'asking_cap_rate')
) AS v(target_table, field_name)
CROSS JOIN (VALUES ('folder_feed_bov'), ('folder_feed_master')) AS s(source)
ON CONFLICT (target_table, field_name, source) DO UPDATE
  SET priority = EXCLUDED.priority,
      min_confidence = EXCLUDED.min_confidence,
      enforce_mode = EXCLUDED.enforce_mode,
      notes = EXCLUDED.notes,
      updated_at = now();

-- Guard future registry writes when the target domain table has a refreshed
-- domain_table_columns cache. This makes the daily audit's rule enforceable at
-- registration time without making an empty cache block bootstrap migrations.
CREATE OR REPLACE FUNCTION public.assert_field_source_priority_column_exists()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.target_table ~ '^(dia|gov)\.' THEN
    IF EXISTS (
      SELECT 1
        FROM public.domain_table_columns c
       WHERE c.target_table = NEW.target_table
    ) AND NOT EXISTS (
      SELECT 1
        FROM public.domain_table_columns c
       WHERE c.target_table = NEW.target_table
         AND c.column_name = NEW.field_name
    ) THEN
      RAISE EXCEPTION
        'field_source_priority column drift: %.% is not present in domain_table_columns',
        NEW.target_table, NEW.field_name
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_field_source_priority_column_exists
  ON public.field_source_priority;

CREATE TRIGGER trg_field_source_priority_column_exists
BEFORE INSERT OR UPDATE OF target_table, field_name
ON public.field_source_priority
FOR EACH ROW
EXECUTE FUNCTION public.assert_field_source_priority_column_exists();

COMMENT ON FUNCTION public.assert_field_source_priority_column_exists() IS
  'Blocks dia/gov field_source_priority registrations whose field_name is absent from the refreshed domain_table_columns cache. Empty or uncached tables remain bootstrap-safe; Daily DB Checks refresh the cache from live domain information_schema.';

