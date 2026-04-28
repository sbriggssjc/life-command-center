-- ============================================================================
-- Round 76cn — Phase 5 priority enforcement: flip 6 high-confidence
--              warn-mode rules to strict
--
-- Status check (last 7 days of provenance signals):
--   54 rules in warn, 0 in strict (after Phase 3 starter Round 73)
--
-- A rule is safe to flip to strict when:
--   - skip_count >> 0 (rule has been actively preventing lower-priority
--     overrides, demonstrating it's tuned correctly)
--   - conflict_count is small relative to skip_count (low same-priority
--     disagreement = sources are aligned, the priority hierarchy is right)
--
-- Top warn-mode candidates by signal strength:
--   dia.leases.lease_expiration  costar_sidebar  skips=69 conflicts=0
--   dia.leases.lease_start       costar_sidebar  skips=61 conflicts=3
--   dia.leases.expense_structure costar_sidebar  skips=66 conflicts=8
--   dia.leases.rent_per_sf       costar_sidebar  skips=22 conflicts=3
--   dia.contacts.contact_email   costar_sidebar  skips=194 conflicts=15
--   dia.leases.leased_area       costar_sidebar  skips=7  conflicts=6 (skip)
--
-- All 6 are costar_sidebar attempting to override higher-authority sources
-- (om_extraction, county_records, deed_records). After flip, those 800+
-- skip events per week become hard rejections at lcc_merge_field instead
-- of warn-only logs.
--
-- NOT flipped this round (high conflict counts, need follow-up):
--   dia.contacts.contact_name (167 conflicts)
--   dia.properties.year_built (50 conflicts)
--   dia.properties.lot_sf (49 conflicts)
--   dia.leases.tenant (62 conflicts)
--   dia.available_listings.* (41-42 conflicts each)
--
-- These will be evaluated when Phase 5 metrics stabilize after this round.
-- ============================================================================

UPDATE public.field_source_priority
   SET enforce_mode = 'strict'
 WHERE source = 'costar_sidebar'
   AND (target_table, field_name) IN (
     ('dia.leases', 'lease_expiration'),
     ('dia.leases', 'lease_start'),
     ('dia.leases', 'expense_structure'),
     ('dia.leases', 'rent_per_sf'),
     ('dia.leases', 'leased_area'),
     ('dia.contacts', 'contact_email')
   )
   AND enforce_mode = 'warn';

-- Snapshot the post-state so the migration leaves a paper trail
DO $$
DECLARE
  warn_n int;
  strict_n int;
BEGIN
  SELECT COUNT(*) FILTER (WHERE enforce_mode='warn'),
         COUNT(*) FILTER (WHERE enforce_mode='strict')
    INTO warn_n, strict_n
    FROM public.field_source_priority;
  RAISE NOTICE 'Round 76cn complete: enforce_mode warn=%, strict=%', warn_n, strict_n;
END $$;
