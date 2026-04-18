-- ============================================================================
-- Migration: Government DB hardening — missing indexes
-- Target:    Government domain Supabase (GOV_SUPABASE_URL)
--
-- Adds missing indexes for common frontend query patterns across all key
-- government domain tables.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts (name);
CREATE INDEX IF NOT EXISTS idx_contacts_normalized_name ON contacts (normalized_name);
CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts (company);
CREATE INDEX IF NOT EXISTS idx_contacts_sf_contact_id ON contacts (sf_contact_id);
CREATE INDEX IF NOT EXISTS idx_contacts_true_owner_id ON contacts (true_owner_id);

CREATE INDEX IF NOT EXISTS idx_properties_city_state ON properties (city, state);
CREATE INDEX IF NOT EXISTS idx_properties_building_type ON properties (building_type);
CREATE INDEX IF NOT EXISTS idx_properties_government_type ON properties (government_type);
CREATE INDEX IF NOT EXISTS idx_properties_agency ON properties (agency_full_name);

CREATE INDEX IF NOT EXISTS idx_leases_property_id ON leases (property_id);
CREATE INDEX IF NOT EXISTS idx_leases_tenant_agency ON leases (tenant_agency);
CREATE INDEX IF NOT EXISTS idx_leases_expiration ON leases (expiration_date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_leases_government_type ON leases (government_type);

CREATE INDEX IF NOT EXISTS idx_sales_transactions_property_id ON sales_transactions (property_id);
CREATE INDEX IF NOT EXISTS idx_sales_transactions_sale_date ON sales_transactions (sale_date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_sales_transactions_buyer ON sales_transactions (buyer);
CREATE INDEX IF NOT EXISTS idx_sales_transactions_seller ON sales_transactions (seller);

CREATE INDEX IF NOT EXISTS idx_broker_transactions_sale_id ON broker_transactions (sale_id);
CREATE INDEX IF NOT EXISTS idx_broker_transactions_broker_id ON broker_transactions (broker_id);

CREATE INDEX IF NOT EXISTS idx_property_sale_events_sale_date ON property_sale_events (sale_date DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_ownership_history_property_id ON ownership_history (property_id);
CREATE INDEX IF NOT EXISTS idx_ownership_history_matched_sale_id ON ownership_history (matched_sale_id);
