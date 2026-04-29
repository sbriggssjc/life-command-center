-- gov.available_listings rule cleanup (2026-04-29).
--
-- Discovered during the unranked-writes audit: gov.available_listings
-- had four rules registered against dia column names (initial_price,
-- last_price, current_cap_rate, initial_cap_rate) that DON'T EXIST on
-- gov's schema. gov uses asking_price / asking_cap_rate /
-- asking_price_psf instead. The OM promoter's listing INSERT was
-- correctly using the gov column names (buildGovListingRow), but the
-- Phase 2.1 provenance loop was sending the dia names regardless of
-- domain — so v_field_provenance_unranked surfaced one
-- gov.available_listings.price_per_sf write against a non-existent
-- column.
--
-- This migration:
--   1. Drops the four invalid scaffolding rules (zero field_provenance
--      rows reference them, since they could never observe a real write).
--   2. Inserts the correct gov column names with the same priority
--      structure the dia listings already use.
--
-- The intake-promoter.js companion change (this PR) splits the listing
-- provenance call into dia / gov branches so the field names sent to
-- lcc_merge_field match the columns actually being patched.

-- 1. Drop invalid rules. Safe — these target columns that don't exist
--    on gov.available_listings, so nothing ever wrote to them.
delete from public.field_source_priority
 where target_table = 'gov.available_listings'
   and field_name in ('initial_price','last_price','current_cap_rate','initial_cap_rate');

-- 2. Register the correct gov column names. Three sources per field:
--    manual_edit (1), om_extraction (30), costar_sidebar (60). Matches
--    the priority spread used for the equivalent dia.available_listings
--    fields (initial_price etc.) so cross-domain matching stays
--    consistent.
insert into public.field_source_priority
  (target_table, field_name, source, priority, enforce_mode, notes)
values
  ('gov.available_listings', 'asking_price',     'manual_edit',     1,  'record_only', 'Explicit human override.'),
  ('gov.available_listings', 'asking_price',     'om_extraction',   30, 'record_only', 'OM-extracted asking price.'),
  ('gov.available_listings', 'asking_price',     'costar_sidebar',  60, 'record_only', 'CoStar listing price.'),

  ('gov.available_listings', 'asking_cap_rate',  'manual_edit',     1,  'record_only', null),
  ('gov.available_listings', 'asking_cap_rate',  'om_extraction',   30, 'record_only', 'OM-extracted cap rate (decimal, e.g. 0.0918).'),
  ('gov.available_listings', 'asking_cap_rate',  'costar_sidebar',  60, 'record_only', null),

  ('gov.available_listings', 'asking_price_psf', 'manual_edit',     1,  'record_only', null),
  ('gov.available_listings', 'asking_price_psf', 'om_extraction',   30, 'record_only', 'OM price per square foot — preferred over computed.'),
  ('gov.available_listings', 'asking_price_psf', 'costar_sidebar',  60, 'record_only', null)
on conflict (target_table, field_name, source) do nothing;
