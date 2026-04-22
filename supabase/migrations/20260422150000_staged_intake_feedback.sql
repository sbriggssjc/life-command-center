-- ============================================================================
-- Migration: staged_intake_feedback + matcher_accuracy_stats
-- Target:    LCC Opps Supabase (OPS_SUPABASE_URL)
--
-- Purpose: close the self-learning feedback loop for intake matching.
--
-- When the intake-matcher suggests a property (via exact/normalized/fuzzy
-- address or tenant+city+state), a human triager approves, rejects, or
-- corrects the suggestion. Today that decision stays in the triager's head.
-- This migration adds:
--
--   1. staged_intake_feedback — one row per human decision, capturing
--      both what the matcher suggested AND what the human decided. Snapshots
--      the matcher output so the feedback row survives later matcher changes.
--
--   2. matcher_accuracy_stats — rolled-up approval rates by
--      (match_reason × domain × confidence_band × period). Computed nightly
--      by compute_matcher_accuracy(). Used by ops dashboards and (later)
--      for adjusting matcher confidence defaults.
--
--   3. compute_matcher_accuracy() — idempotent rollup function.
--
--   4. v_matcher_accuracy_recent — easy-query view, last 90 days.
--
--   5. pg_cron schedule — nightly at 02:15 UTC.
--
-- Design notes:
--   - decision column is an open CHECK list so we can extend without a new
--     migration when triage UI grows new buttons.
--   - match_id is nullable because early intakes may not have had a match row.
--   - original_* columns capture the matcher output at decision time so we
--     can retrain offline without joining to staged_intake_matches (which
--     may be overwritten by re-runs).
-- ============================================================================

-- 1. staged_intake_feedback ---------------------------------------------------

CREATE TABLE IF NOT EXISTS public.staged_intake_feedback (
    id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id           UUID        NOT NULL,
    intake_id              UUID        NOT NULL,
    match_id               UUID,
    user_id                UUID,

    decision               TEXT        NOT NULL
        CHECK (decision IN (
            'approved',     -- matcher suggestion accepted as-is
            'rejected',     -- matcher suggestion rejected; falls back to unmatched
            'corrected',    -- matcher suggestion replaced with corrected_*
            'deferred',     -- punted to later review
            'no_match'      -- human confirms this property isn't in any known DB
        )),

    -- Snapshot of the matcher's suggestion at decision time. Survives later
    -- matcher changes; enables offline retraining without brittle joins.
    original_match_reason  TEXT,
    original_domain        TEXT,       -- 'lcc' | 'dialysis' | 'government' | NULL
    original_property_id   TEXT,       -- text because UUID (lcc) and integer (dia/gov) both appear
    original_confidence    NUMERIC(4,3),

    -- If the human picked a different property than the matcher suggested.
    corrected_domain       TEXT,
    corrected_property_id  TEXT,

    reason_text            TEXT,       -- free-form human note
    metadata               JSONB       NOT NULL DEFAULT '{}'::jsonb,

    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sif_workspace_created
    ON public.staged_intake_feedback (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sif_intake
    ON public.staged_intake_feedback (intake_id);

CREATE INDEX IF NOT EXISTS idx_sif_decision
    ON public.staged_intake_feedback (decision, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sif_original_reason
    ON public.staged_intake_feedback (original_match_reason, original_domain);

-- One feedback row per (intake, user) to prevent accidental double-votes.
-- Null user_id allowed (system-generated), multiple system rows allowed.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sif_intake_user
    ON public.staged_intake_feedback (intake_id, user_id)
    WHERE user_id IS NOT NULL;

-- Keep updated_at in sync.
CREATE OR REPLACE FUNCTION public._staged_intake_feedback_set_updated()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sif_set_updated
    ON public.staged_intake_feedback;
CREATE TRIGGER trg_sif_set_updated
    BEFORE UPDATE ON public.staged_intake_feedback
    FOR EACH ROW EXECUTE FUNCTION public._staged_intake_feedback_set_updated();

-- 2. matcher_accuracy_stats ---------------------------------------------------

CREATE TABLE IF NOT EXISTS public.matcher_accuracy_stats (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    period_start      DATE        NOT NULL,
    period_end        DATE        NOT NULL,
    match_reason      TEXT,       -- nullable for the "unknown reason" bucket
    domain            TEXT,
    confidence_band   TEXT        NOT NULL,

    total_matches     INTEGER     NOT NULL DEFAULT 0,
    approved_count    INTEGER     NOT NULL DEFAULT 0,
    rejected_count    INTEGER     NOT NULL DEFAULT 0,
    corrected_count   INTEGER     NOT NULL DEFAULT 0,
    deferred_count    INTEGER     NOT NULL DEFAULT 0,
    no_match_count    INTEGER     NOT NULL DEFAULT 0,
    approval_rate     NUMERIC(4,3),

    computed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotency key so compute_matcher_accuracy() can UPSERT.
-- COALESCE makes NULL dimensions uniquely represented.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mas_period_dims
    ON public.matcher_accuracy_stats (
        period_start, period_end,
        COALESCE(match_reason, ''),
        COALESCE(domain, ''),
        confidence_band
    );

CREATE INDEX IF NOT EXISTS idx_mas_period_end
    ON public.matcher_accuracy_stats (period_end DESC);

-- 3. compute_matcher_accuracy() ----------------------------------------------

CREATE OR REPLACE FUNCTION public.compute_matcher_accuracy(p_days INTEGER DEFAULT 30)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_period_start DATE    := (CURRENT_DATE - p_days)::DATE;
    v_period_end   DATE    := CURRENT_DATE;
    v_row_count    INTEGER := 0;
BEGIN
    INSERT INTO public.matcher_accuracy_stats (
        period_start, period_end,
        match_reason, domain, confidence_band,
        total_matches, approved_count, rejected_count,
        corrected_count, deferred_count, no_match_count,
        approval_rate, computed_at
    )
    SELECT
        v_period_start,
        v_period_end,
        original_match_reason,
        original_domain,
        CASE
            WHEN original_confidence IS NULL       THEN 'unknown'
            WHEN original_confidence >= 0.95       THEN '0.95-1.00'
            WHEN original_confidence >= 0.85       THEN '0.85-0.95'
            WHEN original_confidence >= 0.70       THEN '0.70-0.85'
            WHEN original_confidence >= 0.50       THEN '0.50-0.70'
            ELSE                                         '0.00-0.50'
        END                                                           AS confidence_band,
        COUNT(*)                                                       AS total_matches,
        COUNT(*) FILTER (WHERE decision = 'approved')                  AS approved_count,
        COUNT(*) FILTER (WHERE decision = 'rejected')                  AS rejected_count,
        COUNT(*) FILTER (WHERE decision = 'corrected')                 AS corrected_count,
        COUNT(*) FILTER (WHERE decision = 'deferred')                  AS deferred_count,
        COUNT(*) FILTER (WHERE decision = 'no_match')                  AS no_match_count,
        CASE WHEN COUNT(*) > 0
            THEN ROUND(COUNT(*) FILTER (WHERE decision = 'approved')::NUMERIC / COUNT(*), 3)
            ELSE NULL
        END                                                           AS approval_rate,
        NOW()
    FROM public.staged_intake_feedback
    WHERE created_at >= v_period_start::TIMESTAMPTZ
      AND created_at <  (v_period_end + INTERVAL '1 day')::TIMESTAMPTZ
    GROUP BY original_match_reason, original_domain, 5
    ON CONFLICT (
        period_start, period_end,
        COALESCE(match_reason, ''),
        COALESCE(domain, ''),
        confidence_band
    )
    DO UPDATE SET
        total_matches    = EXCLUDED.total_matches,
        approved_count   = EXCLUDED.approved_count,
        rejected_count   = EXCLUDED.rejected_count,
        corrected_count  = EXCLUDED.corrected_count,
        deferred_count   = EXCLUDED.deferred_count,
        no_match_count   = EXCLUDED.no_match_count,
        approval_rate    = EXCLUDED.approval_rate,
        computed_at      = NOW();

    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    RETURN v_row_count;
END;
$$;

-- 4. v_matcher_accuracy_recent -----------------------------------------------

CREATE OR REPLACE VIEW public.v_matcher_accuracy_recent AS
SELECT
    match_reason,
    domain,
    confidence_band,
    SUM(total_matches)    AS total,
    SUM(approved_count)   AS approved,
    SUM(rejected_count)   AS rejected,
    SUM(corrected_count)  AS corrected,
    SUM(deferred_count)   AS deferred,
    SUM(no_match_count)   AS no_match,
    CASE WHEN SUM(total_matches) > 0
        THEN ROUND(SUM(approved_count)::NUMERIC / SUM(total_matches), 3)
        ELSE NULL
    END                   AS approval_rate
FROM public.matcher_accuracy_stats
WHERE period_end >= (CURRENT_DATE - 90)
GROUP BY match_reason, domain, confidence_band
ORDER BY SUM(total_matches) DESC;

-- 5. pg_cron schedule --------------------------------------------------------

-- Nightly at 02:15 UTC — after most intake activity has settled.
-- Safe to run repeatedly; the function is idempotent via ON CONFLICT.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.unschedule('matcher-accuracy-rollup')
            WHERE EXISTS (
                SELECT 1 FROM cron.job WHERE jobname = 'matcher-accuracy-rollup'
            );
        PERFORM cron.schedule(
            'matcher-accuracy-rollup',
            '15 2 * * *',
            $cron$SELECT public.compute_matcher_accuracy(30);$cron$
        );
    END IF;
END$$;

-- Prime the stats table with whatever feedback already exists (no-op on a
-- fresh DB, but useful if this migration is re-applied to a running system).
SELECT public.compute_matcher_accuracy(30);

COMMENT ON TABLE  public.staged_intake_feedback IS
    'Human decisions on matcher suggestions. Feeds compute_matcher_accuracy() for self-learning.';
COMMENT ON TABLE  public.matcher_accuracy_stats IS
    'Rolled-up approval rates by (match_reason × domain × confidence_band). Updated nightly via pg_cron.';
COMMENT ON VIEW   public.v_matcher_accuracy_recent IS
    'Last 90 days of matcher accuracy, grouped by reason/domain/band. Sort desc by volume.';
