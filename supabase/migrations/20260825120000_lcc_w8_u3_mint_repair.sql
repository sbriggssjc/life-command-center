-- W8 (Prompt 76) — repair the mislabeled USAA Real Estate prior-owner proposal.
--
-- Background: the U3 confirm branch (api/admin.js) minted the proposed entity
-- WITHOUT entities.canonical_name (NOT NULL, no default) → 23502 on every mint.
-- Scott hit this confirming the USAA Real Estate prior-owner proposal
-- (w8_u3_link_review.review_id = 1, subject_ref
-- 'link:chain:gov:6939:no_prior_owners_recorded'); a post-error click then marked
-- the row 'rejected', mislabeling his intent. The JS mint fix ships alongside this.
--
-- This migration resets that ONE row so Scott can confirm it properly post-fix:
--   1. w8_u3_link_review row 1: rejected -> proposed (clear decided_by/decided_at).
--   2. its lcc_decisions verdict row: skipped/reject -> open (supersede the verdict)
--      so the confirm path re-runs.
-- Idempotent (WHERE guards make a re-run a no-op). review_id 2 (Trammell Crow,
-- still 'proposed') is deliberately NOT touched.

-- 1) Un-reject the review row.
UPDATE public.w8_u3_link_review
   SET status = 'proposed',
       decided_by = NULL,
       decided_at = NULL
 WHERE review_id = 1
   AND linked_entity_name = 'USAA Real Estate'
   AND subject_ref = 'link:chain:gov:6939:no_prior_owners_recorded'
   AND status = 'rejected';

-- 2) Supersede the mislabeled verdict decision row (reopen so re-confirm works).
UPDATE public.lcc_decisions
   SET status = 'open',
       verdict = NULL,
       verdict_payload = NULL,
       decided_by = NULL,
       decided_at = NULL,
       effects = COALESCE(effects, '{}'::jsonb)
                 || jsonb_build_object('superseded_reason', 'w8_u3_entity_mint_failed_repair_prompt76'),
       updated_at = now()
 WHERE decision_type = 'w8_u3_link_review'
   AND subject_ref = 'link:chain:gov:6939:no_prior_owners_recorded'
   AND status = 'skipped'
   AND verdict = 'reject';
