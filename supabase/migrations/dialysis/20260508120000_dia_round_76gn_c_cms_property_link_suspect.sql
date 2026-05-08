-- ============================================================================
-- Round 76gn.c (2026-05-08) — CMS<>property link suspect review queue
--
-- Companion to the data fix that ran the same day: 1,026 medicare_clinics rows
-- had their `city` field truncated to ~11 characters by a historical CMS
-- ingest. We propagated the un-truncated value from properties.city back to
-- medicare_clinics for every (mc, p) pair where:
--    * mc.city is a strict case-insensitive prefix of p.city
--    * length(trim(mc.city)) >= 6
--    * states match
--
-- That left 215 (mc, p) pairs where the city/state genuinely disagree even
-- after the truncation fix. Those are the rows where the property↔CMS link
-- is suspect — either the wrong CCN was attached at link time, the facility
-- physically moved, or the property record itself is wrong about city/state.
-- These need human eyes (one at a time) to decide direction; we do NOT touch
-- them automatically.
--
-- This view materializes that queue with the most informative diff context.
-- It's purely SELECT — no DDL beyond the view itself, idempotent re-run safe.
--
-- Apply on: Dialysis DB (DIA_SUPABASE_URL).
-- ============================================================================

BEGIN;

CREATE OR REPLACE VIEW public.v_property_cms_link_suspect AS
SELECT
    p.property_id,
    p.medicare_id,
    -- Diff classification:
    --   state_diff: states differ -> almost certainly bad CCN link
    --   city_diff:  states match, cities differ in a way the truncation
    --               fix couldn't safely auto-resolve
    CASE
        WHEN lower(trim(coalesce(p.state, ''))) <> lower(trim(coalesce(mc.state, '')))
            THEN 'state_diff'
        ELSE 'city_diff'
    END                                              AS suspect_kind,
    -- Property side
    p.address                                        AS property_address,
    p.city                                           AS property_city,
    p.state                                          AS property_state,
    p.zip_code                                       AS property_zip,
    -- CMS side
    mc.facility_name                                 AS cms_facility_name,
    mc.address                                       AS cms_address,
    mc.city                                          AS cms_city,
    mc.state                                         AS cms_state,
    mc.zip_code                                      AS cms_zip,
    -- Helpful side-info for triage
    mc.is_active                                     AS cms_is_active,
    mc.last_seen_date                                AS cms_last_seen_date,
    mc.cms_last_checked                              AS cms_last_checked,
    -- Heuristic flags
    -- street_looks_unrelated: first 6 alnum chars of address differ -> strong
    -- bad-link signal; combined with state_diff usually means wrong CCN
    -- attached to this property. Combined with same-state but different city,
    -- often means CCN was reassigned to a new facility nearby.
    CASE
        WHEN coalesce(p.address, '') = '' OR coalesce(mc.address, '') = ''
            THEN false
        WHEN substring(regexp_replace(lower(p.address), '[^a-z0-9]', '', 'g'), 1, 6)
           = substring(regexp_replace(lower(mc.address), '[^a-z0-9]', '', 'g'), 1, 6)
            THEN false
        ELSE true
    END                                              AS street_looks_unrelated,
    -- Same-zip5: makes "same place, different city naming" very likely
    -- (e.g., neighborhood vs municipality). Worth biasing toward "trust CMS"
    -- when zip5 matches AND street looks related.
    NULLIF(left(coalesce(p.zip_code,  ''), 5), '')
        = NULLIF(left(coalesce(mc.zip_code, ''), 5), '')               AS zip5_matches
FROM public.properties p
JOIN public.medicare_clinics mc ON mc.medicare_id = p.medicare_id
WHERE p.medicare_id IS NOT NULL
  AND (
        lower(trim(coalesce(p.city,  ''))) <> lower(trim(coalesce(mc.city,  '')))
     OR lower(trim(coalesce(p.state, ''))) <> lower(trim(coalesce(mc.state, '')))
  )
  -- Exclude the safe-truncation shape entirely: that's auto-fixed at ingest
  -- and shouldn't appear here. Belt-and-suspenders against ingest re-corruption.
  AND NOT (
        mc.city IS NOT NULL AND p.city IS NOT NULL
    AND length(trim(mc.city)) >= 6
    AND length(trim(p.city))   > length(trim(mc.city))
    AND lower(trim(p.city)) LIKE lower(trim(mc.city)) || '%'
    AND lower(trim(coalesce(p.state, ''))) = lower(trim(coalesce(mc.state, '')))
  );

COMMENT ON VIEW public.v_property_cms_link_suspect IS
    'Round 76gn.c review queue: property<>CMS link rows where city/state '
    'disagree after the 2026-05-08 truncation fix. Human-review only — no '
    'auto-fix path. Sort by suspect_kind=state_diff first (most likely bad '
    'CCN link), then street_looks_unrelated=true, then zip5_matches=false.';

COMMIT;
