-- R9 Slice 2 (2026-06-09): chain-owner connection worker -- effects ledger.
-- ===========================================================================
-- Unit 2 #1 (chain phase 3(c), part 1): the chain-connection worker walks each
-- incomplete-chain property's HISTORICAL owners (domain ownership_history +
-- sales buyer/seller/developer names) and ensures each is a real, non-junk LCC
-- entity via the existing ensureEntityLink path -- making the ownership chain
-- REAL in the entity graph so the P0/P5 developer bands have fuel.
--
-- This migration adds ONLY the per-property effects ledger that (a) records what
-- the worker did (entities created vs linked vs skipped-junk vs errored), and
-- (b) is the idempotent batch cursor: the worker drains chain properties NOT yet
-- in the ledger, ordered by rent, so repeated POSTs advance through the backlog
-- without reprocessing. ensureEntityLink is itself idempotent (find-or-create by
-- canonical name), so even a forced reprocess is safe -- the ledger just bounds
-- the work per tick.
--
-- NO classification, NO research-task reconciliation, NO cron here (Slice 3).
-- DB-safety: additive, idempotent, entity-scale, no auth-schema contact.

BEGIN;

CREATE TABLE IF NOT EXISTS public.lcc_chain_connection_log (
  source_domain       text        NOT NULL CHECK (source_domain IN ('dia','gov')),
  source_property_id  text        NOT NULL,
  processed_at        timestamptz NOT NULL DEFAULT now(),
  owners_seen         integer     NOT NULL DEFAULT 0,
  entities_created    integer     NOT NULL DEFAULT 0,
  entities_linked     integer     NOT NULL DEFAULT 0,
  skipped_junk        integer     NOT NULL DEFAULT 0,
  errored             integer     NOT NULL DEFAULT 0,
  -- ids + scalar facts only (the artifact-offload / disk-incident lesson):
  -- the per-owner names + outcomes for the most recent walk, bounded by the
  -- handful of owners on a property. NEVER inline docs.
  detail              jsonb,
  PRIMARY KEY (source_domain, source_property_id)
);

CREATE INDEX IF NOT EXISTS idx_lcc_chain_connection_log_processed
  ON public.lcc_chain_connection_log (processed_at);

COMMENT ON TABLE public.lcc_chain_connection_log IS
  'R9 Slice 2: per-property effects ledger + idempotent batch cursor for the '
  'chain-owner connection worker (api/admin.js handleChainConnectTick -> '
  '/api/chain-connect-tick). One row per chain property whose historical owners '
  'have been walked through ensureEntityLink. Records created/linked/skipped_junk/'
  'errored counts; the worker drains chain properties NOT yet logged, by rent.';

GRANT SELECT ON public.lcc_chain_connection_log TO authenticated;

COMMIT;
