-- ============================================================================
-- Phase 2 Stage A — folder_feed_seen.status += 'unresolved_no_domain_property'
-- 2026-06-11 (PROPERTIES enrich attach — out-of-universe doctrine)
--
-- The PROPERTIES tree is Briggs's ENTIRE net-lease book (Dollar Tree / Kohl's /
-- FedEx / dental / industrial / portfolios), while the dia/gov property tables
-- only cover dialysis + government-leased. So the MAJORITY of recognized non-OM
-- working docs (BOV / master / comp / lease) genuinely have no dia/gov property
-- to attach to. Stage A doctrine (Scott, 2026-06-11):
--   • a doc that resolves to a single in-domain property → 'attached';
--   • genuine ≥2 in-domain near-miss ambiguity → 'staged' (match_disambiguation);
--   • NO in-domain property (out-of-universe OR a multi-property portfolio) →
--     'unresolved_no_domain_property' — a TERMINAL, non-error outcome. The row
--     stays CAPTURED and tenant-searchable (subject_hint.tenant_brand /
--     .is_portfolio), but does NOT churn the Decision Center lane. This is the
--     read-side seed for the future Stage A.5 out-of-domain deal registry.
--
-- SAFE BY CONSTRUCTION: widens the CHECK only (no row rewrite), idempotent
-- (drop-then-add inside a guard). Existing rows untouched. Apply on LCC Opps
-- (xengecqvemvfknjvbvrq); apply order vs the Railway redeploy is irrelevant
-- (the deployed worker only writes the new status once folder-feed.js ships).
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_folder_feed_seen_status') THEN
    ALTER TABLE public.folder_feed_seen DROP CONSTRAINT chk_folder_feed_seen_status;
  END IF;
  ALTER TABLE public.folder_feed_seen
    ADD CONSTRAINT chk_folder_feed_seen_status CHECK (
      status IN ('seen','staged','attached','promoted','skipped','error','stale',
                 'unresolved_no_domain_property')
    );
END$$;

COMMENT ON COLUMN public.folder_feed_seen.status IS
  'Lifecycle: seen (recorded, not routed) | staged (handed to stageOmIntake, or ≥2 in-domain ambiguity routed to match_disambiguation) | attached (recognized non-OM doc resolved to ONE in-domain property + linked, no extraction) | unresolved_no_domain_property (recognized doc with NO dia/gov property — out-of-universe or multi-property portfolio; captured + tenant-searchable, not a decision) | promoted (downstream finalize) | skipped (unrecognized/lcc_generated) | error | stale (path vanished).';
