-- Round 76ej.t — fix gov_populate_agency_canonical() trigger function.
--
-- Symptom: every INSERT (and UPDATE OF agency) on gov.properties
-- failed with:
--
--   ERROR:  42703: record "new" has no field "tenant_agency"
--   CONTEXT: PL/pgSQL function gov_populate_agency_canonical() line 6
--
-- The trigger function was written with a CASE expression that
-- accessed both branches' record fields:
--
--   v_src := COALESCE(
--     CASE WHEN TG_TABLE_NAME = 'leases'
--       THEN NEW.tenant_agency      -- only exists on gov.leases
--       ELSE NEW.agency             -- only exists on gov.properties
--     END,
--     ''
--   );
--
-- PL/pgSQL evaluates record-field accesses in BOTH branches of a
-- CASE expression at parse time, regardless of which branch the
-- WHEN clause selects. So when the trigger fired on gov.properties
-- (which has agency but not tenant_agency), the parse step looking
-- at NEW.tenant_agency raised a hard error and the INSERT was
-- aborted before any data landed.
--
-- Concrete failure surfaced by the LCC sidebar pipeline: the Athens
-- VA Clinic (9249 US-29) capture classified as government, hit the
-- new-property INSERT path in api/_handlers/sidebar-pipeline.js
-- :upsertDomainProperty(), and got back a 42703. The pipeline
-- caught the failure and stamped entity.metadata._pipeline_status
-- = 'failed' / _pipeline_last_error = 'property_upsert_failed'.
-- Same root cause would block any other CREXi/CoStar gov capture
-- whose property isn't already in gov.properties.
--
-- Fix: replace the CASE expression with IF/ELSIF so each branch's
-- field access only happens when the corresponding TG_TABLE_NAME
-- matches.

CREATE OR REPLACE FUNCTION public.gov_populate_agency_canonical()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_short text;
  v_src   text;
BEGIN
  IF TG_TABLE_NAME = 'leases' THEN
    v_src := COALESCE(NEW.tenant_agency, '');
  ELSE
    v_src := COALESCE(NEW.agency, '');
  END IF;
  v_short := canonicalize_agency(v_src);
  NEW.agency_canonical := v_short;
  NEW.agency_full      := canonicalize_agency_full(v_short);
  RETURN NEW;
END
$function$;

-- Verification (run after applying):
--
-- BEGIN;
--   INSERT INTO public.properties (address, city, state, data_source)
--   VALUES ('TEST_TRIGGER_FIX', 'TestCity', 'XX', 'migration_smoke')
--   RETURNING property_id, agency_canonical, agency_full;
-- ROLLBACK;
--
-- Should succeed and return null agency_canonical / agency_full
-- (because canonicalize_agency('') returns null/empty).
