-- ===========================================================================
-- CHECK constraint guarding entities.domain (5th dia/gov alias-class fix)
-- Target DB: LCC Opps (xengecqvemvfknjvbvrq)
-- Date: 2026-06-07
--
-- ⚠️ DEPLOY ORDERING — APPLY ONLY AFTER the Railway redeploy of merged `main`
--    ships the canonical JS writers (entity-link.js canonicalEntityDomain at
--    the ensureEntityLink choke point + the domains.js / entities-handler.js
--    sweep). The currently-deployed sidebar bridge still writes long-form
--    'government'/'dialysis' into entities.domain; applying this constraint
--    before that redeploy would make every CoStar capture FAIL on the entity
--    insert. Same rule as R4-A's 20260604121000 (constraint AFTER writer
--    deploy) — the 6th-spelling guard.
--
-- Pre-apply check (must return 0):
--   SELECT count(*) FROM entities
--   WHERE domain IS NOT NULL AND domain NOT IN ('dia','gov','lcc');
--   -- the normalization migration 20260607170000 already cleared the
--   -- long-form rows; this confirms nothing slipped back in.
--
-- Vocabulary: entities.domain ∈ {dia, gov, lcc, NULL}. 'lcc' is the legit
-- LCC-internal third value (E2E#5 rule). Unlike external_identities (which has
-- a vendor allow-list), entities.domain is a CLOSED 3-value enum, so the check
-- is exact.
--
-- NOT VALID: enforces on every new INSERT/UPDATE immediately without taking a
-- full-table validation lock. Promote to VALIDATE CONSTRAINT later in a quiet
-- window once the pre-apply check confirms zero violating rows.
-- ===========================================================================

ALTER TABLE public.entities
  DROP CONSTRAINT IF EXISTS chk_entities_domain;

ALTER TABLE public.entities
  ADD CONSTRAINT chk_entities_domain
  CHECK (domain IS NULL OR domain IN ('dia', 'gov', 'lcc')) NOT VALID;

-- After a clean window, optionally promote to fully validated:
--   ALTER TABLE public.entities VALIDATE CONSTRAINT chk_entities_domain;
