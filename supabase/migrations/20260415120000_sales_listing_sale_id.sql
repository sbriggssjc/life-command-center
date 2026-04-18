-- ============================================================================
-- Migration: sales_transactions.listing_sale_id — link each sale to the
--            specific listing campaign that produced it
-- Target: Dialysis domain Supabase (DIA_SUPABASE_URL)
-- Life Command Center — fix listing ↔ sales_transactions misassociation
--
-- Problem:
--   The sidebar pipeline matches listings to sales by property_id only.
--   When a property has had multiple listing campaigns over the years, a
--   single available_listings row was ending up associated with several
--   sales_transactions rows (e.g. a 2015 campaign and a 2023 campaign both
--   mapped to the same listing).
--
-- Fix:
--   Add a nullable listing_sale_id column on sales_transactions that points
--   to the available_listings.listing_id which best matches that sale —
--   same property_id, and a sale_date within 180 days of the listing's
--   listing_date. Null when no listing campaign matches (private deed,
--   off-market, or a sale predating any captured listing).
--
-- Safe to re-run.
-- ============================================================================

BEGIN;

ALTER TABLE public.sales_transactions
    ADD COLUMN IF NOT EXISTS listing_sale_id BIGINT;

COMMENT ON COLUMN public.sales_transactions.listing_sale_id IS
    'FK-style link to the available_listings.listing_id that represents the '
    'listing campaign responsible for this sale. Nullable: many sales originate '
    'off-market. Matched on property_id + sale_date within 180 days of '
    'listing_date. See api/_handlers/sidebar-pipeline.js upsertDomainSales.';

CREATE INDEX IF NOT EXISTS idx_sales_transactions_listing_sale_id
    ON public.sales_transactions(listing_sale_id)
    WHERE listing_sale_id IS NOT NULL;

COMMIT;
