-- ============================================================================
-- Migration: gov.sales_transactions listing price-history priority entries
--
-- Target: LCC Opps Supabase (OPS_SUPABASE_URL)
--
-- Round 77 (2026-06-02) added listing price-history fields to the CoStar
-- sidebar's gov sales writer (sidebar-pipeline.js upsertDomainSales): it now
-- maps metadata.list_price / asking_price / listing_date / days_on_market onto
--   gov.sales_transactions.{initial_price, last_price, on_market_date,
--                           days_on_market, had_price_change, pct_of_initial}
-- and records per-row provenance for them via recordCoStarFieldsProvenance.
--
-- Without these registry rows the new (table, field, source) triples would
-- surface in v_field_provenance_unranked (the Phase 4 schema-drift detector).
-- This seeds the same priority bands used elsewhere for gov.sales_transactions:
--   1   = manual override (human edit / resolution)
--   35  = om_extraction (AI-extracted ask from an OM/flyer)
--   50  = salesforce (SJC comp DB original/list ask — the backfill source)
--   60  = costar_sidebar (aggregator capture)
--
-- All entries are enforce_mode='record_only' (table default) — observation
-- only; the actual UPDATE in upsertDomainSales runs unchanged. A manual
-- override or a higher-trust source (om_extraction, salesforce) outranks the
-- sidebar so a CoStar re-capture never displaces a curated ask under a future
-- warn/strict flip.
-- ============================================================================

INSERT INTO public.field_source_priority
  (target_table, field_name, source, priority, min_confidence, notes)
VALUES
  ('gov.sales_transactions', 'initial_price',    'manual_edit',       1,  null, 'Explicit human override.'),
  ('gov.sales_transactions', 'initial_price',    'manual_resolution', 1,  null, null),
  ('gov.sales_transactions', 'initial_price',    'om_extraction',    35, 0.5,  'OM-stated original ask.'),
  ('gov.sales_transactions', 'initial_price',    'salesforce',       50, null, 'SJC comp DB Original_List_Price.'),
  ('gov.sales_transactions', 'initial_price',    'costar_sidebar',   60, null, 'CoStar metadata.list_price (original ask).'),

  ('gov.sales_transactions', 'last_price',       'manual_edit',       1,  null, null),
  ('gov.sales_transactions', 'last_price',       'manual_resolution', 1,  null, null),
  ('gov.sales_transactions', 'last_price',       'om_extraction',    35, 0.5,  'OM-stated current ask.'),
  ('gov.sales_transactions', 'last_price',       'salesforce',       50, null, 'SJC comp DB Listing_Price.'),
  ('gov.sales_transactions', 'last_price',       'costar_sidebar',   60, null, 'CoStar metadata.asking_price (final ask).'),

  ('gov.sales_transactions', 'on_market_date',   'manual_edit',       1,  null, null),
  ('gov.sales_transactions', 'on_market_date',   'manual_resolution', 1,  null, null),
  ('gov.sales_transactions', 'on_market_date',   'salesforce',       50, null, 'SJC comp DB On_Market_Date.'),
  ('gov.sales_transactions', 'on_market_date',   'costar_sidebar',   60, null, 'CoStar metadata.listing_date.'),

  ('gov.sales_transactions', 'days_on_market',   'manual_edit',       1,  null, null),
  ('gov.sales_transactions', 'days_on_market',   'manual_resolution', 1,  null, null),
  ('gov.sales_transactions', 'days_on_market',   'salesforce',       50, null, 'SJC comp DB Days_on_Market.'),
  ('gov.sales_transactions', 'days_on_market',   'costar_sidebar',   60, null, 'CoStar metadata.days_on_market.'),

  -- Derived fields: computed from initial/last/sold; lowest sidebar trust.
  ('gov.sales_transactions', 'had_price_change', 'manual_edit',       1,  null, null),
  ('gov.sales_transactions', 'had_price_change', 'costar_sidebar',   60, null, 'Derived: initial_price <> last_price.'),

  ('gov.sales_transactions', 'pct_of_initial',   'manual_edit',       1,  null, null),
  ('gov.sales_transactions', 'pct_of_initial',   'costar_sidebar',   60, null, 'Derived: sold_price / initial_price.')

ON CONFLICT (target_table, field_name, source) DO NOTHING;
