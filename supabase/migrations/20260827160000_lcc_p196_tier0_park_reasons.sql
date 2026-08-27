-- P196 Unit 2 -- say WHY a Tier 0 card is parked, and route the sponsor-shaped ones.
--
-- N3e AS FILED IS WRONG, AND THE CORRECTION IS THE USEFUL PART. It reads "95 parked
-- cards are stuck permanently", which invites rescuing them. Re-measured 2026-08-27
-- over `v_lcc_tier0_owner_contact_lane_triage`:
--
--   parked_domain_only            146 cards / 105 owners / $180.3M
--     employer_on_file_differs     76 cards /  67 owners /  $96.3M   <- the gate WORKING
--     no_employer_on_file          68 cards /  56 owners / $132.3M
--     employer_not_comparable       2 cards /   2 owners /   $1.9M
--
-- The 67-owner / $96.3M `differs` slice is the population N3e is about. They are not
-- stuck by accident: a candidate's stated employer is on file and it is not this owner.
-- Mostly that is correct. What was missing is that the operator could not SEE it.
--
-- ⚠ A MEASURED REFUTATION OF ONE OF THE TWO PRESCRIBED FIXES. "Normalise the company
--   string before comparing (strip www, com, punctuation)" was implemented against the
--   live parked population and unparks **0 cards**. The motivating row does not survive
--   its own fix: `Savlan Cc Property LLC` has owner core `savlanccproperty` and
--   `WWW Savlancapital COM` normalises to `savlancapital` -- containment still fails and
--   the 8-char prefix arm compares `savlancc` against `savlanca`. The mismatch is at
--   character 8, not in the www/com noise. So the comparator is NOT changed here; the
--   Savlan row is a SPONSOR-shaped park and is routed as one below.
--
-- ⚠ AND THE MEASUREMENT THAT PRODUCED N3e WAS READ OFF THE WRONG JSON KEY. The card's
--   people[] element carries the employer as `company`, not `contact_company`; reading
--   `contact_company` returns "100% of parked candidates have no employer on file".
--   Corrected: 107 of 201 eligible parked candidates (53.2%) DO carry one. When two
--   measurements of the same thing disagree, check the key names before believing
--   either (playbook Class 11 -- the zero is the instrument).
--
-- ⚠ THE DECIDABILITY CASE IS NOT WIDENED TO ADMIT PERSON EVIDENCE. That was measured
--   and rejected in P188/P192: Gary George at georgesinc.com (a poultry company) passes
--   three of the four person signals for George Washington University. Nothing here
--   changes what is `ask`, `auto` or `parked_domain_only`.
--
-- WHAT SHIPS
--   1. `park_reason` + both compared strings, on the triage view and on
--      v_lcc_tier0_park_watch. Three reasons, and the third is named for what it IS:
--      `employer_not_comparable` means the comparator's 6-char floor could not even
--      run, which is a different fact from "the employer differs".
--   2. `lcc_tier0_sponsor_brand_token` + `v_lcc_tier0_sponsor_map_proposals` -- the
--      sponsor-shaped subset, as proposals for `lcc_owner_sponsor_domain` (the P190/P193
--      curated table, 4 rows, hand-confirmed). ONE decision covers an SPE family.
--
-- ⚠ THE SPONSOR DETECTOR'S PRECISION IS MEASURED, NOT ASSUMED, AND IT IS NOT HIGH.
--   Leading-brand-token equality alone over the parked population returns 19 pairs and
--   reads ~25% precision -- dominated by PERSON GIVEN NAMES (George Kurz <- George's
--   Inc; Steve Blumer <- Steve Eustis Co; two JAMES trusts <- a shared CPA at
--   jameshowardcpa.com, the grouping P189 already named) and PLACE/NATURE words (MAPLE
--   HILL <- Mapletree Investments, a Singapore REIT; Steel Station Rd <- Steel
--   Equities). That is the same 25% P189 measured and rejected for domain-keyed merge
--   grouping. Three guards, each earning its place on named rows:
--     * the owner name must carry a PORTFOLIO/SPE marker (property/properties/holdings/
--       owner/propco/holdco/fund) -- a sponsor's SPE says what it is;
--     * the owner name must not read as a STREET (drops `Steel Station Rd, LLC`);
--     * the owner must not be person-shaped (drops George Kurz, Steve Blumer).
--   Result: 6 proposals, of which 4 read as genuine on named rows -- and the 4 are the
--   TOP 4 BY RENT ($8.0M Gardner Tanenbaum <- Gardner Companies, $5.3M Salus, $2.5M
--   Oxford, $2.0M Savlan), with the 2 false ones at $1.26M and $0.84M. The view is
--   value-ranked, so the operator meets the reliable end first -- the same shape as the
--   Tier 0 rent-band precision curve.
--   Stated gaps, not patched: `lcc_looks_like_person` calls `Genesis Kc Dev` a person,
--   so a plausible proposal is dropped (a false negative costs one missed card; a false
--   positive writes a stranger's firm onto an SPE family); and
--   `lcc_owner_name_is_brokerage` does not catch `Wilson Kibler Commercial Real Estate`,
--   which the SPE-marker guard drops for a different reason.
--
-- NOTHING HERE WRITES. Confirming a proposal is the existing curated INSERT into
-- lcc_owner_sponsor_domain, which Scott already does by hand (fcp->fcpdc.com and
-- tmg->tmgdc.com are the two currently held). A confirmed row moves every SPE in the
-- family to match_strength='curated_sponsor', i.e. decidability='ask'.

-- ---------------------------------------------------------------------------
-- 1. The brand token. NARROW and scoped to this gate (the
--    lcc_p131_is_document_row_label precedent) -- never reuse it as a general
--    name comparator, and never let it drive a write.
-- ---------------------------------------------------------------------------
create or replace function public.lcc_tier0_brand_token(p_name text)
returns text
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$
  select u.t
    from unnest(string_to_array(
           btrim(regexp_replace(regexp_replace(
             lower(coalesce(p_name,'')), '[^a-z0-9]+', ' ', 'g'), '\s+', ' ', 'g')), ' '))
         with ordinality u(t, o)
   where u.t not in ('the','www','http','https')
   order by u.o
   limit 1;
$$;

comment on function public.lcc_tier0_brand_token(text) is
  'P196 Tier 0 sponsor gate ONLY: the leading brand token of a name. Not an identity comparator.';

create or replace function public.lcc_tier0_sponsor_brand_token(p_owner_name text, p_company text)
returns text
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select case
    when o is null or c is null then null
    when length(o) < 5 or length(c) < 5 then null
    -- the SPE and the operating company must share a leading brand token
    when not (o = c or left(c, length(o)) = o or left(o, length(c)) = c) then null
    -- a sponsor's SPE says what it is
    when p_owner_name !~* '\m(propert(y|ies)|holdings|owner|propco|holdco|fund)\M' then null
    -- a street name is not a brand ("Steel Station Rd, LLC" <- "Steel Equities")
    when p_owner_name ~* '\m(rd|road|st|street|ave|avenue|blvd|dr|drive|ln|lane|hwy|highway|pkwy|ct|way)\M' then null
    -- a shared GIVEN NAME is the dominant false positive (George Kurz <- George's Inc)
    when public.lcc_looks_like_person(p_owner_name) then null
    -- a brokerage is the agent, never the principal
    when public.lcc_owner_name_is_brokerage(p_company) then null
    else o
  end
  from (select public.lcc_tier0_brand_token(p_owner_name) o,
               public.lcc_tier0_brand_token(p_company)    c) z;
$$;

comment on function public.lcc_tier0_sponsor_brand_token(text,text) is
  'P196: the shared sponsor brand token when a parked Tier 0 candidate''s employer looks like the SPE owner''s sponsor, else NULL. ~4 of 6 on named rows -- a PROPOSAL gate for lcc_owner_sponsor_domain, never a write gate.';

-- ---------------------------------------------------------------------------
-- 2. The lane view -- WHOLE body carried here (P194). Four columns appended at the
--    END: how many eligible candidates carry an employer at all, how many carry one
--    the comparator can even evaluate, the employer strings themselves, and the
--    sponsor token if one is shared.
-- ---------------------------------------------------------------------------
create or replace view public.v_lcc_tier0_owner_contact_lane as
 WITH c AS (
         SELECT v.owner_id, v.owner_name, v.owner_rent, v.person_id, v.person_name, v.email,
            v.domain, v.contact_title, v.contact_company, v.role_bucket, v.from_outlook_sync,
            v.owner_already_has_contact, v.already_linked, v.match_arm, v.match_key
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
            e_1.match_arm, e_1.match_key, e_1.owner_core, e_1.company_core, e_1.sldn,
            e_1.ev_sf_contact, e_1.ev_outlook, e_1.ev_correspondence, e_1.last_email_date,
            e_1.n_campaigns, e_1.campaign_names, e_1.is_broker, e_1.name_rejected,
            e_1.name_person_shaped,
            e_1.n_campaigns > 0 AS ev_sf_campaign,
            length(e_1.company_core) >= 5 AND length(e_1.sldn) >= 5 AND (POSITION((e_1.company_core) IN (e_1.sldn)) > 0 OR POSITION((e_1.sldn) IN (e_1.company_core)) > 0) AS ev_company_confirms_employer,
            length(e_1.company_core) >= 6 AND length(e_1.owner_core) >= 6 AND (POSITION((e_1.company_core) IN (e_1.owner_core)) > 0 OR POSITION((e_1.owner_core) IN (e_1.company_core)) > 0 OR length(e_1.company_core) >= 8 AND length(e_1.owner_core) >= 8 AND "left"(e_1.company_core, 8) = "left"(e_1.owner_core, 8)) AS ev_company_matches_owner,
            -- P196: the comparator above has a 6-char floor on BOTH sides. When it
            -- cannot run, "the employer differs" is not what happened.
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
         SELECT s.owner_id, s.owner_name,
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
            jsonb_agg(jsonb_build_object('person_id', s.person_id, 'person_name', s.person_name, 'email', s.email, 'title', s.contact_title, 'company', s.contact_company, 'role_bucket', s.role_bucket, 'match_arm', s.match_arm, 'match_key', s.match_key, 'eligible', s.eligible, 'block_reason', s.block_reason, 'already_linked', s.already_linked, 'from_outlook_sync', s.from_outlook_sync, 'last_email_date', s.last_email_date, 'campaign_names', to_jsonb(COALESCE(s.campaign_names, ARRAY[]::text[])), 'evidence', jsonb_build_object('sf_campaign', s.ev_sf_campaign, 'sf_contact', s.ev_sf_contact, 'outlook', s.ev_outlook, 'correspondence', s.ev_correspondence, 'company_confirms_employer', s.ev_company_confirms_employer, 'company_matches_owner', s.ev_company_matches_owner)) ORDER BY s.eligible DESC, s.ev_company_matches_owner DESC, (s.role_bucket = ANY (ARRAY['acquisitions'::text, 'principal'::text])) DESC, s.person_name) AS people
           FROM scored s
          GROUP BY s.owner_id, s.owner_name, s.domain
        )
 SELECT g.owner_id,
    g.owner_name,
    g.owner_rent,
    g.domain,
    g.n_candidates,
    g.n_eligible,
    g.n_excluded,
    g.owner_already_has_contact,
    g.n_link_evidence,
    g.n_person_evidence,
    g.n_already_linked,
    g.match_arms,
    g.match_keys,
    g.people,
    e.workspace_id AS owner_workspace_id,
    count(*) OVER (PARTITION BY g.owner_id)::integer AS owner_domain_cards,
    g.owner_rent AS rank_value,
    g.n_employer_on_file,
    g.n_employer_comparable,
    g.employers_on_file,
    g.sponsor_token_candidate
   FROM grouped g
     LEFT JOIN entities e ON e.id = g.owner_id;

-- ---------------------------------------------------------------------------
-- 3. The triage view -- WHOLE body carried here (P194). The decidability CASE is
--    UNCHANGED; park_reason and the two compared strings are appended after it.
--    The SQL CASE stays the single owner of both classifications (the A1 rule: a JS
--    mirror of a SQL classifier is the normaliser drift this repo keeps warning about).
-- ---------------------------------------------------------------------------
create or replace view public.v_lcc_tier0_owner_contact_lane_triage as
 WITH base AS (
         SELECT l.owner_id, l.owner_name, l.owner_rent, l.domain, l.n_candidates, l.n_eligible,
            l.n_excluded, l.owner_already_has_contact, l.n_link_evidence, l.n_person_evidence,
            l.n_already_linked, l.match_arms, l.match_keys, l.people, l.owner_workspace_id,
            l.owner_domain_cards, l.rank_value,
            l.n_employer_on_file, l.n_employer_comparable, l.employers_on_file, l.sponsor_token_candidate,
            lcc_owner_domain_core(l.owner_name) AS owner_core,
            regexp_replace(lower(split_part(l.domain, '.'::text, 1)), '[^a-z0-9]'::text, ''::text, 'g'::text) AS domain_sld
           FROM v_lcc_tier0_owner_contact_lane l
          WHERE l.n_eligible > 0 AND NOT (EXISTS ( SELECT 1
                   FROM owner_contact_pivot pv
                  WHERE pv.entity_id = l.owner_id AND pv.active_contact_entity_id IS NOT NULL AND (COALESCE(pv.active_source, ''::text) <> ALL (ARRAY['tier0_confirm'::text, 'tier0_auto'::text])))) AND NOT (EXISTS ( SELECT 1
                   FROM lcc_tier0_confirm_log cl
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
 SELECT owner_id,
    owner_name,
    owner_rent,
    domain,
    n_candidates,
    n_eligible,
    n_excluded,
    owner_already_has_contact,
    n_link_evidence,
    n_person_evidence,
    n_already_linked,
    match_arms,
    match_keys,
    people,
    owner_workspace_id,
    owner_domain_cards,
    rank_value,
    owner_core,
    domain_sld,
    match_strength,
    decidability,
    -- P196: WHY this card is parked. NULL for a card that is not parked -- a reason
    -- on an actionable card would read as a blocker that is not there.
    CASE
        WHEN decidability <> 'parked_domain_only'::text THEN NULL::text
        WHEN n_employer_on_file = 0 THEN 'no_employer_on_file'::text
        WHEN n_employer_comparable = 0 THEN 'employer_not_comparable'::text
        ELSE 'employer_on_file_differs'::text
    END AS park_reason,
    -- both strings, so the operator can resolve it by reading rather than digging
    CASE WHEN decidability = 'parked_domain_only'::text
         THEN array_to_string(employers_on_file, ' | ') END AS park_employer_on_file,
    CASE WHEN decidability = 'parked_domain_only'::text THEN owner_name END AS park_owner_compared,
    n_employer_on_file,
    n_employer_comparable,
    employers_on_file,
    sponsor_token_candidate,
    (decidability = 'parked_domain_only'::text AND sponsor_token_candidate IS NOT NULL) AS sponsor_shaped
   FROM decided;

comment on view public.v_lcc_tier0_owner_contact_lane_triage is
  'Tier 0 triage. P196 appended park_reason (no_employer_on_file | employer_not_comparable | employer_on_file_differs, NULL when not parked), the two compared strings, and the sponsor-shaped flag. The decidability CASE is UNCHANGED -- person evidence still does not un-park (P188 Gary George).';

-- ---------------------------------------------------------------------------
-- 4. The park instrument, now carrying the reason.
-- ---------------------------------------------------------------------------
create or replace view public.v_lcc_tier0_park_watch as
 SELECT owner_id,
    owner_name,
    domain,
    owner_rent,
    match_strength,
    n_eligible,
    n_link_evidence,
    n_person_evidence,
    n_person_evidence > 0 AS person_evidence_already_landed,
    match_arms,
    match_keys,
        CASE
            WHEN n_link_evidence > 0 THEN 'already_unparked'::text
            ELSE ('a candidate''s contact_company must match this OWNER, '::text || 'OR a lcc_owner_sponsor_domain row must confirm the domain, '::text) || 'OR a new candidate at this domain must arrive carrying a matching company'::text
        END AS unpark_requires,
    n_person_evidence > 0 AS evidence_arrived_but_did_not_unpark,
    park_reason,
    park_employer_on_file,
    park_owner_compared,
    sponsor_shaped,
    sponsor_token_candidate
   FROM v_lcc_tier0_owner_contact_lane_triage t
  WHERE decidability = 'parked_domain_only'::text;

comment on view public.v_lcc_tier0_park_watch is
  'P194/P196: every parked Tier 0 card with the REASON it is parked and both compared strings. Read park_reason before treating a park as a defect -- employer_on_file_differs is the gate working.';

-- ---------------------------------------------------------------------------
-- 5. The sponsor-shaped subset, as proposals for the curated lcc_owner_sponsor_domain.
--    ONE row per (sponsor_token, email_domain) -- one decision covering an SPE family,
--    not N per-SPE questions. Value-ranked: measured precision is ~4 of 6 and the 4
--    true ones are the top 4 by rent.
-- ---------------------------------------------------------------------------
create or replace view public.v_lcc_tier0_sponsor_map_proposals as
select t.sponsor_token_candidate                          as proposed_sponsor_token,
       t.domain                                           as proposed_email_domain,
       count(*)::integer                                  as parked_cards,
       count(distinct t.owner_id)::integer                as spe_entities,
       sum(t.owner_rent)                                  as combined_annual_rent,
       max(t.owner_rent)                                  as top_owner_rent,
       string_agg(distinct t.owner_name, ' | ')           as spe_names,
       string_agg(distinct t.park_employer_on_file, ' | ') as employers_on_file,
       array_agg(distinct t.owner_id)                     as spe_entity_ids,
       exists (select 1 from public.lcc_owner_sponsor_domain sd
                where sd.sponsor_token = t.sponsor_token_candidate
                  and sd.email_domain  = t.domain)        as already_confirmed
  from public.v_lcc_tier0_owner_contact_lane_triage t
 where t.sponsor_shaped
 group by t.sponsor_token_candidate, t.domain;

comment on view public.v_lcc_tier0_sponsor_map_proposals is
  'P196: parked Tier 0 cards whose candidate employer looks like the SPE owner''s SPONSOR. Confirm by INSERT INTO lcc_owner_sponsor_domain(sponsor_token, email_domain, confirmed_by, notes) -- that moves the whole family to match_strength=curated_sponsor (decidability=ask). Measured ~4 of 6 correct on named rows, value-ranked; NOTHING here writes.';

grant select on public.v_lcc_tier0_park_watch             to service_role, authenticated;
grant select on public.v_lcc_tier0_sponsor_map_proposals  to service_role, authenticated;
