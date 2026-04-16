-- ============================================================================
-- Migration: property_sale_events + ingestion_log tables
-- Target:    Government domain Supabase (GOV_SUPABASE_URL)
--
-- detail.js prefers property_sale_events as the canonical sale source,
-- falling back to sales_transactions when the table isn't reachable.
-- gov.js queries ingestion_log for data freshness in the Operations tab.
-- ============================================================================

-- property_sale_events: canonical sale event table (mirrors dialysis schema)
CREATE TABLE IF NOT EXISTS public.property_sale_events (
    sale_event_id       BIGSERIAL PRIMARY KEY,
    property_id         BIGINT,
    sale_date           DATE,
    price               NUMERIC,
    cap_rate            NUMERIC,
    buyer_id            UUID,
    seller_id           UUID,
    broker_id           UUID,
    buyer_name          TEXT,
    seller_name         TEXT,
    broker_name         TEXT,
    source              TEXT,
    notes               TEXT,
    sales_transaction_id BIGINT,
    ownership_history_id BIGINT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pse_property_id ON public.property_sale_events(property_id);
CREATE INDEX IF NOT EXISTS idx_pse_sale_date ON public.property_sale_events(sale_date DESC NULLS LAST);

ALTER TABLE public.property_sale_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon read property_sale_events" ON public.property_sale_events;
CREATE POLICY "Allow anon read property_sale_events" ON public.property_sale_events FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "Allow anon write property_sale_events" ON public.property_sale_events;
CREATE POLICY "Allow anon write property_sale_events" ON public.property_sale_events FOR ALL TO anon USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON public.property_sale_events TO anon;
GRANT USAGE, SELECT ON SEQUENCE public.property_sale_events_sale_event_id_seq TO anon;

-- ingestion_log: tracks freshness of data ingestion by source
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
