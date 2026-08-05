-- ============================================================================
-- W5.2 — NPI signal consumption ledger (LCC Opps xengecqvemvfknjvbvrq)
-- ============================================================================
-- Signal → task automation, dia NPI stream. `dia.mv_npi_inventory_signals`
-- (1,452 rows) is a MATERIALIZED VIEW — it cannot carry a `processed_at` seam
-- column. So consumption is ledgered HERE, ops-side, keyed by a stable signal
-- identity hash computed in the consumer (api/admin.js): the tick / resolver
-- inserts one row per consumed signal and skips a signal already in the ledger.
--
-- Stable identity = md5(signal_type|clinic_id|npi|cluster_winner_medicare_id)
-- (validated live 2026-08-05: 1,452/1,452 distinct across the mv — `npi` alone
-- is NULL for the 504 missing_inventory rows, so clinic_id must be in the key).
-- The consumer is the sole hasher; SQL never recomputes it.
--
-- Routing (deterministic, NO LLM — auditable value gate):
--   • missing_inventory_npi / new_npi   → research_task (consumed_via='research_task')
--   • duplicate_inventory_npi data_error → npi_dedup_review decision lane
--   • duplicate_inventory_npi auto_resolvable → npi_dedup_autoapprove (human
--     APPROVES the deterministic survivor — never a silent auto-collapse)
--   • duplicate_inventory_npi data_quality → digest count only (below floor)
-- Additive + reversible (DROP TABLE). Append-only; never hard-deletes a signal.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.lcc_npi_signal_consumed (
  signal_hash                text PRIMARY KEY,
  signal_type                text NOT NULL,
  severity                   text,
  clinic_id                  text,
  npi                        text,
  cluster_winner_medicare_id text,
  consumed_via               text NOT NULL,            -- 'research_task' | 'decision'
  consumed_reason            text,                     -- verdict or research_type
  research_task_id           uuid,
  decision_id                bigint,
  created_at                 timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.lcc_npi_signal_consumed IS
  'W5.2: consumption ledger for dia.mv_npi_inventory_signals (a matview has no '
  'seam column). One row per consumed signal, keyed by the stable identity hash. '
  'consumed_via research_task (missing/new NPI) or decision (dedup lanes). '
  'Append-only + reversible: DELETE a row to re-surface that signal.';

-- Fast "already consumed?" membership scan by type (the tick filters per type).
CREATE INDEX IF NOT EXISTS idx_lcc_npi_signal_consumed_type
  ON public.lcc_npi_signal_consumed (signal_type, created_at DESC);

GRANT SELECT, INSERT ON public.lcc_npi_signal_consumed TO authenticated, service_role;

COMMIT;

-- ---------------------------------------------------------------------------
-- REVERSAL RUNBOOK
--   DROP TABLE IF EXISTS public.lcc_npi_signal_consumed;
-- To re-surface a single consumed signal to the consumer:
--   DELETE FROM public.lcc_npi_signal_consumed WHERE signal_hash = '<hash>';
-- ---------------------------------------------------------------------------
