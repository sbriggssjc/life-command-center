-- ============================================================================
-- Migration: v_npi_inventory_signal_summary view
-- Target:    Dialysis domain Supabase (DIA_SUPABASE_URL)
--
-- dialysis.js queries this view on load to populate diaData.npiSummary
-- (keyed by signal_type). Previously the view didn't exist, returning 404
-- through the data-query edge function. The .catch(() => []) silenced the
-- error but left the NPI signal counts empty on the Research tab dashboard.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_npi_inventory_signal_summary AS
SELECT
  signal_type,
  COUNT(*) AS signal_count
FROM public.v_npi_inventory_signals
GROUP BY signal_type;

GRANT SELECT ON public.v_npi_inventory_signal_summary TO anon;
