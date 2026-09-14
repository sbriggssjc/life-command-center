-- ============================================================================
-- P134 part 3 — label the note lane with its MEASURED base rate, so nobody
--               (including me) reads 685 rows as 685 contacts again.
-- Applied live to LCC Opps (xengecqvemvfknjvbvrq) 2026-08-18.
-- ----------------------------------------------------------------------------
-- The two new columns are APPENDED at the END of the SELECT (CREATE OR REPLACE
-- VIEW is append-only for columns; inserting mid-list raises 42P16).
--
-- LIVE SPLIT 2026-08-18:
--   domain_confirmed = true   ->  13 rows /  11 owners /  $17.6M   (workable)
--   domain_confirmed = false  -> 672 rows / 289 owners / $262.3M   (evidence)
--
-- REVERSAL: re-run 20260927120000_lcc_p132_note_lead_attach_review.sql, which
-- holds the prior (unlabelled) body. Nothing but the view definition changes.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_lcc_note_lead_attach_review AS
SELECT DISTINCT
  l.owner_entity_id,
  l.owner_name,
  l.annual_rent,
  l.source_domain,
  l.source_property_id,
  l.lcc_tenant,
  l.city,
  l.state,
  l.candidate_sf_id,
  l.candidate_name,
  ei.entity_id                                              AS candidate_entity_id,
  e.email                                                   AS candidate_email,
  e.phone                                                   AS candidate_phone,
  e.entity_type::text                                       AS candidate_entity_type,
  l.matched_on_note,
  (SELECT max(n.note_created_at) FROM public.lcc_sf_note_property_assertion n
    WHERE n.sf_party_id = l.candidate_sf_id AND n.note_title = l.matched_on_note)
                                                            AS note_last_written,
  (SELECT string_agg(DISTINCT n.note_author, ', ') FROM public.lcc_sf_note_property_assertion n
    WHERE n.sf_party_id = l.candidate_sf_id AND n.note_title = l.matched_on_note)
                                                            AS note_authors,
  (SELECT count(*) FROM public.lcc_sf_note_property_assertion n
    WHERE n.sf_party_id = l.candidate_sf_id)                AS notes_on_this_party,
  -- ---- appended by P134 -------------------------------------------------
  public.lcc_email_domain_confirms_owner(e.email, l.owner_name)
                                                            AS domain_confirmed,
  CASE
    WHEN public.lcc_email_domain_confirms_owner(e.email, l.owner_name)
      THEN 'workable — email domain is the owner''s own'
    ELSE 'NOT workable as a contact — unvalidated note party '
      || '(prior owner / developer / broker / tenant is the common case)'
  END                                                       AS disposition
FROM public.v_lcc_note_contact_leads l
JOIN public.external_identities ei
  ON ei.source_system = 'salesforce' AND ei.source_type = 'Contact'
 AND ei.external_id = l.candidate_sf_id
JOIN public.entities e ON e.id = ei.entity_id
WHERE l.candidate_strength = 'unambiguous'
  AND l.candidate_kind = 'contact'
  AND (e.email IS NOT NULL OR e.phone IS NOT NULL);

COMMENT ON VIEW public.v_lcc_note_lead_attach_review IS
  'P132 candidate set, RE-LABELLED by P134 after Scott validated a 10-row sample '
  'on 2026-08-18. MEASURED BASE RATE: roughly 1 in 10 rows is the owner''s current '
  'contact. The rest are PRIOR owners, developers, brokers and tenants -- these '
  'notes are an ownership-CHAIN record, not a contact list. Team Briggs wrote a '
  'note each time a party touched a property, so one property accumulates '
  'developer + prior owner + current owner over years. '
  'ONLY rows with domain_confirmed = true are workable as contacts; those are '
  'seeded into lcc_owner_contact_propagate_review by '
  'lcc_p134_seed_note_domain_confirmed(). Everything else is retained as evidence '
  'and must NEVER be bulk-attached -- doing so writes another company''s person '
  'onto a top prospect (the P111 failure mode, here confirmed empirically). '
  'MEASURED NEGATIVE (P134): the notes CANNOT order the ownership chain either -- '
  'of the 236 assets tied in v_lcc_owner_supersession_review, only 8 have any '
  'owner named in a note, 3 have two, and 0 have distinct dates. Do not re-attempt '
  'note-date supersession without new evidence.';

GRANT SELECT ON public.v_lcc_note_lead_attach_review TO anon, authenticated, service_role;
