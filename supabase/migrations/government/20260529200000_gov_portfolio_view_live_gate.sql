-- ⚠️ HISTORICAL — DO NOT RE-APPLY. This directory does not own the government database;
-- `government-lease` does (see supabase/migrations/government/README.md, 2026-09-12).
-- This file is kept as a record of what this repo applied in the past. The live, correct
-- copy of any object it defines may have since diverged -- read the deployed database or
-- government-lease's committed source, never this file, before trusting its content.

-- ============================================================================
-- Gov — v_sales_transactions_portfolio: gate on transaction_state='live'
--
-- Target: government Supabase (GOV_SUPABASE_URL)
--
-- 2026-05-29 comps review (#7). This anon-readable BD portfolio view (pulled by
-- LCC Opps lcc_sync_listing_events) gated only on property_id/sale_date, so it
-- exposed duplicate_superseded / ownership_stub / needs_review rows to the BD
-- listing-event pipeline (160 ownership_stub GSA-lessor swaps alone). Add the
-- live gate so the BD pipeline counts each real unique sale once. (Column list
-- unchanged.)
-- ============================================================================

CREATE OR REPLACE VIEW public.v_sales_transactions_portfolio AS
 SELECT sale_id, property_id, sale_date, sold_price AS sale_price,
        buyer AS buyer_name, seller AS seller_name, sold_cap_rate AS cap_rate,
        data_source, created_at, updated_at
   FROM sales_transactions
  WHERE property_id IS NOT NULL AND sale_date IS NOT NULL
    AND transaction_state = 'live';
