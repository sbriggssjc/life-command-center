-- P197 — the Tier 0 lane read ONE employer source (unified_contacts, by email only).
--
-- Measured 2026-08-27 on LCC Opps:
--   * 5,193 live person entities with an email have no unified_contacts row at all
--     (the widely-quoted 5,440 is 247 too high: those DO have a hub row, linked by
--     entity_id, which the email-keyed detector cannot see).
--   * 67 Tier 0 cards / $131.2M park as `no_employer_on_file`. That reason means
--     "no candidate on this card has a contact_company" -- and contact_company came
--     from exactly one place: LEFT JOIN unified_contacts ON lower(email)=lower(email).
--   * The employer for those people is frequently ON FILE somewhere else:
--       - 4 eligible people have a hub row reachable only by entity_id;
--       - 20 are in lcc_sf_list_membership WITH a company_name (6,781 such rows exist,
--         and the lane has never read one);
--       - 20 carry entities.metadata->>'company'.
--
-- ⚠️ THE OBVIOUS FIX -- "copy whatever company we hold onto the card" -- IS THE
-- DESTRUCTIVE ONE, AND IT WAS MEASURED ON NAMED ROWS BEFORE BEING REJECTED.
-- Neither lcc_sf_list_membership.company_name nor entities.metadata->>'company' is an
-- employer register; both are human/capture labels that go stale or were never right:
--     "Southbury, CT 06488"  and "Hollywood, FL 33021"      -- a CITY/ZIP in the company field
--     "Steve Blumer"                                        -- the person's own name
--     "Inco Commercial" (x2 people sharing ONE mailbox)      -- a P188-named junk label
--     "Pop Local"          for a person @edwardsrealtyco.com -- a different firm entirely
--     "The Carpet Shop"    for a person @corporaterealty1.com
--     "Rocky Knoll Farms"  for a person @trademarkconstruction.net
--     "Community Trust Bk" proposed against a HEALTH-CENTER owner
-- Writing those into the field the Tier 0 comparator reads would manufacture employers,
-- and an employer that happens to collide with an owner name manufactures a LINK --
-- exactly the claim P188 established these signals cannot make.
--
-- So the unverified tiers must be CORROBORATED by the person's own email domain before
-- they count: SF (or a capture) says X, and the mailbox they actually use says X too.
-- That gate kills every row listed above and keeps the real ones (Capstone Partners
-- @capstone-partners.com, Master Realty @masterrealty.net, SteelWave @steelwavellc.com).
--
-- What this migration does NOT do: it mints nothing. No unified_contacts row is created,
-- no owner_contact_pivot is written, no entity is touched. It only lets the lane SEE
-- employer facts the system already holds, and records WHERE each one came from.
--
-- SAFETY -- this cannot cause an unattended write. decidability='auto' requires
-- match_strength='exact' AND n_eligible=1; neither is touched here. The only reachable
-- transitions are parked -> ask (a human question) and no_employer_on_file ->
-- employer_on_file_differs (an honest reject).
--
-- Reversal: re-run migration 20260827160000 (P196), then 20260827090000 (P194) for
-- v_lcc_tier0_park_watch, and drop the two functions added here.


-- ---------------------------------------------------------------------------
-- 1. ONE definition of "this company string is corroborated by that email domain".
--    v_lcc_tier0_owner_contact_lane had this rule inline as ev_company_confirms_employer;
--    it now calls this function, so the gate the operator sees and the gate the resolver
--    applies cannot drift apart.
-- ---------------------------------------------------------------------------
create or replace function public.lcc_tier0_company_confirms_domain(p_company text, p_sldn text)
returns boolean
language sql
immutable
as $$
  select length(public.lcc_owner_domain_core(p_company)) >= 5
     and length(coalesce(p_sldn, '')) >= 5
     and (position(public.lcc_owner_domain_core(p_company) in p_sldn) > 0
       or position(p_sldn in public.lcc_owner_domain_core(p_company)) > 0);
$$;

comment on function public.lcc_tier0_company_confirms_domain(text, text) is
'P197: single owner of the company<->email-domain corroboration rule. Mirrors what
ev_company_confirms_employer meant in v_lcc_tier0_owner_contact_lane, which now calls this.';

-- ---------------------------------------------------------------------------
-- 2. The ranked employer resolver. Tiers 1-2 are the hub and are taken as-is (the hub
--    IS the system of record: whatever it says is "on file" by definition). Tiers 3-4
--    are unverified labels and must clear the corroboration gate above.
--    Returns at most one row; `source` is what the card displays.
-- ---------------------------------------------------------------------------
create or replace function public.lcc_tier0_employer_on_file(p_person_id uuid, p_email text)
returns table(company text, source text)
language sql
stable
as $$
  with sld as (
    select regexp_replace(lower(split_part(split_part(coalesce(p_email, ''), '@', 2), '.', 1)),
                          '[^a-z0-9]', '', 'g') as s
  )
  select z.company, z.source
  from (
    -- tier 1: the hub, matched on email (the pre-P197 behaviour, unchanged)
    select btrim(u.company_name) as company, 'hub_email'::text as source, 1 as ord
      from public.unified_contacts u
     where p_email is not null
       and lower(u.email) = lower(p_email)
       and nullif(btrim(u.company_name), '') is not null

    union all
    -- tier 2: the hub, matched on entity_id. 247 person entities fleet-wide are reachable
    -- ONLY this way; the lane could not see any of them.
    select btrim(u.company_name), 'hub_entity_id', 2
      from public.unified_contacts u
     where u.entity_id = p_person_id
       and nullif(btrim(u.company_name), '') is not null

    union all
    -- tier 3: Salesforce campaign membership, corroborated by the mailbox.
    select btrim(m.company_name), 'sf_campaign', 3
      from public.lcc_sf_list_membership m
      cross join sld
     where m.entity_id = p_person_id
       and nullif(btrim(m.company_name), '') is not null
       and public.lcc_tier0_company_confirms_domain(m.company_name, sld.s)

    union all
    -- tier 4: a capture-time company on the entity, corroborated by the mailbox.
    select btrim(e.metadata->>'company'), 'entity_capture', 4
      from public.entities e
      cross join sld
     where e.id = p_person_id
       and nullif(btrim(e.metadata->>'company'), '') is not null
       and public.lcc_tier0_company_confirms_domain(e.metadata->>'company', sld.s)
  ) z
  order by z.ord
  limit 1;
$$;

comment on function public.lcc_tier0_employer_on_file(uuid, text) is
'P197: the single owner of "what employer do we hold for this person". Ranked hub_email >
hub_entity_id > sf_campaign > entity_capture; the two unverified tiers must be corroborated
by the person''s own email domain (lcc_tier0_company_confirms_domain) because both are
human/capture labels that measurably carry city/zip strings, self-echoes and stale firms.';


-- ---------------------------------------------------------------------------
-- 3. v_lcc_tier0_owner_contact_candidates -- carried WHOLE.
--    P194 was burned by rebuilding one of these views from a stale committed copy and
--    silently dropping two live arms (predicted 1-row diff, actual 21). This body is
--    transcribed from the LIVE pg_get_viewdef and changes exactly three things:
--      (a) the hub lookup now matches on email OR entity_id (was: email only);
--      (b) contact_company comes from lcc_tier0_employer_on_file;
--      (c) employer_source is appended (CREATE OR REPLACE VIEW is append-only).
--    The resolver is bounded to matched pairs in a MATERIALIZED CTE on purpose: the
--    planner otherwise pushes the hub join down to the whole 7,890-row `people` set.
-- ---------------------------------------------------------------------------
create or replace view public.v_lcc_tier0_owner_contact_candidates as
 WITH owner_rent AS (
         SELECT f.entity_id,
            COALESCE(sum(f.annual_rent) FILTER (WHERE f.is_current), 0::numeric) AS owner_rent
           FROM lcc_entity_portfolio_facts f
          GROUP BY f.entity_id
        ), owners AS (
         SELECT DISTINCT po.owner_entity_id AS owner_id,
            e.name AS owner_name,
            COALESCE(r.owner_rent, 0::numeric) AS owner_rent,
            lcc_owner_domain_core(e.name) AS core
           FROM lcc_property_owner po
             JOIN entities e ON e.id = po.owner_entity_id
             LEFT JOIN owner_rent r ON r.entity_id = po.owner_entity_id
          WHERE e.merged_into_entity_id IS NULL AND e.entity_type = 'organization'::entity_type AND COALESCE(r.owner_rent, 0::numeric) >= 500000::numeric AND NOT lcc_owner_name_is_not_prospected(e.name)
        ), owner_tok AS (
         SELECT o_1.owner_id,
            o_1.owner_name,
            o_1.owner_rent,
            t.t AS tok
           FROM owners o_1
             CROSS JOIN LATERAL unnest(regexp_split_to_array(lower(regexp_replace(o_1.owner_name, '[^a-zA-Z ]'::text, ''::text, 'g'::text)), '\s+'::text)) t(t)
          WHERE length(t.t) >= 5 AND (t.t <> ALL (ARRAY['trust'::text, 'group'::text, 'holdings'::text, 'properties'::text, 'partners'::text, 'capital'::text, 'company'::text, 'realty'::text, 'investors'::text, 'management'::text, 'development'::text, 'associates'::text, 'incorporated'::text, 'limited'::text, 'national'::text, 'american'::text, 'government'::text, 'property'::text, 'asset'::text, 'assets'::text, 'income'::text, 'equity'::text, 'equities'::text, 'commercial'::text, 'residential'::text, 'industrial'::text, 'venture'::text, 'ventures'::text, 'enterprise'::text, 'enterprises'::text, 'financial'::text, 'finance'::text, 'realestate'::text, 'services'::text, 'solutions'::text, 'systems'::text, 'corporation'::text, 'partnership'::text, 'premier'::text, 'first'::text, 'second'::text, 'third'::text, 'general'::text, 'united'::text, 'global'::text, 'western'::text, 'eastern'::text, 'northern'::text, 'southern'::text, 'pacific'::text, 'atlantic'::text, 'central'::text, 'tenant'::text, 'tenants'::text, 'developer'::text, 'developers'::text, 'office'::text, 'offices'::text, 'urban'::text, 'gateway'::text, 'street'::text, 'avenue'::text, 'building'::text, 'buildings'::text, 'center'::text, 'centre'::text, 'plaza'::text, 'tower'::text, 'towers'::text, 'place'::text, 'court'::text, 'square'::text, 'station'::text, 'village'::text, 'ridge'::text, 'creek'::text, 'valley'::text, 'lakes'::text, 'river'::text, 'point'::text, 'pointe'::text, 'heights'::text, 'hills'::text, 'springs'::text, 'grove'::text, 'woods'::text, 'meadows'::text, 'landing'::text, 'crossing'::text, 'commons'::text, 'terrace'::text, 'harbor'::text, 'island'::text, 'beach'::text, 'bridge'::text, 'summit'::text, 'estates'::text, 'campus'::text, 'market'::text, 'metro'::text, 'brook'::text, 'stone'::text, 'columbia'::text, 'century'::text, 'north'::text, 'south'::text, 'america'::text, 'omaha'::text, 'denver'::text, 'dallas'::text, 'houston'::text, 'phoenix'::text, 'austin'::text, 'seattle'::text, 'portland'::text, 'atlanta'::text, 'boston'::text, 'chicago'::text, 'detroit'::text, 'orlando'::text, 'tampa'::text, 'tucson'::text, 'wichita'::text, 'spokane'::text, 'fresno'::text, 'tulsa'::text, 'hawaii'::text, 'alaska'::text, 'nevada'::text, 'arizona'::text, 'indiana'::text, 'kansas'::text, 'oregon'::text, 'montana'::text, 'dakota'::text, 'nebraska'::text, 'oklahoma'::text, 'missouri'::text, 'michigan'::text, 'wisconsin'::text, 'minnesota'::text, 'colorado'::text, 'virginia'::text, 'carolina'::text, 'tennessee'::text, 'kentucky'::text, 'alabama'::text, 'mississippi'::text, 'louisiana'::text, 'arkansas'::text, 'delaware'::text, 'maryland'::text, 'florida'::text, 'georgia'::text, 'worth'::text]))
        ), people AS (
         SELECT e.id AS person_id,
            e.name AS person_name,
            e.email,
            e.phone,
            lower(split_part(split_part(e.email, '@'::text, 2), '.'::text, 1)) AS sld,
            regexp_replace(lower(split_part(split_part(e.email, '@'::text, 2), '.'::text, 1)), '[^a-z0-9]'::text, ''::text, 'g'::text) AS sldn,
            lower(split_part(e.email, '@'::text, 2)) AS domain
           FROM entities e
          WHERE e.entity_type = 'person'::entity_type AND e.merged_into_entity_id IS NULL AND e.email ~~ '%@%'::text AND NOT lcc_is_consumer_mailbox_domain(split_part(e.email, '@'::text, 2))
        ), person_prefix AS (
         SELECT p_1.person_id,
            p_1.sld,
            "left"(p_1.sld, k.k) AS pfx
           FROM people p_1
             CROSS JOIN LATERAL generate_series(5, length(p_1.sld)) k(k)
        ), tok_fan AS (
         SELECT ot.tok,
            count(DISTINCT pp.sld) AS dd,
            count(DISTINCT ot.owner_id) AS od
           FROM owner_tok ot
             JOIN person_prefix pp ON pp.pfx = ot.tok
          GROUP BY ot.tok
        ), pfx_fan AS (
         SELECT "left"(people.sldn, 8) AS p8,
            count(DISTINCT people.sldn) AS dd
           FROM people
          WHERE length(people.sldn) >= 8
          GROUP BY ("left"(people.sldn, 8))
        ), matched_raw AS (
         SELECT DISTINCT ot.owner_id,
            pp.person_id,
            'token'::text AS arm,
            ot.tok AS key
           FROM owner_tok ot
             JOIN tok_fan tf ON tf.tok = ot.tok AND tf.dd <= 2 AND tf.od <= 2
             JOIN person_prefix pp ON pp.pfx = ot.tok
        UNION
         SELECT DISTINCT o_1.owner_id,
            p_1.person_id,
            'core8'::text AS text,
            "left"(p_1.sldn, 8) AS "left"
           FROM owners o_1
             JOIN people p_1 ON length(o_1.core) >= 8 AND length(p_1.sldn) >= 8 AND "left"(o_1.core, 8) = "left"(p_1.sldn, 8)
             JOIN pfx_fan f ON f.p8 = "left"(p_1.sldn, 8) AND f.dd <= 2
        UNION
         SELECT DISTINCT o_1.owner_id,
            p_1.person_id,
            'sponsor_map'::text AS text,
            sd.sponsor_token
           FROM owners o_1
             JOIN lcc_owner_sponsor_domain sd ON o_1.owner_name ~* (('\m'::text || sd.sponsor_token) || '\M'::text)
             JOIN people p_1 ON p_1.domain = sd.email_domain
        ), matched AS (
         SELECT matched_raw.owner_id,
            matched_raw.person_id,
            string_agg(DISTINCT matched_raw.arm, '+'::text ORDER BY matched_raw.arm) AS match_arm,
            string_agg(DISTINCT matched_raw.key, ','::text ORDER BY matched_raw.key) AS match_key
           FROM matched_raw
          GROUP BY matched_raw.owner_id, matched_raw.person_id
        ), matched_person AS MATERIALIZED (
         SELECT DISTINCT m.person_id, p_1.email
           FROM matched m
             JOIN people p_1 ON p_1.person_id = m.person_id
        ), hub AS MATERIALIZED (
         SELECT mp.person_id, u.title, u.outlook_contact_id
           FROM matched_person mp
             LEFT JOIN LATERAL (
               SELECT u2.title, u2.outlook_contact_id
                 FROM unified_contacts u2
                WHERE lower(u2.email) = lower(mp.email) OR u2.entity_id = mp.person_id
                ORDER BY (lower(u2.email) = lower(mp.email)) DESC, u2.updated_at DESC NULLS LAST
                LIMIT 1
             ) u ON true
        ), emp AS MATERIALIZED (
         SELECT mp.person_id, r.company, r.source
           FROM matched_person mp
             LEFT JOIN LATERAL lcc_tier0_employer_on_file(mp.person_id, mp.email) r ON true
        ), owner_has_contact AS (
         SELECT DISTINCT pv.entity_id
           FROM owner_contact_pivot pv
          WHERE pv.active_contact_entity_id IS NOT NULL
        ), rel_pair AS (
         SELECT entity_relationships.from_entity_id AS a,
            entity_relationships.to_entity_id AS b
           FROM entity_relationships
        UNION
         SELECT entity_relationships.to_entity_id,
            entity_relationships.from_entity_id
           FROM entity_relationships
        )
 SELECT o.owner_id,
    o.owner_name,
    o.owner_rent,
    p.person_id,
    p.person_name,
    p.email,
    p.domain,
    hub.title AS contact_title,
    emp.company AS contact_company,
        CASE
            WHEN hub.title ~* '(acquisition|investment|capital market)'::text THEN 'acquisitions'::text
            WHEN hub.title ~* '(disposition|asset manage|portfolio manage)'::text THEN 'disposition'::text
            WHEN hub.title ~* '(broker|agent|realtor)'::text THEN 'broker'::text
            WHEN hub.title ~* '(analyst|coordinator|assistant|coordinator|transaction|due diligence|escrow)'::text THEN 'transaction_support'::text
            WHEN hub.title ~* '(president|principal|partner|owner|founder|ceo|managing director)'::text THEN 'principal'::text
            WHEN hub.title IS NOT NULL AND hub.title <> ''::text THEN 'other_titled'::text
            ELSE 'no_title'::text
        END AS role_bucket,
    hub.outlook_contact_id IS NOT NULL AS from_outlook_sync,
    ohc.entity_id IS NOT NULL AS owner_already_has_contact,
    rp.a IS NOT NULL AS already_linked,
    m.match_arm,
    m.match_key,
    emp.source AS employer_source
   FROM matched m
     JOIN owners o ON o.owner_id = m.owner_id
     JOIN people p ON p.person_id = m.person_id
     LEFT JOIN hub ON hub.person_id = m.person_id
     LEFT JOIN emp ON emp.person_id = m.person_id
     LEFT JOIN owner_has_contact ohc ON ohc.entity_id = o.owner_id
     LEFT JOIN rel_pair rp ON rp.a = o.owner_id AND rp.b = p.person_id;

comment on view public.v_lcc_tier0_owner_contact_candidates is
'P197: contact_company now resolves through lcc_tier0_employer_on_file (hub_email >
hub_entity_id > corroborated sf_campaign > corroborated entity_capture) instead of a
single email-keyed join to unified_contacts, and employer_source names which tier answered.';

-- ---------------------------------------------------------------------------
-- 4. v_lcc_tier0_owner_contact_lane -- carried WHOLE. Changes:
--      (a) ev_company_confirms_employer now CALLS lcc_tier0_company_confirms_domain
--          rather than restating the rule inline (one owner, no drift);
--      (b) each person in `people` carries employer_source, so a card can say whether
--          its employer came from the hub, from Salesforce, or from a capture;
--      (c) employer_sources appended.
--    n_link_evidence / n_person_evidence / n_employer_on_file are unchanged in DEFINITION
--    -- they simply now see employers that were always on file and unreadable.
-- ---------------------------------------------------------------------------
create or replace view public.v_lcc_tier0_owner_contact_lane as
 WITH c AS (
         SELECT v.owner_id, v.owner_name, v.owner_rent, v.person_id, v.person_name, v.email,
            v.domain, v.contact_title, v.contact_company, v.role_bucket, v.from_outlook_sync,
            v.owner_already_has_contact, v.already_linked, v.match_arm, v.match_key,
            v.employer_source
           FROM v_lcc_tier0_owner_contact_candidates v
        ), uc AS (
         SELECT lower(u.email) AS email_l,
            bool_or(u.sf_contact_id IS NOT NULL) AS has_sf_contact,
            bool_or(u.outlook_contact_id IS NOT NULL) AS has_outlook,
            bool_or(u.last_email_date IS NOT NULL OR u.last_meeting_date IS NOT NULL OR u.last_call_date IS NOT NULL) AS has_correspondence,
            max(u.last_email_date) AS last_email_date
           FROM unified_contacts u
          WHERE u.email IS NOT NULL AND u.email <> ''::text
          GROUP BY (lower(u.email))
        ), camp AS (
         SELECT m.entity_id,
            count(*)::integer AS n_campaigns,
            (array_agg(DISTINCT m.campaign_name))[1:3] AS campaign_names
           FROM lcc_sf_list_membership m
          WHERE m.entity_id IS NOT NULL
          GROUP BY m.entity_id
        ), enriched AS (
         SELECT c.owner_id, c.owner_name, c.owner_rent, c.person_id, c.person_name, c.email,
            c.domain, c.contact_title, c.contact_company, c.role_bucket, c.from_outlook_sync,
            c.owner_already_has_contact, c.already_linked, c.match_arm, c.match_key,
            c.employer_source,
            lcc_owner_domain_core(c.owner_name) AS owner_core,
            lcc_owner_domain_core(c.contact_company) AS company_core,
            regexp_replace(lower(split_part(c.domain, '.'::text, 1)), '[^a-z0-9]'::text, ''::text, 'g'::text) AS sldn,
            COALESCE(uc.has_sf_contact, false) AS ev_sf_contact,
            COALESCE(uc.has_outlook, false) AS ev_outlook,
            COALESCE(uc.has_correspondence, false) AS ev_correspondence,
            uc.last_email_date,
            COALESCE(camp.n_campaigns, 0) AS n_campaigns,
            camp.campaign_names,
            c.role_bucket = 'broker'::text AS is_broker,
            lcc_is_rejected_contact_name(c.person_name) AS name_rejected,
            lcc_looks_like_person(c.person_name) AS name_person_shaped
           FROM c
             LEFT JOIN uc ON uc.email_l = lower(c.email)
             LEFT JOIN camp ON camp.entity_id = c.person_id
        ), scored AS (
         SELECT e_1.owner_id, e_1.owner_name, e_1.owner_rent, e_1.person_id, e_1.person_name,
            e_1.email, e_1.domain, e_1.contact_title, e_1.contact_company, e_1.role_bucket,
            e_1.from_outlook_sync, e_1.owner_already_has_contact, e_1.already_linked,
            e_1.match_arm, e_1.match_key, e_1.employer_source, e_1.owner_core, e_1.company_core,
            e_1.sldn, e_1.ev_sf_contact, e_1.ev_outlook, e_1.ev_correspondence,
            e_1.last_email_date, e_1.n_campaigns, e_1.campaign_names, e_1.is_broker,
            e_1.name_rejected, e_1.name_person_shaped,
            e_1.n_campaigns > 0 AS ev_sf_campaign,
            lcc_tier0_company_confirms_domain(e_1.contact_company, e_1.sldn) AS ev_company_confirms_employer,
            length(e_1.company_core) >= 6 AND length(e_1.owner_core) >= 6 AND (POSITION((e_1.company_core) IN (e_1.owner_core)) > 0 OR POSITION((e_1.owner_core) IN (e_1.company_core)) > 0 OR length(e_1.company_core) >= 8 AND length(e_1.owner_core) >= 8 AND "left"(e_1.company_core, 8) = "left"(e_1.owner_core, 8)) AS ev_company_matches_owner,
            length(e_1.company_core) >= 6 AND length(e_1.owner_core) >= 6 AS employer_comparable,
            COALESCE(btrim(e_1.contact_company), ''::text) <> ''::text AS employer_on_file,
            lcc_tier0_sponsor_brand_token(e_1.owner_name, e_1.contact_company) AS sponsor_tok,
            NOT e_1.role_bucket = 'broker'::text AND NOT e_1.name_rejected AND e_1.name_person_shaped AS eligible,
                CASE
                    WHEN e_1.role_bucket = 'broker'::text THEN 'broker_role'::text
                    WHEN e_1.name_rejected THEN 'rejected_contact_name'::text
                    WHEN NOT e_1.name_person_shaped THEN 'not_person_shaped'::text
                    ELSE NULL::text
                END AS block_reason
           FROM enriched e_1
        ), grouped AS (
         SELECT s.owner_id,
            s.owner_name,
            max(s.owner_rent) AS owner_rent,
            s.domain,
            count(*)::integer AS n_candidates,
            count(*) FILTER (WHERE s.eligible)::integer AS n_eligible,
            count(*) FILTER (WHERE NOT s.eligible)::integer AS n_excluded,
            bool_or(s.owner_already_has_contact) AS owner_already_has_contact,
            count(*) FILTER (WHERE s.eligible AND s.ev_company_matches_owner)::integer AS n_link_evidence,
            count(*) FILTER (WHERE s.eligible AND (s.ev_sf_campaign OR s.ev_sf_contact OR s.ev_outlook OR s.ev_correspondence OR s.ev_company_confirms_employer))::integer AS n_person_evidence,
            count(*) FILTER (WHERE s.eligible AND s.already_linked)::integer AS n_already_linked,
            string_agg(DISTINCT s.match_arm, '+'::text ORDER BY s.match_arm) AS match_arms,
            (array_agg(DISTINCT s.match_key))[1:4] AS match_keys,
            count(*) FILTER (WHERE s.eligible AND s.employer_on_file)::integer AS n_employer_on_file,
            count(*) FILTER (WHERE s.eligible AND s.employer_comparable)::integer AS n_employer_comparable,
            (array_agg(DISTINCT s.contact_company) FILTER (WHERE s.eligible AND s.employer_on_file))[1:3] AS employers_on_file,
            min(s.sponsor_tok) FILTER (WHERE s.eligible) AS sponsor_token_candidate,
            (array_agg(DISTINCT s.employer_source) FILTER (WHERE s.eligible AND s.employer_on_file))[1:3] AS employer_sources,
            jsonb_agg(jsonb_build_object('person_id', s.person_id, 'person_name', s.person_name, 'email', s.email, 'title', s.contact_title, 'company', s.contact_company, 'employer_source', s.employer_source, 'role_bucket', s.role_bucket, 'match_arm', s.match_arm, 'match_key', s.match_key, 'eligible', s.eligible, 'block_reason', s.block_reason, 'already_linked', s.already_linked, 'from_outlook_sync', s.from_outlook_sync, 'last_email_date', s.last_email_date, 'campaign_names', to_jsonb(COALESCE(s.campaign_names, ARRAY[]::text[])), 'evidence', jsonb_build_object('sf_campaign', s.ev_sf_campaign, 'sf_contact', s.ev_sf_contact, 'outlook', s.ev_outlook, 'correspondence', s.ev_correspondence, 'company_confirms_employer', s.ev_company_confirms_employer, 'company_matches_owner', s.ev_company_matches_owner)) ORDER BY s.eligible DESC, s.ev_company_matches_owner DESC, (s.role_bucket = ANY (ARRAY['acquisitions'::text, 'principal'::text])) DESC, s.person_name) AS people
           FROM scored s
          GROUP BY s.owner_id, s.owner_name, s.domain
        )
 SELECT g.owner_id, g.owner_name, g.owner_rent, g.domain, g.n_candidates, g.n_eligible,
    g.n_excluded, g.owner_already_has_contact, g.n_link_evidence, g.n_person_evidence,
    g.n_already_linked, g.match_arms, g.match_keys, g.people,
    e.workspace_id AS owner_workspace_id,
    count(*) OVER (PARTITION BY g.owner_id)::integer AS owner_domain_cards,
    g.owner_rent AS rank_value,
    g.n_employer_on_file, g.n_employer_comparable, g.employers_on_file,
    g.sponsor_token_candidate,
    g.employer_sources
   FROM grouped g
     LEFT JOIN entities e ON e.id = g.owner_id;

-- ---------------------------------------------------------------------------
-- 5. v_lcc_tier0_owner_contact_lane_triage -- carried WHOLE, appending
--    park_employer_source and employer_sources. P196 established that a park needs a
--    REASON; a park (or an ask) that now rests on a Salesforce label or a capture string
--    must also say WHOSE record it rested on, or the operator cannot tell a hub fact from
--    a corroborated guess -- the one-label-two-facts failure P181 names.
--    The decidability CASE is UNCHANGED -- 'auto' still requires match_strength='exact'
--    AND n_eligible=1 -- so nothing here widens what the auto-attach sweep may write.
-- ---------------------------------------------------------------------------
create or replace view public.v_lcc_tier0_owner_contact_lane_triage as
 WITH base AS (
         SELECT l.owner_id, l.owner_name, l.owner_rent, l.domain, l.n_candidates, l.n_eligible,
            l.n_excluded, l.owner_already_has_contact, l.n_link_evidence, l.n_person_evidence,
            l.n_already_linked, l.match_arms, l.match_keys, l.people, l.owner_workspace_id,
            l.owner_domain_cards, l.rank_value, l.n_employer_on_file, l.n_employer_comparable,
            l.employers_on_file, l.sponsor_token_candidate, l.employer_sources,
            lcc_owner_domain_core(l.owner_name) AS owner_core,
            regexp_replace(lower(split_part(l.domain, '.'::text, 1)), '[^a-z0-9]'::text, ''::text, 'g'::text) AS domain_sld
           FROM v_lcc_tier0_owner_contact_lane l
          WHERE l.n_eligible > 0 AND NOT (EXISTS ( SELECT 1 FROM owner_contact_pivot pv
                  WHERE pv.entity_id = l.owner_id AND pv.active_contact_entity_id IS NOT NULL AND (COALESCE(pv.active_source, ''::text) <> ALL (ARRAY['tier0_confirm'::text, 'tier0_auto'::text])))) AND NOT (EXISTS ( SELECT 1 FROM lcc_tier0_confirm_log cl
                  WHERE cl.owner_entity_id = l.owner_id AND cl.domain = l.domain AND cl.reverted_at IS NULL))
        ), classed AS (
         SELECT b.*,
                CASE
                    WHEN b.domain_sld = b.owner_core THEN 'exact'::text
                    WHEN b.owner_core ~~ (b.domain_sld || '%'::text) AND length(b.domain_sld) >= 6 THEN 'domain_is_core_prefix'::text
                    WHEN b.domain_sld ~~ (b.owner_core || '%'::text) AND length(b.owner_core) >= 6 THEN 'core_is_domain_prefix'::text
                    WHEN 'sponsor_map'::text = ANY (string_to_array(b.match_arms, '+'::text)) THEN 'curated_sponsor'::text
                    ELSE 'weak_partial'::text
                END AS match_strength
           FROM base b
        ), decided AS (
         SELECT c.*,
                CASE
                    WHEN c.match_strength = 'exact'::text AND c.n_eligible = 1 THEN 'auto'::text
                    WHEN c.match_strength = ANY (ARRAY['exact'::text, 'domain_is_core_prefix'::text, 'core_is_domain_prefix'::text, 'curated_sponsor'::text]) THEN 'ask'::text
                    WHEN c.n_link_evidence > 0 THEN 'ask'::text
                    ELSE 'parked_domain_only'::text
                END AS decidability
           FROM classed c
        )
 SELECT owner_id, owner_name, owner_rent, domain, n_candidates, n_eligible, n_excluded,
    owner_already_has_contact, n_link_evidence, n_person_evidence, n_already_linked,
    match_arms, match_keys, people, owner_workspace_id, owner_domain_cards, rank_value,
    owner_core, domain_sld, match_strength, decidability,
        CASE WHEN decidability <> 'parked_domain_only'::text THEN NULL::text
             WHEN n_employer_on_file = 0 THEN 'no_employer_on_file'::text
             WHEN n_employer_comparable = 0 THEN 'employer_not_comparable'::text
             ELSE 'employer_on_file_differs'::text END AS park_reason,
        CASE WHEN decidability = 'parked_domain_only'::text THEN array_to_string(employers_on_file, ' | '::text) ELSE NULL::text END AS park_employer_on_file,
        CASE WHEN decidability = 'parked_domain_only'::text THEN owner_name ELSE NULL::text END AS park_owner_compared,
    n_employer_on_file, n_employer_comparable, employers_on_file, sponsor_token_candidate,
    decidability = 'parked_domain_only'::text AND sponsor_token_candidate IS NOT NULL AS sponsor_shaped,
        CASE WHEN decidability = 'parked_domain_only'::text THEN array_to_string(employer_sources, ' | '::text) ELSE NULL::text END AS park_employer_source,
    employer_sources
   FROM decided;

-- ---------------------------------------------------------------------------
-- 6. v_lcc_tier0_park_watch -- carried WHOLE, appending park_employer_source.
-- ---------------------------------------------------------------------------
create or replace view public.v_lcc_tier0_park_watch as
 SELECT owner_id, owner_name, domain, owner_rent, match_strength, n_eligible, n_link_evidence,
    n_person_evidence, n_person_evidence > 0 AS person_evidence_already_landed,
    match_arms, match_keys,
        CASE WHEN n_link_evidence > 0 THEN 'already_unparked'::text
             ELSE ('a candidate''s contact_company must match this OWNER, '::text || 'OR a lcc_owner_sponsor_domain row must confirm the domain, '::text) || 'OR a new candidate at this domain must arrive carrying a matching company'::text END AS unpark_requires,
    n_person_evidence > 0 AS evidence_arrived_but_did_not_unpark,
    park_reason, park_employer_on_file, park_owner_compared, sponsor_shaped, sponsor_token_candidate,
    park_employer_source
   FROM v_lcc_tier0_owner_contact_lane_triage t
  WHERE decidability = 'parked_domain_only'::text;

-- ---------------------------------------------------------------------------
-- 7. v_lcc_tier0_owner_contact_lane_open -- carried WHOLE, appending
--    employer_sources so an ASK card (not just a parked one) can show the operator
--    which register its employer came from.
-- ---------------------------------------------------------------------------
create or replace view public.v_lcc_tier0_owner_contact_lane_open as
 SELECT owner_id, owner_name, owner_rent, domain, n_candidates, n_eligible, n_excluded,
    owner_already_has_contact, n_link_evidence, n_person_evidence, n_already_linked,
    match_arms, match_keys, people, owner_workspace_id, owner_domain_cards, rank_value,
    owner_core, domain_sld, match_strength, decidability,
    employer_sources
   FROM v_lcc_tier0_owner_contact_lane_triage
  WHERE decidability = ANY (ARRAY['ask'::text, 'auto'::text]);
