-- ============================================================================
-- Migration: Dialysis DB hardening — indexes + ingestion_log + auto-stamp triggers
-- Target:    Dialysis domain Supabase (DIA_SUPABASE_URL)
--
-- Adds missing indexes for common frontend query patterns, creates the
-- ingestion_log table (mirrors gov schema), and attaches auto-stamp triggers
-- to all key tables so data freshness is tracked automatically.
-- ============================================================================

-- ── Missing indexes ─────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_contacts_name ON contacts (contact_name);
CREATE INDEX IF NOT EXISTS idx_contacts_normalized_name ON contacts (normalized_name);
CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts (company);
CREATE INDEX IF NOT EXISTS idx_contacts_entity_id ON contacts (entity_id);
CREATE INDEX IF NOT EXISTS idx_contacts_sf_contact_id ON contacts (sf_contact_id);
CREATE INDEX IF NOT EXISTS idx_contacts_true_owner_id ON contacts (true_owner_id);

CREATE INDEX IF NOT EXISTS idx_properties_city_state ON properties (city, state);
CREATE INDEX IF NOT EXISTS idx_properties_property_type ON properties (property_type);
CREATE INDEX IF NOT EXISTS idx_properties_tenant ON properties (tenant);

CREATE INDEX IF NOT EXISTS idx_leases_property_id ON leases (property_id);
CREATE INDEX IF NOT EXISTS idx_leases_tenant ON leases (tenant);
CREATE INDEX IF NOT EXISTS idx_leases_expiration ON leases (lease_expiration DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_leases_status ON leases (status);

CREATE INDEX IF NOT EXISTS idx_sales_transactions_property_id ON sales_transactions (property_id);
CREATE INDEX IF NOT EXISTS idx_sales_transactions_sale_date ON sales_transactions (sale_date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_sales_transactions_buyer_name ON sales_transactions (buyer_name);
CREATE INDEX IF NOT EXISTS idx_sales_transactions_seller_name ON sales_transactions (seller_name);

CREATE INDEX IF NOT EXISTS idx_property_sale_events_sale_date ON property_sale_events (sale_date DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_ownership_history_property_id ON ownership_history (property_id);
CREATE INDEX IF NOT EXISTS idx_ownership_history_sale_id ON ownership_history (sale_id);

-- ── ingestion_log table ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ingestion_log (
    id                  SERIAL PRIMARY KEY,
    source              TEXT NOT NULL,
    max_ingested_at     TIMESTAMPTZ,
    row_count           INTEGER,
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ingestion_log_source ON public.ingestion_log(source);

ALTER TABLE public.ingestion_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon read ingestion_log" ON public.ingestion_log;
CREATE POLICY "Allow anon read ingestion_log" ON public.ingestion_log FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "Allow anon write ingestion_log" ON public.ingestion_log;
CREATE POLICY "Allow anon write ingestion_log" ON public.ingestion_log FOR ALL TO anon USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON public.ingestion_log TO anon;
GRANT USAGE, SELECT ON SEQUENCE public.ingestion_log_id_seq TO anon;

-- ── Auto-stamp function + triggers ──────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS uq_ingestion_log_source ON public.ingestion_log(source);

CREATE OR REPLACE FUNCTION public.stamp_ingestion_log()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  INSERT INTO ingestion_log (source, max_ingested_at, row_count)
  VALUES (TG_TABLE_NAME, NOW(), 1)
  ON CONFLICT (source) DO UPDATE
  SET max_ingested_at = GREATEST(ingestion_log.max_ingested_at, NOW()),
      row_count = ingestion_log.row_count + 1;

  RETURN NULL;
END;
$function$;

CREATE OR REPLACE TRIGGER trg_stamp_ingestion AFTER INSERT OR UPDATE ON properties FOR EACH STATEMENT EXECUTE FUNCTION stamp_ingestion_log();
CREATE OR REPLACE TRIGGER trg_stamp_ingestion AFTER INSERT OR UPDATE ON sales_transactions FOR EACH STATEMENT EXECUTE FUNCTION stamp_ingestion_log();
CREATE OR REPLACE TRIGGER trg_stamp_ingestion AFTER INSERT OR UPDATE ON contacts FOR EACH STATEMENT EXECUTE FUNCTION stamp_ingestion_log();
CREATE OR REPLACE TRIGGER trg_stamp_ingestion AFTER INSERT OR UPDATE ON leases FOR EACH STATEMENT EXECUTE FUNCTION stamp_ingestion_log();
CREATE OR REPLACE TRIGGER trg_stamp_ingestion AFTER INSERT OR UPDATE ON ownership_history FOR EACH STATEMENT EXECUTE FUNCTION stamp_ingestion_log();
CREATE OR REPLACE TRIGGER trg_stamp_ingestion AFTER INSERT OR UPDATE ON property_sale_events FOR EACH STATEMENT EXECUTE FUNCTION stamp_ingestion_log();
CREATE OR REPLACE TRIGGER trg_stamp_ingestion AFTER INSERT OR UPDATE ON lease_extensions FOR EACH STATEMENT EXECUTE FUNCTION stamp_ingestion_log();
CREATE OR REPLACE TRIGGER trg_stamp_ingestion AFTER INSERT OR UPDATE ON lease_rent_schedule FOR EACH STATEMENT EXECUTE FUNCTION stamp_ingestion_log();
CREATE OR REPLACE TRIGGER trg_stamp_ingestion AFTER INSERT OR UPDATE ON facility_patient_counts FOR EACH STATEMENT EXECUTE FUNCTION stamp_ingestion_log();
CREATE OR REPLACE TRIGGER trg_stamp_ingestion AFTER INSERT OR UPDATE ON npi_registry FOR EACH STATEMENT EXECUTE FUNCTION stamp_ingestion_log();
