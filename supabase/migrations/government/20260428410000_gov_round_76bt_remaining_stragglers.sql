-- ============================================================================
-- Round 76bt — Gov lease placeholder backfill (Round 76bp trigger added the
-- forward guard but didn't backfill these 5 pre-existing rows).
--
-- All 5 are excel_master legacy rows with annual_rent ∈ {1, 8, 9, 14, 50}
-- — clear placeholders or parser errors (where rent==rent_psf at single-
-- digit values is a tell that the wrong column was read).
--
-- The 2 rows with rent_psf < 1 ($0.52, $0.73) are LEFT alone. Both have
-- realistic annual_rent ($8.7K and $17.4K). They look like real subsidized
-- GSA storage/parking leases and are within the realm of possibility.
-- ============================================================================

UPDATE public.leases SET annual_rent = NULL
 WHERE annual_rent IS NOT NULL AND annual_rent < 100;

-- Where rent_psf was equal to a sub-$100 annual_rent, that's also bogus
-- (the rent_psf was confused with annual_rent during parse).
UPDATE public.leases SET rent_psf = NULL
 WHERE annual_rent IS NULL AND rent_psf IS NOT NULL AND rent_psf < 100
   AND lease_id IN (
     'cacee815-def8-4e90-ae1b-9518f2bed8e5',
     '2b07004f-1d08-4b8d-ad92-f9239771af26',
     '854896e4-d644-4363-b40b-a8ceea17c1f8'
   );
