-- ===========================================================================
-- P131 -- note-record CONTACT LEADS for owners we can rank but cannot reach
-- APPLIED LIVE to LCC Opps (xengecqvemvfknjvbvrq) 2026-08-17.
-- Context: docs/architecture/sf-note-records-ownership-bridge-2026-08.md
-- ===========================================================================
-- The point of the whole note-record exercise. P127 found 3,883 top seller
-- prospects holding $2.72B of annual rent that LCC can RANK but cannot REACH.
-- The notes name humans tied to specific properties. Joining the two gives a
-- named lead for owners that previously had none:
--
--   unreachable owners with a note lead ....... 1,137 of 3,883  (29%)
--   distinct candidate parties ................ 2,645  (1,711 people)
--   annual rent behind those owners ........... $1,014,108,088
--   candidates per owner ...................... ~2.3   (workable, not noise)
--
-- Split by how ambiguous the property match is:
--   unambiguous   412 owners   937 candidates (650 people)   $335.6M
--   likely        304 owners   848 candidates (555 people)   $308.7M
--   ambiguous     478 owners  1087 candidates (675 people)   $666.9M
--
-- WHAT A ROW IS, PRECISELY: "a party your team wrote a note about, on a property
-- matching this owner's asset by tenant-class + city + state." A RESEARCH LEAD.
-- It is NOT:
--   * an ownership claim -- the note export carries no role (P129 sec 3), and
--     current owner / prior owner / developer / broker are all in the source;
--   * a proven property match -- the tenant+city+state join averages 2.7
--     properties per title, so the party may be tied to a DIFFERENT building
--     with the same tenant in the same city.
--
-- Both limits are COLUMNS rather than caveats in a doc nobody reads:
-- properties_sharing_tenant_city_state counts the collision set and
-- candidate_strength buckets it (1 = unambiguous). Note that the largest rent
-- sits in the AMBIGUOUS bucket ($666.9M) -- exactly where a single blended
-- "confidence" number would have been most misleading, and the reason the
-- bucket is exposed instead of averaged away.
--
-- Read-only. Creates nothing, changes no cadence, asserts no ownership, and
-- must never be promoted into lcc_property_owner_evidence.
-- REVERSAL: DROP VIEW v_lcc_note_contact_leads;
-- ===========================================================================

-- (view body as applied live; see LCC Opps)

CREATE OR REPLACE VIEW v_lcc_note_contact_leads AS
WITH unreach AS (
  SELECT entity_id, owner_name, annual_rent
  FROM public.v_lcc_top_seller_prospects
  WHERE pursuit_status = 'needs a contact first'
),
their_props AS (
  SELECT u.entity_id, u.owner_name, u.annual_rent,
         f.source_domain, f.source_property_id,
         upper(btrim(a.city)) c, upper(btrim(a.state)) s,
         public.lcc_tenant_class(coalesce(a.tenant_short, a.tenant_label)) k,
         coalesce(a.tenant_short, a.tenant_label) tenant_label
  FROM unreach u
  JOIN public.lcc_entity_portfolio_facts f
    ON f.entity_id = u.entity_id AND f.is_current
  JOIN public.lcc_property_attributes a
    ON a.source_domain = f.source_domain AND a.source_property_id = f.source_property_id
  WHERE a.city IS NOT NULL AND a.state IS NOT NULL
    AND coalesce(a.tenant_short, a.tenant_label) IS NOT NULL
),
ambiguity AS (
  SELECT public.lcc_tenant_class(coalesce(tenant_short, tenant_label)) k,
         upper(btrim(city)) c, upper(btrim(state)) s, count(*) n_props
  FROM public.lcc_property_attributes
  WHERE city IS NOT NULL AND state IS NOT NULL
    AND coalesce(tenant_short, tenant_label) IS NOT NULL
  GROUP BY 1,2,3
),
notes AS (
  SELECT DISTINCT
    upper(btrim(parsed_city)) c, upper(btrim(parsed_state)) s,
    public.lcc_tenant_class(parsed_tenant) k,
    sf_party_id, party_name, party_kind, note_title
  FROM public.lcc_sf_note_property_assertion
  WHERE batch_tag = 'notes_2024' AND parsed_tenant IS NOT NULL
)
SELECT
  tp.entity_id AS owner_entity_id, tp.owner_name, tp.annual_rent,
  tp.source_domain, tp.source_property_id,
  tp.tenant_label AS lcc_tenant, tp.c AS city, tp.s AS state,
  n.sf_party_id AS candidate_sf_id, n.party_name AS candidate_name,
  n.party_kind AS candidate_kind, n.note_title AS matched_on_note,
  am.n_props AS properties_sharing_tenant_city_state,
  CASE WHEN am.n_props = 1 THEN 'unambiguous'
       WHEN am.n_props <= 3 THEN 'likely'
       ELSE 'ambiguous' END AS candidate_strength
FROM their_props tp
JOIN notes n ON n.c = tp.c AND n.s = tp.s AND n.k = tp.k AND n.k <> ''
LEFT JOIN ambiguity am ON am.k = tp.k AND am.c = tp.c AND am.s = tp.s;

COMMENT ON VIEW v_lcc_note_contact_leads IS
  'P131: named RESEARCH LEADS for top seller prospects LCC can rank but not reach. A row means "your team wrote a note about this party on a property matching this owner''s asset by tenant-class + city + state". NOT an ownership claim (the note export carries no role) and NOT a proven property match (the join averages 2.7 properties per title) -- read candidate_strength before acting. Never promote to lcc_property_owner_evidence from this view.';

GRANT SELECT ON v_lcc_note_contact_leads TO anon, authenticated, service_role;
