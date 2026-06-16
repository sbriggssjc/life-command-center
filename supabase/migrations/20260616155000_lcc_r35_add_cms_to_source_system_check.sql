-- R35 (2026-06-16): widen chk_external_identities_source_system to allow 'cms'.
-- Target DB: LCC Opps (xengecqvemvfknjvbvrq).
--
-- The R4-A source_system CHECK (migration 20260604121000) is LIVE + VALIDATED.
-- R35 Unit 1 retypes the dia CCN-mislabel asset rows to source_system='cms'
-- (source_type='medicare_ccn'), so 'cms' must be in the allow-list FIRST or the
-- retype UPDATE 23514s. This re-creates the constraint as the prior allow-list
-- PLUS 'cms'. Widening only (a superset), so every existing row already
-- satisfies it -> safe to ADD validated. Idempotent (DROP IF EXISTS + ADD).
--
-- Mirrors the edit made to 20260604121000 (the canonical allow-list source) so a
-- from-scratch replay and a live-apply converge on the same constraint.
-- Ordered BEFORE the Unit 1 retype (20260616160000).

BEGIN;

ALTER TABLE public.external_identities
  DROP CONSTRAINT IF EXISTS chk_external_identities_source_system;

ALTER TABLE public.external_identities
  ADD CONSTRAINT chk_external_identities_source_system
  CHECK (source_system IN (
    'dia', 'gov', 'cms',
    'salesforce', 'sf',
    'costar', 'rca', 'crexi', 'loopnet',
    'outlook', 'email_intake', 'intake_email',
    'sharepoint', 'calendar', 'availability_scraper'
  ));

COMMIT;
