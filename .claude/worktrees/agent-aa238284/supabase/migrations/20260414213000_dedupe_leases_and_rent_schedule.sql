-- ============================================================================
-- Migration: dedupe leases, add extensions + rent-schedule tables
-- Target: dialysis domain Supabase
-- Life Command Center — fix duplicate leases on the property sidebar Lease tab
--
-- Problem symptoms (Davita Vista Del Sol Dialysis and others):
--   - Three leases rendered for a single-tenant NNN property
--     LEASE 1: real executed lease (correct)
--     LEASE 2: tenant = "BuyerEst." — buyer-side stub imported from a sales comp
--     LEASE 3: verbatim duplicate of LEASE 1
--   - NO. OF EXTENSIONS = 3 but only one extension has actually occurred
--   - LAST EXTENSION defaults to the commencement date when unknown
--
-- This migration:
--   1. Deduplicates existing leases rows (merging duplicates) keeping the most
--      authoritative record per (property_id, normalized tenant, lease_start).
--   2. Adds a functional UNIQUE index that prevents the dup class going forward.
--      Schema note: leases uses `tenant` TEXT (not tenant_id FK) and `lease_start`
--      (not commencement_date). The index uses normalized tenant text + lease_start
--      which matches the intent of (property_id, tenant_id, commencement_date).
--   3. Creates `lease_extensions` — canonical source for extension counts/dates.
--   4. Creates `lease_rent_schedule` — parsed / structured rent roll per lease year.
--   5. Exposes a `v_lease_extensions_summary` view that the app joins to get a
--      real count() and MAX(extension_date) with NULL when no extensions exist,
--      replacing the previous "default to 3 / default to commencement" behavior.
-- ============================================================================

BEGIN;

-- ── Step 1: Dedupe existing leases ──────────────────────────────────────────
--
-- Ranking rules (highest priority first):
--   (a) data_source NOT IN ('buyer_est','sales_comp_est') and tenant not a
--       placeholder pattern  → keeps real executed leases over buyer estimates.
--   (b) source_confidence:   documented > estimated > inferred.
--   (c) populated annual_rent/rent_psf (more data = keep).
--   (d) lowest lease_id (earliest row) as final tiebreak.
--
-- Duplicates are dropped, not merged column-by-column. The winning row already
-- has the best data by definition of the ranking.

-- Staging: flag placeholder tenants once so both the CTE and frontend logic
-- can share the same definition (via a stable SQL function).
CREATE OR REPLACE FUNCTION public.is_placeholder_tenant(t TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT t IS NULL
      OR btrim(t) = ''
      OR lower(btrim(t)) IN (
           'buyerest.', 'buyer est.', 'buyer est', 'buyerest',
           'est.', 'est', 'tbd', 'tbd.', 'unknown', 'n/a', 'na'
         )
      OR lower(t) LIKE 'buyer est%'
      OR lower(t) LIKE 'buyerest%'
$$;

COMMENT ON FUNCTION public.is_placeholder_tenant(TEXT) IS
  'Shared heuristic for placeholder/buyer-estimate tenant strings. '
  'Used by dedup migration and v_lease_detail filters.';

WITH ranked AS (
  SELECT
    lease_id,
    property_id,
    lower(btrim(tenant))                         AS tenant_key,
    coalesce(lease_start, DATE '1900-01-01')     AS start_key,
    ROW_NUMBER() OVER (
      PARTITION BY property_id,
                   lower(btrim(tenant)),
                   coalesce(lease_start, DATE '1900-01-01')
      ORDER BY
        -- (a) real data beats buyer estimates + placeholders
        (CASE
           WHEN public.is_placeholder_tenant(tenant)                    THEN 2
           WHEN coalesce(data_source, '') IN ('buyer_est','sales_comp_est') THEN 1
           ELSE 0
         END) ASC,
        -- (b) source_confidence tier
        (CASE coalesce(source_confidence, 'inferred')
           WHEN 'documented' THEN 0
           WHEN 'estimated'  THEN 1
           WHEN 'inferred'   THEN 2
           ELSE 3
         END) ASC,
        -- (c) populated rent fields
        (CASE WHEN annual_rent IS NOT NULL THEN 0 ELSE 1 END) ASC,
        (CASE WHEN rent_per_sf IS NOT NULL THEN 0 ELSE 1 END) ASC,
        -- (d) earliest row as final tiebreak
        lease_id ASC
    ) AS rn
  FROM public.leases
)
DELETE FROM public.leases l
  USING ranked r
 WHERE l.lease_id = r.lease_id
   AND r.rn > 1;

-- ── Step 2: UNIQUE index to stop future duplicates ──────────────────────────
-- Functional index on (property_id, normalized tenant, lease_start).
-- Using coalesce so NULL lease_start still participates in uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS leases_unique_property_tenant_commencement
  ON public.leases (
    property_id,
    lower(btrim(tenant)),
    coalesce(lease_start, DATE '1900-01-01')
  );

COMMENT ON INDEX public.leases_unique_property_tenant_commencement IS
  'Prevents duplicate lease rows for the same tenant+commencement on a property. '
  'Maps the task spec (property_id, tenant_id, commencement_date) to the current '
  'schema (tenant text + lease_start).';

-- ── Step 3: lease_extensions table ──────────────────────────────────────────
-- Canonical source for extension counts and last-extension date. No more
-- "default to 3" or "default to commencement" — if no row, there is no extension.
CREATE TABLE IF NOT EXISTS public.lease_extensions (
  extension_id       BIGSERIAL PRIMARY KEY,
  lease_id           BIGINT NOT NULL REFERENCES public.leases(lease_id) ON DELETE CASCADE,
  property_id        BIGINT,
  extension_date     DATE NOT NULL,
  new_expiration     DATE,
  prior_expiration   DATE,
  option_exercised   BOOLEAN DEFAULT TRUE,
  option_number      INTEGER,
  notes              TEXT,
  data_source        TEXT,
  source_confidence  TEXT CHECK (source_confidence IN ('documented','estimated','inferred')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lease_extensions_unique_per_lease_date
    UNIQUE (lease_id, extension_date)
);

CREATE INDEX IF NOT EXISTS lease_extensions_lease_id_idx
  ON public.lease_extensions (lease_id);
CREATE INDEX IF NOT EXISTS lease_extensions_property_id_idx
  ON public.lease_extensions (property_id);

COMMENT ON TABLE public.lease_extensions IS
  'One row per exercised extension option. COUNT(*) = No. of Extensions; '
  'MAX(extension_date) = Last Extension. NULL when no row exists.';

-- ── Step 4: v_lease_extensions_summary view ─────────────────────────────────
CREATE OR REPLACE VIEW public.v_lease_extensions_summary AS
SELECT
  l.lease_id,
  l.property_id,
  COALESCE(COUNT(e.extension_id), 0)::INTEGER AS extension_count_live,
  MAX(e.extension_date)                       AS last_extension_date_live
FROM public.leases l
LEFT JOIN public.lease_extensions e ON e.lease_id = l.lease_id
GROUP BY l.lease_id, l.property_id;

COMMENT ON VIEW public.v_lease_extensions_summary IS
  'Live extension count/date per lease. extension_count_live is always >=0; '
  'last_extension_date_live is NULL when no extension rows exist (does NOT '
  'fall back to commencement). Consumed by property sidebar Lease tab.';

-- ── Step 5: lease_rent_schedule table ───────────────────────────────────────
-- Structured rent roll: one row per lease-year (or per step). Populated either
-- by the rent-escalation parser (sidebar-pipeline) or manually from OM/lease.
CREATE TABLE IF NOT EXISTS public.lease_rent_schedule (
  schedule_id        BIGSERIAL PRIMARY KEY,
  lease_id           BIGINT NOT NULL REFERENCES public.leases(lease_id) ON DELETE CASCADE,
  property_id        BIGINT,
  lease_year         INTEGER NOT NULL,           -- 1-based (year 1 = commencement year)
  period_start       DATE,
  period_end         DATE,
  base_rent          NUMERIC(14,2),              -- annual base rent for the year
  rent_psf           NUMERIC(10,4),              -- annual rent / leased SF
  bump_pct           NUMERIC(7,4),               -- bump applied vs prior year, 0.02 = 2%
  cumulative_rent    NUMERIC(16,2),              -- running total across term
  is_option_window   BOOLEAN NOT NULL DEFAULT FALSE,
  option_index       INTEGER,                    -- 1 for first option window, etc
  source             TEXT,                       -- 'lease_doc' | 'om' | 'parsed_estimate' | 'manual'
  source_confidence  TEXT CHECK (source_confidence IN ('documented','estimated','inferred')),
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lease_rent_schedule_unique_year
    UNIQUE (lease_id, lease_year, is_option_window, option_index)
);

CREATE INDEX IF NOT EXISTS lease_rent_schedule_lease_id_idx
  ON public.lease_rent_schedule (lease_id);
CREATE INDEX IF NOT EXISTS lease_rent_schedule_property_id_idx
  ON public.lease_rent_schedule (property_id);

COMMENT ON TABLE public.lease_rent_schedule IS
  'Stepped rent schedule per lease: year, base rent, rent/SF, bump %, cumulative, '
  'option windows. Renders as the Rent Roll sub-view on the property sidebar.';

-- ── Step 6: leases.data_source enum hint ────────────────────────────────────
-- Ensure the data_source values used by the app have a shared vocabulary. We
-- do NOT add a CHECK constraint (existing rows may have freeform values) but
-- we add a comment so future writers know the expected tokens.
COMMENT ON COLUMN public.leases.data_source IS
  'Canonical tokens: lease_doc | costar_sidebar | costar_estimate | om_confirmed | '
  'buyer_est | sales_comp_est | manual. The frontend filters out rows where '
  'data_source IN (buyer_est, sales_comp_est) or tenant matches placeholder patterns.';

COMMIT;

-- ============================================================================
-- Follow-up (tracked in the LCC ops log, not in this migration):
--   - v_lease_detail (dialysis schema, not LCC-owned) should be updated to:
--       LEFT JOIN v_lease_extensions_summary s ON s.lease_id = leases.lease_id
--     and project s.extension_count_live AS extension_count,
--                 s.last_extension_date_live AS last_extension_date
--     so downstream readers see the live values without an extra round-trip.
--   - Until that ships, the frontend (detail.js) fetches the summary view
--     alongside v_lease_detail and overrides the stale columns client-side.
-- ============================================================================
