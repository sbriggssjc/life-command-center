-- ============================================================================
-- Migration: Government DB — CHECK constraints, missing FKs, cascade rules
-- Target:    Government domain Supabase (GOV_SUPABASE_URL)
--
-- Adds data quality guards (cap rate range, positive prices, date sanity),
-- missing foreign keys (property_sale_events → properties, contacts →
-- properties, ownership_history → sales_transactions), and upgrades
-- cascade behavior on child tables.
-- ============================================================================

-- ── CHECK constraints ───────────────────────────────────────────────────────

-- Cap rates must be in decimal form
ALTER TABLE sales_transactions ADD CONSTRAINT chk_sold_cap_rate_range
  CHECK (sold_cap_rate IS NULL OR (sold_cap_rate >= 0.005 AND sold_cap_rate <= 0.30))
  NOT VALID;

ALTER TABLE sales_transactions ADD CONSTRAINT chk_initial_cap_rate_range
  CHECK (initial_cap_rate IS NULL OR (initial_cap_rate >= 0.005 AND initial_cap_rate <= 0.30))
  NOT VALID;

ALTER TABLE sales_transactions ADD CONSTRAINT chk_last_cap_rate_range
  CHECK (last_cap_rate IS NULL OR (last_cap_rate >= 0.005 AND last_cap_rate <= 0.30))
  NOT VALID;

ALTER TABLE property_sale_events ADD CONSTRAINT chk_pse_cap_rate_range
  CHECK (cap_rate IS NULL OR (cap_rate >= 0.005 AND cap_rate <= 0.30))
  NOT VALID;

-- Prices must be positive
ALTER TABLE sales_transactions ADD CONSTRAINT chk_sold_price_positive
  CHECK (sold_price IS NULL OR sold_price > 0)
  NOT VALID;

ALTER TABLE property_sale_events ADD CONSTRAINT chk_pse_price_positive
  CHECK (price IS NULL OR price > 0)
  NOT VALID;

-- Sale dates must not be in the future
ALTER TABLE sales_transactions ADD CONSTRAINT chk_sale_date_not_future
  CHECK (sale_date IS NULL OR sale_date <= CURRENT_DATE + INTERVAL '1 day')
  NOT VALID;

ALTER TABLE property_sale_events ADD CONSTRAINT chk_pse_sale_date_not_future
  CHECK (sale_date IS NULL OR sale_date <= CURRENT_DATE + INTERVAL '1 day')
  NOT VALID;

-- Lease expiration must be reasonable
ALTER TABLE leases ADD CONSTRAINT chk_lease_expiration_range
  CHECK (expiration_date IS NULL OR (expiration_date >= '1950-01-01' AND expiration_date <= '2100-01-01'))
  NOT VALID;

-- ── Missing foreign keys ────────────────────────────────────────────────────

ALTER TABLE property_sale_events ADD CONSTRAINT fk_pse_property
  FOREIGN KEY (property_id) REFERENCES properties(property_id) ON DELETE SET NULL
  NOT VALID;

ALTER TABLE contacts ADD CONSTRAINT fk_contacts_property
  FOREIGN KEY (property_id) REFERENCES properties(property_id) ON DELETE SET NULL
  NOT VALID;

ALTER TABLE ownership_history ADD CONSTRAINT fk_ownership_matched_sale
  FOREIGN KEY (matched_sale_id) REFERENCES sales_transactions(sale_id) ON DELETE SET NULL
  NOT VALID;

-- ── Cascade rule upgrades ───────────────────────────────────────────────────

-- leases → properties: SET NULL (keep lease record, unlink property)
ALTER TABLE leases DROP CONSTRAINT IF EXISTS leases_property_id_fkey;
ALTER TABLE leases ADD CONSTRAINT leases_property_id_fkey
  FOREIGN KEY (property_id) REFERENCES properties(property_id) ON DELETE SET NULL
  NOT VALID;

-- loans → properties: SET NULL
ALTER TABLE loans DROP CONSTRAINT IF EXISTS loans_property_id_fkey;
ALTER TABLE loans ADD CONSTRAINT loans_property_id_fkey
  FOREIGN KEY (property_id) REFERENCES properties(property_id) ON DELETE SET NULL
  NOT VALID;

-- loans → sales_transactions: SET NULL
ALTER TABLE loans DROP CONSTRAINT IF EXISTS loans_sale_id_fkey;
ALTER TABLE loans ADD CONSTRAINT loans_sale_id_fkey
  FOREIGN KEY (sale_id) REFERENCES sales_transactions(sale_id) ON DELETE SET NULL
  NOT VALID;

-- broker_transactions → sales_transactions: CASCADE (role meaningless without sale)
ALTER TABLE broker_transactions DROP CONSTRAINT IF EXISTS broker_transactions_sale_id_fkey;
ALTER TABLE broker_transactions ADD CONSTRAINT broker_transactions_sale_id_fkey
  FOREIGN KEY (sale_id) REFERENCES sales_transactions(sale_id) ON DELETE CASCADE;
