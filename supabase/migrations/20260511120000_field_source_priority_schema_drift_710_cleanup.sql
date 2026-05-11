-- ============================================================================
-- field_source_priority schema-drift cleanup for #710
--
-- Target: LCC Opps (xengecqvemvfknjvbvrq)
-- Detected by: .github/workflows/field-source-priority-schema-check.yml on
-- 2026-05-09 (run 25590180141 / issue #710). The daily audit cross-references
-- field_source_priority rules against domain_table_columns and flagged 11
-- rules registered against columns that don't exist on the target table:
--
--   (1) gov.available_listings drift — 5 rules registered against DIA column
--       names. The gov table uses asking_price / asking_cap_rate /
--       asking_price_psf; the dia table uses initial_price / last_price /
--       current_cap_rate / initial_cap_rate / price_per_sf. These got
--       re-introduced by 20260505010000_field_source_priority_drift_sweep.sql
--       which captured pre-fix writer behavior; the OM promoter has since
--       been domain-branched (see api/_handlers/intake-promoter.js lines
--       2254-2272 in the current tree, and 20260429350000_..._gov_available_
--       listings_schema_fix.sql which originally cleaned this up).
--
--   (2) gov.contacts drift — 2 rules registered against DIA column names.
--       gov.contacts uses email / name; dia.contacts uses contact_email /
--       contact_name. Same pattern as (1) — drift sweep captured pre-fix
--       writer behavior, but the promoter (intake-promoter.js lines 2285-
--       2299) is now correctly domain-branched.
--
--   (3) dia.available_listings.url_status drift — 4 rules registered for a
--       column that exists on gov.available_listings but not on dia. Added
--       by 20260505100000_lcc_availability_checker_cron.sql which assumed
--       parity between the two schemas. The Edge Function
--       (supabase/functions/availability-checker/index.ts) writes
--       provenance with p_field_name='url_status' for both domains; only
--       gov has a matching column. The companion code change in this PR
--       branches the Edge Function so dia writes provenance to is_active
--       (the boolean column that actually flips on an off-market verdict)
--       and gov keeps writing to url_status.
--
-- Verified: applying this migration drops v_field_source_priority_invalid_columns
-- from 11 rows to 0 rows. No field_provenance rows reference the dropped
-- rules' (table, field) tuples because the columns never existed, so
-- nothing ever wrote to them via lcc_merge_field with a non-null target.
-- ============================================================================

-- ── (1) gov.available_listings — drop dia-named price/cap rules ─────────────
DELETE FROM public.field_source_priority
 WHERE target_table = 'gov.available_listings'
   AND field_name IN (
     'current_cap_rate',
     'initial_cap_rate',
     'initial_price',
     'last_price',
     'price_per_sf'
   );

-- ── (2) gov.contacts — drop dia-named contact_email/contact_name rules ─────
DELETE FROM public.field_source_priority
 WHERE target_table = 'gov.contacts'
   AND field_name IN ('contact_email', 'contact_name');

-- ── (3) dia.available_listings.url_status — drop, replace with is_active ───
DELETE FROM public.field_source_priority
 WHERE target_table = 'dia.available_listings'
   AND field_name = 'url_status';

-- The availability-checker Edge Function now writes provenance against
-- dia.available_listings.is_active (the boolean that the lcc_record_listing_check
-- RPC flips on off_market / sold verdicts). Mirror the priority spread the
-- url_status rules used so the cross-source ordering stays identical:
--   manual_edit          1   (human override)
--   sidebar_capture      40  (sidebar verify button — user just looked)
--   sales_transactions   45  (auto-marked sold from a deed match)
--   availability_scraper 65  (Edge Function URL probe — aggregator-quality)
INSERT INTO public.field_source_priority
  (target_table, field_name, source, priority, min_confidence, notes)
VALUES
  ('dia.available_listings', 'is_active', 'manual_edit',          1,  null,
   'Explicit human override.'),
  ('dia.available_listings', 'is_active', 'sidebar_capture',      40, null,
   'Sidebar verify button — the user just confirmed visually.'),
  ('dia.available_listings', 'is_active', 'sales_transactions',   45, null,
   'Auto-marked sold from a deed match (lcc-auto-scrape-listings cron).'),
  ('dia.available_listings', 'is_active', 'availability_scraper', 65, null,
   'lcc-availability-checker Edge Function — periodic URL probe verdict.')
ON CONFLICT (target_table, field_name, source) DO NOTHING;
