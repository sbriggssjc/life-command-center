-- ============================================================================
-- Migration: lease_extensions + lease_rent_schedule tables, v_lease_extensions_summary view
-- Target:    Dialysis domain Supabase (DIA_SUPABASE_URL)
--
-- detail.js _udFetchLeaseEnrichment() queries these to populate:
--   - lease_rent_schedule: year-by-year rent schedule per lease (Rent Schedule sub-tab)
--   - v_lease_extensions_summary: extension count + last date (Lease details card)
-- Previously these didn't exist; the .catch(() => []) silenced the 404s and
-- detail.js fell back to synthesizing rent schedules from escalation strings.
-- ============================================================================

-- lease_extensions: stores amendment/extension events for a lease
CREATE TABLE IF NOT EXISTS public.lease_extensions (
    id                  SERIAL PRIMARY KEY,
    lease_id            INTEGER NOT NULL REFERENCES public.leases(lease_id),
    property_id         INTEGER,
    extension_date      DATE,
    new_expiration      DATE,
    new_annual_rent     NUMERIC,
    new_rent_psf        NUMERIC,
    term_added_months   INTEGER,
    notes               TEXT,
    data_source         TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lease_extensions_lease_id ON public.lease_extensions(lease_id);
CREATE INDEX IF NOT EXISTS idx_lease_extensions_property_id ON public.lease_extensions(property_id);

ALTER TABLE public.lease_extensions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon read lease_extensions" ON public.lease_extensions;
CREATE POLICY "Allow anon read lease_extensions" ON public.lease_extensions FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "Allow anon write lease_extensions" ON public.lease_extensions;
CREATE POLICY "Allow anon write lease_extensions" ON public.lease_extensions FOR ALL TO anon USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON public.lease_extensions TO anon;
GRANT USAGE, SELECT ON SEQUENCE public.lease_extensions_id_seq TO anon;

-- lease_rent_schedule: year-by-year rent schedule per lease
CREATE TABLE IF NOT EXISTS public.lease_rent_schedule (
    id                  SERIAL PRIMARY KEY,
    lease_id            INTEGER NOT NULL REFERENCES public.leases(lease_id),
    property_id         INTEGER,
    lease_year          INTEGER NOT NULL,
    period_start        DATE,
    period_end          DATE,
    base_rent           NUMERIC,
    rent_psf            NUMERIC,
    bump_pct            NUMERIC,
    cumulative_rent     NUMERIC,
    is_option_window    BOOLEAN DEFAULT FALSE,
    source              TEXT DEFAULT 'ingestion',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lease_rent_schedule_lease_id ON public.lease_rent_schedule(lease_id);
CREATE INDEX IF NOT EXISTS idx_lease_rent_schedule_property_id ON public.lease_rent_schedule(property_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lease_rent_schedule_lease_year ON public.lease_rent_schedule(lease_id, lease_year);

ALTER TABLE public.lease_rent_schedule ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anon read lease_rent_schedule" ON public.lease_rent_schedule;
CREATE POLICY "Allow anon read lease_rent_schedule" ON public.lease_rent_schedule FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "Allow anon write lease_rent_schedule" ON public.lease_rent_schedule;
CREATE POLICY "Allow anon write lease_rent_schedule" ON public.lease_rent_schedule FOR ALL TO anon USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON public.lease_rent_schedule TO anon;
GRANT USAGE, SELECT ON SEQUENCE public.lease_rent_schedule_id_seq TO anon;

-- v_lease_extensions_summary: aggregated extension count + last date per lease
CREATE OR REPLACE VIEW public.v_lease_extensions_summary AS
SELECT
  le.lease_id,
  le.property_id,
  COUNT(*)::INTEGER AS extension_count,
  MAX(le.extension_date) AS last_extension_date,
  MAX(le.new_expiration) AS latest_expiration,
  MAX(le.new_annual_rent) AS latest_annual_rent
FROM public.lease_extensions le
GROUP BY le.lease_id, le.property_id;

GRANT SELECT ON public.v_lease_extensions_summary TO anon;
