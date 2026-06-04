-- ===========================================================================
-- R4-A: CHECK constraint guarding external_identities.source_system
-- Target DB: LCC Opps (xengecqvemvfknjvbvrq)
-- Date: 2026-06-04
--
-- ⚠️ DEPLOY ORDERING — APPLY ONLY AFTER the Railway redeploy of merged `main`
--    ships the canonical JS writers (R4-A entity-link.js canonicalIdentitySystem
--    + the sidebar/intake-promoter/domains/entities-handler sweep). The
--    currently-deployed writers still emit 'dia_db'/'gov_db'; applying this
--    constraint before they redeploy would make every CoStar capture / intake
--    promotion FAIL on the external_identities insert. Same rule as always:
--    constraint AFTER writer deploy.
--
-- Pre-apply check (must return 0):
--   SELECT count(*) FROM external_identities
--   WHERE source_system NOT IN (
--     'dia','gov','salesforce','sf','costar','rca','crexi','loopnet',
--     'outlook','email_intake','intake_email','sharepoint','calendar',
--     'availability_scraper');
--
-- The allow-list = canonical domains ('dia','gov') + the external vendor /
-- channel systems actually written by the codebase. Extend it (here) when a
-- new vendor connector lands — a bad/typo domain spelling will then fail loudly
-- instead of silently fragmenting the entity graph (the 6th-spelling guard).
--
-- NOT VALID: enforces on every new INSERT/UPDATE immediately without taking a
-- full-table validation lock. Run `VALIDATE CONSTRAINT` later in a quiet window
-- once you have confirmed zero violating rows (the R4-A normalization migration
-- 20260604120000 already cleared them).
-- ===========================================================================

ALTER TABLE public.external_identities
  DROP CONSTRAINT IF EXISTS chk_external_identities_source_system;

ALTER TABLE public.external_identities
  ADD CONSTRAINT chk_external_identities_source_system
  CHECK (source_system IN (
    'dia', 'gov',
    'salesforce', 'sf',
    'costar', 'rca', 'crexi', 'loopnet',
    'outlook', 'email_intake', 'intake_email',
    'sharepoint', 'calendar', 'availability_scraper'
  )) NOT VALID;

-- After a clean window, optionally promote to fully validated:
--   ALTER TABLE public.external_identities
--     VALIDATE CONSTRAINT chk_external_identities_source_system;
