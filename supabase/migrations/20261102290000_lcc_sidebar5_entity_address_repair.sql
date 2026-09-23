-- SIDEBAR5 (2026-09-23) — repair the LCC asset entity minted from CoStar #1014478's Contacts tab.
--
-- Entity 2f90e232-6c7c-41f2-8b4b-6cb8e7fc7e81 was saved with name/address
-- "4005 Call Field Rd, Suite 100, Wichita Falls, TX 76308" — the Primary Leasing Company's office
-- (Truity Capital), not the property. The property header reads "2600 Central Fwy N - Wichita
-- Falls Shopping Center" (76306). The entity's own document links end in " - 2600 Central Fwy N.pdf",
-- and its city/zip (Wichita Falls / 76306) were already the property's. Extension fix + server
-- title check: SIDEBAR5 (extension/content/_subject-address.js, api/_shared/intake-address-guard.js).
-- gov residue (property 41083): government-lease sql/20260923_gov_sidebar5_contacts_tab_address_residue.sql.
--
-- Why it matters beyond display: GOV-AVAIL1 showed an asset entity NAMED for an office address
-- becomes a match target for later intake, so the name is corrected, not only the address.
-- The prior values are kept on the row (metadata._sidebar5_address_repair) — the log.
-- Idempotent: only touches the row while it still carries the Call Field Rd address.
--
-- REVERSAL:
--   update entities
--      set name = metadata->'_sidebar5_address_repair'->>'prior_name',
--          address = metadata->'_sidebar5_address_repair'->>'prior_address',
--          metadata = metadata - '_sidebar5_address_repair'
--    where id = '2f90e232-6c7c-41f2-8b4b-6cb8e7fc7e81';
update entities
   set name     = '2600 Central Fwy N',
       address  = '2600 Central Fwy N',
       metadata = metadata || jsonb_build_object('_sidebar5_address_repair', jsonb_build_object(
                    'prior_name', name,
                    'prior_address', address,
                    'reason', 'CoStar #1014478 Contacts-tab capture took the Primary Leasing Company office as the subject',
                    'header', '2600 Central Fwy N - Wichita Falls Shopping Center',
                    'gov_property_id', 41083,
                    'repaired_at', now(),
                    'batch', 'lcc_sidebar5_20260923')),
       updated_at = now()
 where id = '2f90e232-6c7c-41f2-8b4b-6cb8e7fc7e81'
   and address ilike '4005 call field%';
