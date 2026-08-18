-- ===========================================================================
-- P132 -- the actionable slice: note leads we can already CALL, for review
-- APPLIED LIVE to LCC Opps (xengecqvemvfknjvbvrq) 2026-08-17.
-- Context: docs/architecture/sf-note-records-ownership-bridge-2026-08.md
-- ===========================================================================
-- P131 gave 1,137 unreachable top prospects a named lead. This narrows to what
-- is actionable today:
--
--   unambiguous leads that are PEOPLE ........ 650 across 412 owners
--   ... already an LCC entity ................ 436
--   ... WITH an email or phone on file ....... 424
--   => OWNERS IMMEDIATELY REACHABLE .......... 294    ($265,633,776 of rent)
--   ... candidates needing an SF fetch ....... 214
--
-- Live shape: 685 proposal rows, 294 owners, 424 people, 665 with an email,
-- ZERO non-person-shaped candidates, notes written 2019-12-06 .. 2023-11-30.
--
-- WHY A REVIEW LANE AND NOT AN AUTO-ATTACH:
-- Attaching a person to an owner asserts who speaks for that company, and P111
-- measured what automating it does: of 101 rows in the owner-contact propagate
-- lane, 77 were organization-shaped and dominated by TRANSACTION COUNTERPARTIES
-- -- confirming them writes another company's switchboard onto the owner. The
-- standing rule from that round is "never wire a single confirm button to it."
--
-- This lane carries TWO independent uncertainties, so it is weaker still:
--   1. ROLE IS UNKNOWN. The note export has no role column; current owner, prior
--      owner, developer and broker are all in the source (P129 sec 3). The lead
--      may be the broker who sold it.
--   2. The PROPERTY match is tenant-class + city + state. 'unambiguous' means
--      exactly one property shares that triple -- strong, but not an address.
--
-- So each row carries the evidence that produced it -- note title, authors, last
-- written date, and how many notes exist on that party -- so the verdict is made
-- on evidence rather than on a score. A 2019 note from a departed analyst is a
-- different proposition from a 2023 note by the deal lead, and the reviewer can
-- see which they have.
--
-- Read-only. Attaches nothing, creates no entity_relationships, seeds no cadence.
-- REVERSAL: DROP VIEW v_lcc_note_lead_attach_review;
-- ===========================================================================

CREATE OR REPLACE VIEW v_lcc_note_lead_attach_review AS
SELECT DISTINCT
  l.owner_entity_id, l.owner_name, l.annual_rent,
  l.source_domain, l.source_property_id, l.lcc_tenant, l.city, l.state,
  l.candidate_sf_id, l.candidate_name,
  ei.entity_id AS candidate_entity_id,
  e.email AS candidate_email, e.phone AS candidate_phone,
  e.entity_type::text AS candidate_entity_type,
  l.matched_on_note,
  (SELECT max(n.note_created_at) FROM public.lcc_sf_note_property_assertion n
    WHERE n.sf_party_id = l.candidate_sf_id AND n.note_title = l.matched_on_note) AS note_last_written,
  (SELECT string_agg(DISTINCT n.note_author, ', ') FROM public.lcc_sf_note_property_assertion n
    WHERE n.sf_party_id = l.candidate_sf_id AND n.note_title = l.matched_on_note) AS note_authors,
  (SELECT count(*) FROM public.lcc_sf_note_property_assertion n
    WHERE n.sf_party_id = l.candidate_sf_id) AS notes_on_this_party
FROM public.v_lcc_note_contact_leads l
JOIN public.external_identities ei
  ON ei.source_system='salesforce' AND ei.source_type='Contact' AND ei.external_id = l.candidate_sf_id
JOIN public.entities e ON e.id = ei.entity_id
WHERE l.candidate_strength = 'unambiguous'
  AND l.candidate_kind = 'contact'
  AND (e.email IS NOT NULL OR e.phone IS NOT NULL);

COMMENT ON VIEW v_lcc_note_lead_attach_review IS
  'P132: PROPOSALS to attach a named, contactable person to a top-prospect owner LCC cannot otherwise reach. NOT auto-confirmable -- role is unknown (the note export has no role column) and the property match is tenant-class+city+state, not an address. P111 measured that automating this class writes counterparties'' switchboards onto owners; the standing rule is "never wire a single confirm button to it". Each row carries the note title, authors and date so a human decides on evidence.';

GRANT SELECT ON v_lcc_note_lead_attach_review TO anon, authenticated, service_role;
