-- ============================================================================
-- P136 — stage Team Briggs' own "Dialysis Ownership MASTER" workbook.
-- Applied live to LCC Opps (xengecqvemvfknjvbvrq) 2026-08-18.
-- ----------------------------------------------------------------------------
-- WHY THIS IS DIFFERENT FROM THE NOTES (P129)
--   The notes carried a TITLE only, so a row asserted "this party touched this
--   property" with no role and no hard key -- which is why P134 measured a ~10%
--   contact hit rate and 0 of 236 supersession ties broken.
--
--   This workbook carries a CMS Medicare ID (CCN) -- a hard join key to
--   dia.medicare_clinics, not a name heuristic -- and separates ROLE into its
--   own columns: Recorded / Owner / Previous / Developer. That is precisely the
--   two things the notes lacked.
--
-- MEASURED on the 2026-08-18 copy (8,909 sheet rows; 3,283 carry a party):
--   recorded 3,079 · owner 2,376 · previous 555 · developer 336
--   beneficial owners that look like PEOPLE : 1,349 distinct across 1,589 CCNs
--   pipe-delimited "SPE | principal" values :   335  (e.g. "T B PROPERTIES VII
--                                                     LLC | Thomas Burer")
--   DATED previous -> owner transitions     :   423
--
-- Loader: scripts/load-dia-ownership-master.mjs  (batch_tag 'dia_ownership_master')
--
-- Lossless + uninterpreted, same discipline as lcc_sf_note_property_assertion.
-- In particular "Previous" is a PRIOR owner and must never reach
-- lcc_property_owner as a current one (P113).
--
-- REVERSAL: delete from lcc_dia_ownership_master where batch_tag = '...';
--           drop table public.lcc_dia_ownership_master;
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.lcc_dia_ownership_master (
  id                bigserial primary key,
  medicare_ccn      text not null,
  operator          text,
  address           text,
  city              text,
  state             text,
  recorded_owner    text,        -- "Recorded"  — owner of record
  true_owner        text,        -- "Owner"     — beneficial owner (often a PERSON)
  previous_owner    text,        -- "Previous"  — the PRIOR owner, stated
  developer         text,        -- "Developer"
  last_sale_date    date,
  last_sale_price   numeric,
  cap_rate          numeric,
  batch_tag         text not null,
  created_at        timestamptz not null default now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_lcc_dia_ownership_master_row
  ON public.lcc_dia_ownership_master
     (batch_tag, medicare_ccn, coalesce(recorded_owner,''), coalesce(true_owner,''));
CREATE INDEX IF NOT EXISTS idx_lcc_dia_ownership_master_ccn
  ON public.lcc_dia_ownership_master (medicare_ccn);

COMMENT ON TABLE public.lcc_dia_ownership_master IS
  'P136. Team Briggs Dialysis Ownership MASTER.xlsx, Ownership sheet, staged '
  'lossless. Keyed on CMS CCN (hard join to dia.medicare_clinics) with ROLE '
  'separated into recorded/true/previous/developer columns -- the two things the '
  'P129 note records lacked. Not ownership evidence until a reviewable pass '
  'promotes it; "previous_owner" is a PRIOR owner and must never be written to '
  'lcc_property_owner as a current one (P113). Values may be pipe-delimited '
  '("SPE | principal") and are staged unresolved.';

GRANT SELECT ON public.lcc_dia_ownership_master TO anon, authenticated, service_role;
