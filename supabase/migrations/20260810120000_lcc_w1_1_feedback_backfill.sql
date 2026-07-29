-- ============================================================================
-- Migration: W1.1 matcher-feedback backfill (audit finding 3.4.3)
-- Target:    LCC Opps Supabase (xengecqvemvfknjvbvrq)
--
-- Purpose: the self-learning feedback loop (staged_intake_feedback →
--   compute_matcher_accuracy → v_matcher_accuracy_recent) shipped in
--   2026-04 but had essentially no data — the Decision Center verdict paths
--   and the human promote path never wrote a feedback row (fixed in the paired
--   JS change). This migration seeds HISTORICAL labels from the ~4,235
--   staged_intake_promotions: a human promote is an implicit APPROVAL of the
--   matcher's #1 suggestion, so each promoted intake becomes one 'approved'
--   feedback row snapshotting its FINAL staged_intake_matches row
--   (match_reason + confidence → the accuracy bands).
--
-- Discipline (repo convention):
--   * fill-only        — never touches an intake that already has feedback
--                        (NOT EXISTS guard) so live rows are never clobbered.
--   * batch-tagged     — metadata.source = 'backfill_w1_1'.
--   * reversible       — every inserted id is logged to a ledger table; the
--                        REVERT block at the foot deletes exactly those rows.
--   * idempotent       — re-running inserts nothing new (the NOT EXISTS guard
--                        matches the rows this run created).
-- ============================================================================

-- 1. Reversible ledger --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.staged_intake_feedback_backfill_w1_1_log (
    feedback_id   UUID        PRIMARY KEY,
    intake_id     UUID        NOT NULL,
    user_id       UUID,
    match_id      UUID,
    decision      TEXT        NOT NULL,
    inserted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.staged_intake_feedback_backfill_w1_1_log IS
    'Reversible ledger for the W1.1 promotion→feedback backfill (source=backfill_w1_1). '
    'REVERT: DELETE FROM staged_intake_feedback f USING this ledger l WHERE f.id = l.feedback_id;';

-- 2. Backfill -----------------------------------------------------------------
WITH final AS (
    -- One row per distinct promoted intake: its most-recent promotion (for the
    -- promoter identity) joined to its FINAL matcher row (latest by created_at).
    SELECT DISTINCT ON (p.intake_id)
        p.intake_id,
        p.workspace_id,
        p.promoted_by,
        m.id            AS match_id,
        m.reason        AS match_reason,
        m.domain        AS match_domain,
        m.property_id   AS match_property_id,
        m.confidence    AS match_confidence,
        m.match_result  AS match_result,
        m.decision      AS match_decision
    FROM public.staged_intake_promotions p
    JOIN public.staged_intake_matches   m ON m.intake_id = p.intake_id
    ORDER BY p.intake_id, p.promoted_at DESC NULLS LAST, m.created_at DESC, m.id DESC
),
ins AS (
    INSERT INTO public.staged_intake_feedback (
        workspace_id, intake_id, match_id, user_id, decision,
        original_match_reason, original_domain, original_property_id, original_confidence,
        reason_text, metadata
    )
    SELECT
        f.workspace_id,
        f.intake_id,
        f.match_id,
        f.promoted_by,
        'approved',                                    -- implicit approve
        f.match_reason,
        COALESCE(f.match_result->>'domain', f.match_domain),
        f.match_property_id,
        f.match_confidence,
        'intake_promote_backfill',
        jsonb_build_object(
            'source',          'backfill_w1_1',
            'batch_tag',       'backfill_w1_1',
            'implicit',        true,
            'promotion_backfill', true,
            'match_decision',  f.match_decision,
            'confidence_band', CASE
                WHEN f.match_confidence IS NULL  THEN 'unknown'
                WHEN f.match_confidence >= 0.95  THEN '0.95-1.00'
                WHEN f.match_confidence >= 0.85  THEN '0.85-0.95'
                WHEN f.match_confidence >= 0.70  THEN '0.70-0.85'
                WHEN f.match_confidence >= 0.50  THEN '0.50-0.70'
                ELSE '0.00-0.50' END
        )
    FROM final f
    WHERE NOT EXISTS (
        -- Skip any intake that already carries feedback (live rows from the
        -- new JS paths, or a prior run of this backfill). Makes it idempotent
        -- and non-clobbering.
        SELECT 1 FROM public.staged_intake_feedback e WHERE e.intake_id = f.intake_id
    )
    -- Belt-and-suspenders for the user-bearing partial unique index.
    ON CONFLICT (intake_id, user_id) WHERE user_id IS NOT NULL DO NOTHING
    RETURNING id, intake_id, user_id, match_id, decision
)
INSERT INTO public.staged_intake_feedback_backfill_w1_1_log
    (feedback_id, intake_id, user_id, match_id, decision)
SELECT id, intake_id, user_id, match_id, decision FROM ins
ON CONFLICT (feedback_id) DO NOTHING;

-- 3. Refresh the accuracy rollup so v_matcher_accuracy_recent reflects the
--    backfilled labels immediately (the nightly cron would otherwise wait).
-- The backfilled rows carry created_at = NOW(), so the cron's own 30-day
--    window captures 100% of them. Use the SAME p_days as the nightly cron so
--    we write the SAME (period_start, period_end) rows (ON CONFLICT updates in
--    place) — a divergent window sharing today's period_end would be summed a
--    second time by v_matcher_accuracy_recent (the double-count fix keys on
--    MAX(period_end)).
SELECT public.compute_matcher_accuracy(30);

-- ============================================================================
-- REVERT (run manually to undo this backfill):
--
--   DELETE FROM public.staged_intake_feedback f
--    USING public.staged_intake_feedback_backfill_w1_1_log l
--    WHERE f.id = l.feedback_id;
--   TRUNCATE public.staged_intake_feedback_backfill_w1_1_log;
--   SELECT public.compute_matcher_accuracy(30);    -- recompute after removal
--   -- (optional) DROP TABLE public.staged_intake_feedback_backfill_w1_1_log;
-- ============================================================================
