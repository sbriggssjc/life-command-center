-- ============================================================================
-- 2026-07-31 — W3.7c: staged-record file-discovery attempt tracking (Government)
-- Government DB (ref scknotsqkcheojiaewwh)
--
-- The PA-collector worklist (?action=discovery-worklist on intake-salesforce-files)
-- serves staged Comp/Listing/Deal SF ids that (a) have no sf_files rows yet and
-- (b) have not been attempted in N days. This column is the "attempted in N days"
-- lease: the worklist STAMPS last_file_discovery_at=now() on every id it serves,
-- so an id that yields no files is not re-served every run (thrash guard). An id
-- that later gains an sf_files row drops out via the (a) predicate regardless.
--
-- Additive, nullable, reversible (DROP COLUMN / DROP INDEX). Applied live BEFORE
-- the edge redeploy (additive-schema-before-writer deploy ordering).
-- ============================================================================
ALTER TABLE public.sf_comp_staging    ADD COLUMN IF NOT EXISTS last_file_discovery_at timestamptz;
ALTER TABLE public.sf_listing_staging ADD COLUMN IF NOT EXISTS last_file_discovery_at timestamptz;
ALTER TABLE public.sf_deal_staging    ADD COLUMN IF NOT EXISTS last_file_discovery_at timestamptz;

CREATE INDEX IF NOT EXISTS ix_sf_comp_staging_file_disc    ON public.sf_comp_staging    (last_file_discovery_at NULLS FIRST) WHERE sf_comp_id    IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_sf_listing_staging_file_disc ON public.sf_listing_staging (last_file_discovery_at NULLS FIRST) WHERE sf_listing_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_sf_deal_staging_file_disc    ON public.sf_deal_staging    (last_file_discovery_at NULLS FIRST) WHERE sf_deal_id    IS NOT NULL;
