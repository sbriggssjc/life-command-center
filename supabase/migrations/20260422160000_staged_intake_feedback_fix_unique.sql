-- ============================================================================
-- Migration: swap partial unique index on staged_intake_feedback
-- Target:    LCC Opps Supabase (OPS_SUPABASE_URL)
--
-- The previous migration created `uq_sif_intake_user` as a PARTIAL unique
-- index (WHERE user_id IS NOT NULL). That makes PostgREST's
-- `on_conflict=intake_id,user_id` resolution unreliable because PostgREST
-- cannot always target a partial index for ON CONFLICT clauses.
--
-- Swap to a plain (non-partial) unique index. Standard SQL treats multiple
-- NULL user_ids as distinct, so system-generated feedback rows (user_id IS
-- NULL) can still coexist without conflict, while authenticated users are
-- still bounded to one feedback row per intake.
-- ============================================================================

DROP INDEX IF EXISTS public.uq_sif_intake_user;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sif_intake_user
    ON public.staged_intake_feedback (intake_id, user_id);
