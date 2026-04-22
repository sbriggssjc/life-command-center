-- ============================================================================
-- Migration: staged_intake_matches
-- Target:    LCC Opps Supabase (OPS_SUPABASE_URL)
--
-- The intake matcher (/api/_handlers/intake-matcher.js) writes a row here
-- after every extraction so triage UIs and feedback rollups have something
-- to query. The table was missing entirely — writes have been 404ing all
-- day and the error was logged-and-continued, so match results existed
-- only in the extract-endpoint response and never landed on disk.
--
-- Columns match the shape the handler already posts:
--   const insertResult = await opsQuery('POST', 'staged_intake_matches', {
--     intake_id, decision, reason, property_id, confidence, match_result
--   });
--
-- `property_id` is TEXT because LCC entities use UUIDs while dialysis/
-- government use integers. The handler already stringifies before POST.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.staged_intake_matches (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id   UUID,
    intake_id      UUID        NOT NULL,

    decision       TEXT        NOT NULL
        CHECK (decision IN ('auto_matched', 'needs_review')),
    reason         TEXT,
    domain         TEXT,                            -- lcc | dialysis | government | NULL
    property_id    TEXT,                            -- string-form; varies by domain
    confidence     NUMERIC(4,3),

    match_result   JSONB       NOT NULL DEFAULT '{}'::jsonb,

    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sim_intake_created
    ON public.staged_intake_matches (intake_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sim_workspace_created
    ON public.staged_intake_matches (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sim_decision
    ON public.staged_intake_matches (decision, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sim_domain_reason
    ON public.staged_intake_matches (domain, reason);

-- Keep updated_at in sync.
CREATE OR REPLACE FUNCTION public._staged_intake_matches_set_updated()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sim_set_updated ON public.staged_intake_matches;
CREATE TRIGGER trg_sim_set_updated
    BEFORE UPDATE ON public.staged_intake_matches
    FOR EACH ROW EXECUTE FUNCTION public._staged_intake_matches_set_updated();

COMMENT ON TABLE public.staged_intake_matches IS
    'Matcher output for each intake. One row per matcher run. Latest-per-intake is the authoritative match.';
