-- UX-T1a-mirror-dia-lease (LCC half). Companion to dia 20260903120000.
-- APPLIED LIVE to xengecqvemvfknjvbvrq 2026-09-03.
--
-- Three changes, and ALL THREE are required -- any one alone is a silent no-op:
--   1. two new columns on lcc_property_attributes (lease_source, initial_term_years)
--   2. lcc_mirror_tick's dia select= list must ASK for the new columns
--   3. lcc_apply_property_attributes_page's dia branch must WRITE them
-- The dia branch of the apply function never handled lease columns at all, which is why
-- dia read 0 of 17,225 while gov read 11,725 of 13,838 through the same function.
--
-- ⚠️ THE dia SOURCE VIEW WAS THE BREAK, NOT THE TICK. dia's
-- v_property_attributes_portfolio never had lease columns; gov's always did. Diffing the
-- two source views' column lists found it in one query -- before reading either the tick
-- or the apply function. When one of two near-identical feeds works, diff their column
-- lists first.
--
-- ⚠️ THE W2.3 "dia is not anon-readable" NOTE IS STALE. That blocker was real when
-- written and P157 fixed it: dia's view reads `security_invoker=off` and returns 11,802
-- rows to `anon` today, positive-controlled before this shipped.
--
-- RESULT (measured after a full re-walk): dia lease_expiration 0 -> 1,747,
-- lease_commencement 0 -> 1,623, term_remaining 0 -> 1,747, initial_term_years 4,225.
-- gov unmoved (13,838 / 11,493 / 11,725 / 11,847) -- the positive control.
-- firm_term_remaining stays 0 for dia BY DESIGN: there is no firm-term fact in that
-- domain, and 0 would read as "none remaining" (the PR1a/PR1b sentinel class).

ALTER TABLE public.lcc_property_attributes
  ADD COLUMN IF NOT EXISTS lease_source        text,
  ADD COLUMN IF NOT EXISTS initial_term_years  numeric;

COMMENT ON COLUMN public.lcc_property_attributes.lease_source IS
  'Which lease answered the lease-date columns, e.g. dia_leases:in_effect / '
  ':start_unknown / :not_yet_commenced. NULL for gov (its source view states no basis). '
  'Lets a consumer tell "in effect" from "expiry known, start unknown" instead of '
  'reading both as one fact.';
COMMENT ON COLUMN public.lcc_property_attributes.initial_term_years IS
  'Recorded INITIAL term length in years (dia: the property''s term_number=1 lease). '
  'Measured p50 14.9 / p90 15.1 over the 1,747 dia properties with a live lease -- '
  'Scott''s 15-year new-build standard. NOT the remaining term (term_remaining).';

-- ── 2) the tick's dia select= list ───────────────────────────────────────────────
-- Edited by string replacement on the LIVE definition rather than by restating the whole
-- ~300-line function, so no other leg can be changed by accident. The replacement is
-- ASSERTED: a silent no-op here would leave the tick asking for the old 18 columns while
-- the apply function reads six that never arrive -- exactly the "consumer wired to a
-- producer that does not exist" shape (P137), and it would look like a working deploy.
DO $outer$
DECLARE
  v_def text;
  v_old text := 'v_select := ''property_id,address,city,state,zip_code,county,latitude,longitude,building_size,year_built,year_renovated,building_type,property_type,tenant,operator,annual_rent,noi,updated_at'';';
  v_new text := 'v_select := ''property_id,address,city,state,zip_code,county,latitude,longitude,building_size,year_built,year_renovated,building_type,property_type,tenant,operator,annual_rent,noi,updated_at,lease_commencement,lease_expiration,firm_term_remaining,term_remaining,lease_source,initial_term_years'';';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'lcc_mirror_tick';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'UX-T1a: lcc_mirror_tick not found';
  END IF;

  IF position(v_new IN v_def) > 0 THEN
    RAISE NOTICE 'UX-T1a: dia select= already carries the lease columns; no change';
  ELSE
    IF position(v_old IN v_def) = 0 THEN
      RAISE EXCEPTION 'UX-T1a: dia property_attributes select= list not found verbatim in '
        'lcc_mirror_tick -- it has drifted. Re-read the live definition and re-target '
        'this replacement rather than forcing it.';
    END IF;
    v_def := replace(v_def, v_old, v_new);
    IF position(v_new IN v_def) = 0 THEN
      RAISE EXCEPTION 'UX-T1a: replacement did not take';
    END IF;
    EXECUTE v_def;
  END IF;
END $outer$;

-- ── 3) the apply function's dia branch ───────────────────────────────────────────
-- Restated in full (it is short) so the repo carries a correct copy -- P194: a second
-- copy that is correct beats no copy at all, because otherwise the next rebuild silently
-- regresses. The gov branch is byte-identical to what shipped in 20260522280000.
CREATE OR REPLACE FUNCTION public.lcc_apply_property_attributes_page(p_domain text, p_content jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_applied int := 0;
BEGIN
  IF p_domain = 'dia' THEN
    WITH rows AS (SELECT jsonb_array_elements(p_content) AS row),
    up AS (
      INSERT INTO public.lcc_property_attributes (
        source_domain, source_property_id, address, city, state, postal_code, county,
        latitude, longitude, building_size_sqft, year_built, year_renovated, building_type,
        asset_class, tenant_short, tenant_label, annual_rent, noi,
        lease_commencement, lease_expiration, firm_term_remaining, term_remaining,
        lease_source, initial_term_years,
        source_updated_at, updated_at)
      SELECT 'dia', (row->>'property_id')::text,
        row->>'address', row->>'city', row->>'state', row->>'zip_code', row->>'county',
        NULLIF(row->>'latitude','')::numeric, NULLIF(row->>'longitude','')::numeric,
        NULLIF(row->>'building_size','')::numeric,
        NULLIF(row->>'year_built','')::int, NULLIF(row->>'year_renovated','')::int,
        COALESCE(row->>'building_type', row->>'property_type'),
        'dialysis', row->>'tenant', row->>'operator',
        NULLIF(row->>'annual_rent','')::numeric, NULLIF(row->>'noi','')::numeric,
        NULLIF(row->>'lease_commencement','')::date, NULLIF(row->>'lease_expiration','')::date,
        NULLIF(row->>'firm_term_remaining','')::numeric, NULLIF(row->>'term_remaining','')::numeric,
        row->>'lease_source', NULLIF(row->>'initial_term_years','')::numeric,
        NULLIF(row->>'updated_at','')::timestamptz, now()
      FROM rows WHERE row->>'property_id' IS NOT NULL
      ON CONFLICT (source_domain, source_property_id) DO UPDATE SET
        address=COALESCE(EXCLUDED.address, public.lcc_property_attributes.address),
        city=COALESCE(EXCLUDED.city, public.lcc_property_attributes.city),
        state=COALESCE(EXCLUDED.state, public.lcc_property_attributes.state),
        postal_code=COALESCE(EXCLUDED.postal_code, public.lcc_property_attributes.postal_code),
        county=COALESCE(EXCLUDED.county, public.lcc_property_attributes.county),
        latitude=COALESCE(EXCLUDED.latitude, public.lcc_property_attributes.latitude),
        longitude=COALESCE(EXCLUDED.longitude, public.lcc_property_attributes.longitude),
        building_size_sqft=COALESCE(EXCLUDED.building_size_sqft, public.lcc_property_attributes.building_size_sqft),
        year_built=COALESCE(EXCLUDED.year_built, public.lcc_property_attributes.year_built),
        year_renovated=COALESCE(EXCLUDED.year_renovated, public.lcc_property_attributes.year_renovated),
        building_type=COALESCE(EXCLUDED.building_type, public.lcc_property_attributes.building_type),
        tenant_short=COALESCE(EXCLUDED.tenant_short, public.lcc_property_attributes.tenant_short),
        tenant_label=COALESCE(EXCLUDED.tenant_label, public.lcc_property_attributes.tenant_label),
        annual_rent=COALESCE(EXCLUDED.annual_rent, public.lcc_property_attributes.annual_rent),
        noi=COALESCE(EXCLUDED.noi, public.lcc_property_attributes.noi),
        -- fill-blanks, same as every other column here: a NULL from the source (dia's
        -- firm_term_remaining is ALWAYS NULL) can never clobber a value.
        lease_commencement=COALESCE(EXCLUDED.lease_commencement, public.lcc_property_attributes.lease_commencement),
        lease_expiration=COALESCE(EXCLUDED.lease_expiration, public.lcc_property_attributes.lease_expiration),
        firm_term_remaining=COALESCE(EXCLUDED.firm_term_remaining, public.lcc_property_attributes.firm_term_remaining),
        -- term_remaining is recomputed against CURRENT_DATE every read at source, so the
        -- fresher value must win rather than being held by fill-blanks.
        term_remaining=COALESCE(EXCLUDED.term_remaining, public.lcc_property_attributes.term_remaining),
        lease_source=COALESCE(EXCLUDED.lease_source, public.lcc_property_attributes.lease_source),
        initial_term_years=COALESCE(EXCLUDED.initial_term_years, public.lcc_property_attributes.initial_term_years),
        source_updated_at=EXCLUDED.source_updated_at, updated_at=now()
      WHERE public.lcc_property_attributes.source_updated_at IS NULL
         OR EXCLUDED.source_updated_at IS NULL
         OR EXCLUDED.source_updated_at >= public.lcc_property_attributes.source_updated_at
      RETURNING 1)
    SELECT count(*) INTO v_applied FROM up;
  ELSE
    WITH rows AS (SELECT jsonb_array_elements(p_content) AS row),
    up AS (
      INSERT INTO public.lcc_property_attributes (
        source_domain, source_property_id, address, city, state, postal_code, county, metro_area,
        latitude, longitude, building_size_sqft, land_acres, year_built, year_renovated, building_type,
        asset_class, tenant_short, tenant_label, lease_commencement, lease_expiration,
        firm_term_remaining, term_remaining, annual_rent, noi, source_updated_at, updated_at)
      SELECT 'gov', (row->>'property_id')::text,
        row->>'address', row->>'city', row->>'state', row->>'zip_code', row->>'county', row->>'metro_area',
        NULLIF(row->>'latitude','')::numeric, NULLIF(row->>'longitude','')::numeric,
        NULLIF(row->>'building_size_sqft','')::numeric, NULLIF(row->>'land_acres','')::numeric,
        NULLIF(row->>'year_built','')::int, NULLIF(row->>'year_renovated','')::int,
        row->>'building_type', 'government', row->>'tenant_short', row->>'tenant_label',
        NULLIF(row->>'lease_commencement','')::date, NULLIF(row->>'lease_expiration','')::date,
        NULLIF(row->>'firm_term_remaining','')::numeric, NULLIF(row->>'term_remaining','')::numeric,
        NULLIF(row->>'annual_rent','')::numeric, NULLIF(row->>'noi','')::numeric,
        NULLIF(row->>'updated_at','')::timestamptz, now()
      FROM rows WHERE row->>'property_id' IS NOT NULL
      ON CONFLICT (source_domain, source_property_id) DO UPDATE SET
        address=COALESCE(EXCLUDED.address, public.lcc_property_attributes.address),
        city=COALESCE(EXCLUDED.city, public.lcc_property_attributes.city),
        state=COALESCE(EXCLUDED.state, public.lcc_property_attributes.state),
        postal_code=COALESCE(EXCLUDED.postal_code, public.lcc_property_attributes.postal_code),
        county=COALESCE(EXCLUDED.county, public.lcc_property_attributes.county),
        metro_area=COALESCE(EXCLUDED.metro_area, public.lcc_property_attributes.metro_area),
        latitude=COALESCE(EXCLUDED.latitude, public.lcc_property_attributes.latitude),
        longitude=COALESCE(EXCLUDED.longitude, public.lcc_property_attributes.longitude),
        building_size_sqft=COALESCE(EXCLUDED.building_size_sqft, public.lcc_property_attributes.building_size_sqft),
        land_acres=COALESCE(EXCLUDED.land_acres, public.lcc_property_attributes.land_acres),
        year_built=COALESCE(EXCLUDED.year_built, public.lcc_property_attributes.year_built),
        year_renovated=COALESCE(EXCLUDED.year_renovated, public.lcc_property_attributes.year_renovated),
        building_type=COALESCE(EXCLUDED.building_type, public.lcc_property_attributes.building_type),
        tenant_short=COALESCE(EXCLUDED.tenant_short, public.lcc_property_attributes.tenant_short),
        tenant_label=COALESCE(EXCLUDED.tenant_label, public.lcc_property_attributes.tenant_label),
        lease_commencement=COALESCE(EXCLUDED.lease_commencement, public.lcc_property_attributes.lease_commencement),
        lease_expiration=COALESCE(EXCLUDED.lease_expiration, public.lcc_property_attributes.lease_expiration),
        firm_term_remaining=COALESCE(EXCLUDED.firm_term_remaining, public.lcc_property_attributes.firm_term_remaining),
        term_remaining=COALESCE(EXCLUDED.term_remaining, public.lcc_property_attributes.term_remaining),
        annual_rent=COALESCE(EXCLUDED.annual_rent, public.lcc_property_attributes.annual_rent),
        noi=COALESCE(EXCLUDED.noi, public.lcc_property_attributes.noi),
        source_updated_at=EXCLUDED.source_updated_at, updated_at=now()
      WHERE public.lcc_property_attributes.source_updated_at IS NULL
         OR EXCLUDED.source_updated_at IS NULL
         OR EXCLUDED.source_updated_at >= public.lcc_property_attributes.source_updated_at
      RETURNING 1)
    SELECT count(*) INTO v_applied FROM up;
  END IF;
  RETURN v_applied;
END $function$;

-- ── BACKFILL NOTE (operator step, already performed 2026-09-03) ──────────────────
-- Adding columns does NOT re-send existing rows: the mirror keysets on
-- (source_updated_at, property_id) and the dia view's updated_at comes from
-- `properties.updated_at`, which this change does not touch. A full re-walk is required:
--   update lcc_mirror_sync_watermark set watermark_updated_at='1970-01-01',
--          watermark_source_key=null, pending_request_id=null
--    where leg='property_attributes' and source_domain='dia';
-- then drive lcc_mirror_tick('property_attributes','dia') one page per TRANSACTION.
-- ⚠️ pg_net dispatches a queued request only on COMMIT, so a loop inside ONE transaction
-- fires exactly one page and then blocks on its own pending id -- it reads as a working
-- loop and moves nothing.
