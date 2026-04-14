-- Migration: property_cms_link — cache fuzzy address matches between
-- Dialysis properties and CMS facilities (medicare_clinics.medicare_id).
--
-- Purpose: The Operations tab on the property detail panel needs CMS data
-- (treatment counts, stations, staffing, QIP, 5-star rating, payer mix,
-- operator, last CMS survey date). Many properties have no row in
-- medicare_clinics even though their address matches a CMS facility
-- on file. This table caches the resolved match so we only pay the
-- fuzzy-match cost once per property.
--
-- Apply on: Dialysis DB (DIA_SUPABASE_URL)
-- Safe to re-run.

BEGIN;

-- property_id uses TEXT to stay compatible with the Dialysis DB schema
-- regardless of whether the upstream column is UUID, bigint, or text.
CREATE TABLE IF NOT EXISTS public.property_cms_link (
    property_id       TEXT        PRIMARY KEY,
    medicare_id       TEXT        NOT NULL,
    match_score       NUMERIC(5,3),
    match_method      TEXT        NOT NULL DEFAULT 'auto:address_zip',
    match_notes       TEXT,
    matched_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    matched_by        TEXT,
    CONSTRAINT property_cms_link_method_check
        CHECK (match_method IN (
            'auto:address_zip',
            'auto:medicare_clinics',
            'manual',
            'manual:typeahead'
        ))
);

COMMENT ON TABLE public.property_cms_link IS
    'Caches property_id → CMS medicare_id (CCN) matches. Populated by the fuzzy-match resolver on property load or via manual "Match facility" action from the Operations tab.';

COMMENT ON COLUMN public.property_cms_link.match_score IS
    'Similarity score 0..1 for auto matches. NULL for manual matches.';

COMMENT ON COLUMN public.property_cms_link.match_method IS
    'How the link was established: auto:address_zip (fuzzy street+zip), auto:medicare_clinics (existing row in medicare_clinics), manual (typeahead), or manual:typeahead.';

-- Secondary lookup (many properties may resolve to the same medicare_id
-- if the CCN moved addresses over time)
CREATE INDEX IF NOT EXISTS idx_property_cms_link_medicare_id
    ON public.property_cms_link (medicare_id);

-- Audit: track every proposed match, even if rejected or superseded
CREATE TABLE IF NOT EXISTS public.property_cms_link_history (
    id              BIGSERIAL   PRIMARY KEY,
    property_id     TEXT        NOT NULL,
    medicare_id     TEXT        NOT NULL,
    match_score     NUMERIC(5,3),
    match_method    TEXT        NOT NULL,
    action          TEXT        NOT NULL DEFAULT 'created',
    matched_by      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT property_cms_link_history_action_check
        CHECK (action IN ('created','updated','rejected','superseded'))
);

CREATE INDEX IF NOT EXISTS idx_property_cms_link_history_property
    ON public.property_cms_link_history (property_id, created_at DESC);

COMMIT;
