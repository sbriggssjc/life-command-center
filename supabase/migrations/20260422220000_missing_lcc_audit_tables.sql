-- ============================================================================
-- Migration: create three LCC Opps audit tables that code has been POSTing
--            to without them existing (silent 404 failures all along).
-- Target:    LCC Opps Supabase (OPS_SUPABASE_URL)
--
-- Callers:
--   - staged_intake_promotions  — written by intake.js when a human promotes
--                                 a staged intake into an LCC entity.
--   - data_corrections          — written by apply-change.js and contacts-
--                                 handler.js as an append-only audit log
--                                 of every cross-DB mutation.
--   - listing_bd_runs           — written by _shared/listing-bd.js to track
--                                 BD campaign execution; read by
--                                 retrieve-entity-context.js.
--
-- All three have been silently failing writes since their callers were
-- introduced. Creating them now captures forward-going audit data; no
-- historical data exists to backfill.
-- ============================================================================

-- staged_intake_promotions
CREATE TABLE IF NOT EXISTS public.staged_intake_promotions (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id     UUID        NOT NULL,
    intake_id        UUID        NOT NULL,
    entity_id        UUID,
    promoted_by      UUID,
    pipeline_result  JSONB       NOT NULL DEFAULT '{}'::jsonb,
    promoted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sip_intake    ON public.staged_intake_promotions (intake_id);
CREATE INDEX IF NOT EXISTS idx_sip_entity    ON public.staged_intake_promotions (entity_id);
CREATE INDEX IF NOT EXISTS idx_sip_workspace ON public.staged_intake_promotions (workspace_id, promoted_at DESC);

-- data_corrections
CREATE TABLE IF NOT EXISTS public.data_corrections (
    id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id           UUID        NOT NULL,
    actor                  TEXT,
    source_surface         TEXT,
    target_table           TEXT,
    target_source          TEXT,
    record_identifier      TEXT,
    id_column              TEXT,
    mutation_mode          TEXT,
    applied_mode           TEXT,
    match_filters          JSONB       NOT NULL DEFAULT '{}'::jsonb,
    changed_fields         JSONB       NOT NULL DEFAULT '{}'::jsonb,
    notes                  TEXT,
    pending_update_id      UUID,
    propagation_scope      TEXT,
    reconciliation_result  JSONB       NOT NULL DEFAULT '{}'::jsonb,
    propagation_result     JSONB       NOT NULL DEFAULT '{}'::jsonb,
    applied_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dc_workspace ON public.data_corrections (workspace_id, applied_at DESC);
CREATE INDEX IF NOT EXISTS idx_dc_target    ON public.data_corrections (target_source, target_table, record_identifier);
CREATE INDEX IF NOT EXISTS idx_dc_pending   ON public.data_corrections (pending_update_id) WHERE pending_update_id IS NOT NULL;

-- listing_bd_runs
CREATE TABLE IF NOT EXISTS public.listing_bd_runs (
    id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id       UUID        NOT NULL,
    listing_entity_id  UUID,
    listing_name       TEXT,
    listing_state      TEXT,
    listing_city       TEXT,
    listing_domain     TEXT,
    asset_type         TEXT,
    sf_deal_id         TEXT,
    deal_status        TEXT,
    t011_matched       INTEGER     NOT NULL DEFAULT 0,
    t011_queued        INTEGER     NOT NULL DEFAULT 0,
    t012_matched       INTEGER     NOT NULL DEFAULT 0,
    t012_queued        INTEGER     NOT NULL DEFAULT 0,
    total_queued       INTEGER     NOT NULL DEFAULT 0,
    trigger_source     TEXT,
    triggered_by       UUID,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lbd_workspace ON public.listing_bd_runs (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lbd_entity    ON public.listing_bd_runs (listing_entity_id);
CREATE INDEX IF NOT EXISTS idx_lbd_sf_deal   ON public.listing_bd_runs (sf_deal_id);

COMMENT ON TABLE public.staged_intake_promotions IS 'Audit trail when a human promotes a staged intake to an LCC entity.';
COMMENT ON TABLE public.data_corrections         IS 'Append-only audit log for cross-DB data mutations via apply-change.';
COMMENT ON TABLE public.listing_bd_runs          IS 'Tracking rows for outbound BD campaigns triggered by new listings.';
