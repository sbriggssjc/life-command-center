-- ============================================================================
-- R15 Phase 2b (blocker 0) — allow domain='cre' on entities  ·  LCC Opps
--
-- Phase 1's note claimed entities.domain='cre' had no CHECK constraint. That was
-- WRONG: chk_entities_domain allowed only dia/gov/lcc, so every CRE owner mint
-- failed at the entities INSERT with 23514 ("Failed to create canonical entity"
-- → owner_rejected). This widens the constraint to include 'cre'.
--
-- Already applied live to LCC Opps 2026-06-13 (the backfill needed it to mint at
-- all); this file is the repo PARITY copy so a future replay/rebuild can't
-- silently re-narrow it. Idempotent (drop-if-exists + re-add); re-applying is a
-- no-op against the already-widened live constraint.
-- ============================================================================

DO $$
BEGIN
  ALTER TABLE public.entities DROP CONSTRAINT IF EXISTS chk_entities_domain;
  ALTER TABLE public.entities ADD CONSTRAINT chk_entities_domain
    CHECK (domain IS NULL OR domain = ANY (ARRAY['dia', 'gov', 'lcc', 'cre']));
END $$;
