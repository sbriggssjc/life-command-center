-- ============================================================================
-- Migration: Dialysis DB — CHECK constraints, missing FKs, cascade rules
-- Target:    Dialysis domain Supabase (DIA_SUPABASE_URL)
--
-- Adds data quality guards (cap rate range, positive prices, date sanity),
-- missing foreign keys (lease_extensions/lease_rent_schedule → properties,
-- contacts → properties), and upgrades cascade behavior on child tables.
-- ============================================================================

-- ── CHECK constraints ───────────────────────────────────────────────────────

-- Cap rates must be in decimal form (0.5% to 30%)
ALTER TABLE sales_transactions ADD CONSTRAINT chk_cap_rate_range
  CHECK (cap_rate IS NULL OR (cap_rate >= 0.005 AND cap_rate <= 0.30))
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

-- Lease expiration must be a reasonable date
ALTER TABLE leases ADD CONSTRAINT chk_lease_expiration_range
  CHECK (lease_expiration IS NULL OR (lease_expiration >= '1950-01-01' AND lease_expiration <= '2100-01-01'))
  NOT VALID;

-- ── Missing foreign keys ────────────────────────────────────────────────────

ALTER TABLE lease_extensions ADD CONSTRAINT fk_lease_extensions_property
  FOREIGN KEY (property_id) REFERENCES properties(property_id) ON DELETE SET NULL
  NOT VALID;

ALTER TABLE lease_rent_schedule ADD CONSTRAINT fk_lease_rent_schedule_property
  FOREIGN KEY (property_id) REFERENCES properties(property_id) ON DELETE SET NULL
  NOT VALID;

ALTER TABLE contacts ADD CONSTRAINT fk_contacts_property
  FOREIGN KEY (property_id) REFERENCES properties(property_id) ON DELETE SET NULL
  NOT VALID;

-- ── Cascade rule upgrades ───────────────────────────────────────────────────

-- lease_extensions → leases: CASCADE delete (extension meaningless without lease)
ALTER TABLE lease_extensions DROP CONSTRAINT IF EXISTS lease_extensions_lease_id_fkey;
ALTER TABLE lease_extensions ADD CONSTRAINT lease_extensions_lease_id_fkey
  FOREIGN KEY (lease_id) REFERENCES leases(lease_id) ON DELETE CASCADE;

-- lease_rent_schedule → leases: CASCADE delete
ALTER TABLE lease_rent_schedule DROP CONSTRAINT IF EXISTS lease_rent_schedule_lease_id_fkey;
ALTER TABLE lease_rent_schedule ADD CONSTRAINT lease_rent_schedule_lease_id_fkey
  FOREIGN KEY (lease_id) REFERENCES leases(lease_id) ON DELETE CASCADE;

-- ownership_history → sales_transactions: SET NULL (keep ownership record)
ALTER TABLE ownership_history DROP CONSTRAINT IF EXISTS ownership_history_sale_id_fkey;
ALTER TABLE ownership_history ADD CONSTRAINT ownership_history_sale_id_fkey
  FOREIGN KEY (sale_id) REFERENCES sales_transactions(sale_id) ON DELETE SET NULL;
