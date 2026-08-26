-- P187 — Tier 0 matching: see the owners the rule was structurally blind to.
--
-- PROBLEM (measured P186 §6): ~51 people at 9 owners worth $358M were already in `entities` and
-- invisible to Tier 0 — Boyd Watterson ($179.8M, the largest owner in the system), RMR's CEO
-- Adam Portnoy, Realty Income's CEO Sumit Roy. Three causes, all in the ELIGIBILITY test:
--   1. `length(token) >= 5` yields ZERO tokens for NGP, RMR, TIAA, USAA, GI, HPI, AVG.
--   2. prefix-only matching: `watterson` cannot match `boydwatterson`.
--   3. the stoplist can consume the whole name: "Realty Income Corporation" -> zero tokens.
--
-- ============================================================================
-- PART 1 — lcc_owner_domain_core(): an UNSORTED, order-preserving, compacted core
-- ============================================================================
-- ⚠️ `lcc_owner_strict_core` CANNOT be used for domain matching because it SORTS its tokens:
--    'Boyd Watterson Asset Management, LLC' -> 'asset boyd management watterson'
--                                           -> 'assetboydmanagementwatterson'
--    which does not contain 'boydwatterson'. CLAUDE.md warns about this for acronym initials;
--    it applies to domain matching identically. Verified 11/11 on named rows.
-- Only a LEADING 'the' is dropped ("The Claremont Group" -> claremontgroup); 'of'/'and' are kept
-- inline, because dropping them would break a prefix test on names like "Bank of America".

create or replace function public.lcc_owner_domain_core(p_name text)
 returns text language sql immutable set search_path to 'public','pg_temp' as $function$
  select coalesce((
    select string_agg(tok,'' order by ord)
    from (
      select tok, ord
      from unnest(string_to_array(
             btrim(regexp_replace(regexp_replace(regexp_replace(
               lower(coalesce(p_name,'')), '&',' and ','g'),
               '[^a-z0-9]+',' ','g'), '\s+',' ','g')), ' ')) with ordinality as u(tok, ord)
      where tok <> ''
        and tok not in ('llc','llp','lp','inc','incorporated','corp','corporation',
                        'ltd','limited','trust','reit','dst','lllp','lc','pllc')
        and not (ord = 1 and tok = 'the')
    ) z), '');
$function$;

comment on function public.lcc_owner_domain_core(text) is
  'Owner name reduced to a compacted, ORDER-PRESERVING core for email-domain matching. '
  'Deliberately NOT lcc_owner_strict_core, which sorts its tokens alphabetically and therefore '
  'destroys every prefix relationship a domain match depends on. Identity-grade name comparison '
  'still belongs to lcc_owner_strict_core; this is for domain prefix matching only.';

-- ============================================================================
-- PART 2 — the Tier 0 view: add the core arm, widen the stoplists
-- ============================================================================
-- ARM 1 (existing, retained): a distinctive >=5-char token of the owner name prefix-matches the
--   person's email second-level domain. Good recall, weak precision.
-- ARM 2 (NEW): the first EIGHT characters of the owner's compacted core equal the first eight of
--   the normalized SLD, gated on that 8-char prefix matching at most 2 distinct domains fleet-wide.
--
--   `LCP >= 8` is expressed as `left(core,8) = left(sld,8)` — an equality join, so it is
--   hashable and costs nothing, rather than a per-row prefix function.
--
--   Measured: Arm 2 adds 133 pairs and gives 21 owners a first-ever bench ($268M). All 21 read
--   individually: 16 clearly correct (Boyd Watterson, TIAA-CREF, RMR incl. Adam Portnoy, AVG,
--   GI Partners, Realty Income incl. Sumit Roy, Cole Capital, SF Realty, FEM, Omni, REVA,
--   JC Capital, General Realty, MMI, Core Equity, Four Cities).
--
--   ⚠️ THE FIVE THAT WERE WRONG ALL SHARED ONE PROPERTY: a GENERIC 8-char opening.
--     'american' -> 10 unrelated domains (americansleepdentistry.com!), 'national' -> 4,
--     'netlease' -> 3, 'healthca' -> 4. Hence the fan-out gate, which is the THIRD time in this
--     work that fan-out on the matching key was the answer. Durable rule: ANY prefix or
--     containment matcher needs a fan-out gate on whatever key it matches.
--
--   KNOWN RESIDUE, stated rather than hidden: 'southern' has fan-out exactly 2, so
--   "Southern SSA Limited Liability Company" ($0.9M) still matches southern-agency.com and
--   southerntraditionrealestate.com. One wrong owner in 17. It is a confirm-lane reject, not a
--   silent write.
--
-- ⚠️ ARM 3 (acronym matching) WAS BUILT, MEASURED AND REJECTED — do not rebuild it.
--   The design was "a 3-4 char token that is ALL-CAPS in the original name is an acronym".
--   **27.6% of owner names (212 of 769) are ENTIRELY uppercase**, because that is the naming
--   convention for government SPE records. So the test identifies the CONVENTION, not an
--   acronym, and every ordinary word in those names reads as one. Live output included:
--     "BOYD DEL RIO GSA LLC"        -> tok 'del'  -> dell.com          (Dell, the computer company)
--     "1445 ROSS AVE LLC"           -> tok 'ave'  -> avera.org         (a health system)
--     "MAIN THEATER PLACE, L.P."    -> tok 'main' -> maine.rr.com
--     "EGP DEA VISTA LLC"           -> tok 'dea'  -> de-az.com         (DEA is the TENANT agency)
--     "USGP II LITTLE ROCK FBI LP"  -> tok 'rock' -> rockys.com
--   Precision ~30-40%. This is playbook Class 4 (a guard that checks the label, not the
--   substance). Fan-out does not rescue it — each wrong domain is the only one matching.
--   The real value was concentrated in ~6 sponsor acronyms (NGP->ngpv.com, UIRC->uirc.com,
--   HPI->hpitx.com, JBG->jbg.com, FCP->fcpdc.com, TMG->tmgdc.com); a small CURATED sponsor->domain
--   map is the honest way to capture those, and it needs Scott's confirmation per entry.
--   NGP alone is $59.8M plus ~$26M across 10 SPE variants.
--
-- STOPLIST WIDENING (both measured in P186 §5):
--   * geography — omaha->omahavaccine.com, denver->denverrealestate.com, worth (Fort Worth)
--     ->worthsa.com. Deliberately a SHORT CURATED list, not every city in the portfolio: a
--     blanket city stoplist would delete "Franklin Street Properties", "Madison", "Jackson" and
--     other real firm names. Owners genuinely named for a place are still reachable via Arm 2.
--   * generic CRE nouns — 'tenant' (999 E STREET TENANT LLC -> tenantwisdom.com),
--     'developers' (Metro Developers -> developerservices.com), plus the high-fan-out words
--     measured earlier (urban, gateway, office, river, ...).
--   * consumer ISP domains — 'hawaii.rr.com' matched EAGLE RIVER INVESTORS - HAWAII. The
--     free-mail list only tested equality, so a subdomain of an ISP slipped through; this adds a
--     SUFFIX test.
--
-- Column list, order and types are unchanged (CREATE OR REPLACE VIEW is append-only for columns).
--
-- ============================================================================
-- MEASURED RESULT (live, 2026-08-26)
-- ============================================================================
--   pairs   2,314 -> 558      owners with a bench   346 -> 208
--   empty bench >=$5M   41 -> 44 owners, but $902M -> $738M of rent
--
-- ⚠️ THE EMPTY-BENCH COUNT WENT UP AND THAT IS AN IMPROVEMENT. All 10 owners that newly read
--    "empty" had benches that were 100% false positives -- 810 SEVENTH AVENUE SPE -> avenueview,
--    MEPT/FCP PATRIOTS PLAZA -> plazacorp, CIM URBAN -> 17 urban* domains, Office Properties
--    Income Trust -> officecourt, Hgit 1015 Half Street -> streetviewllc, 999 E STREET TENANT ->
--    tenantwisdom, Metro Developers -> developerservices, USGBF ... Denver -> denverrealestate,
--    Brooklyn Renaissance Plaza -> plazacorp, NGP VI PHOENIX -> phoenix*. The old
--    "owners with a bench" figure was inflated by noise; the new one is honest. **A count that
--    gets worse when precision improves was measuring the wrong thing.**
--
-- HEADLINE WINS NOW VISIBLE: Boyd Watterson ($179.8M) 2 people, RMR Group 20 incl. Adam Portnoy,
-- Realty Income 12 incl. Sumit Roy, TIAA-CREF, GI Partners, AVG Partners, Cole Capital.
--
-- ⚠️ PRECISION IS RENT-DEPENDENT -- report it as a curve, not a number. Top 45 pairs by rent:
--    ~91% correct (was 76-80% pre-P187). Extending the read down to the ~$2M SPE band it falls
--    to roughly 60-70%: single-property SPE names ("NGP VI ESSEX VT LLC" -> essexconcrete.org,
--    "Ngp V Ogden Ut LLC" -> ogdenre.com, "Boyd Atlanta Williams" -> williamson.com) carry a
--    place or surname and little else. **The confirm lane must be worked top-down**, and a
--    single precision figure quoted without its rent band is misleading.
--
-- KNOWN RESIDUE, recorded rather than patched:
--   * "George Washington University" -> georgesinc.com (a poultry company) still matches: the
--     token 'george' has fan-out 1 and is shared by only 2 owners, so no fan-out gate can see it.
--   * 'southern' has fan-out exactly 2, so "Southern SSA LLC" keeps two wrong matches.
--   * ONE CMBS securitization trust is in scope ("JP Morgan Chase Commercial Mortgage Securities
--     Trust 2018PTC...", $2.38M) and contributes 6 wrong pairs. A securitization vehicle is not a
--     prospectable owner -- but it is exactly ONE row, and a rule matching one row will later be
--     trusted as general. Left for the confirm lane; revisit if more appear.

create or replace view v_lcc_tier0_owner_contact_candidates as
with owner_rent as (
  select f.entity_id, coalesce(sum(f.annual_rent) filter (where f.is_current),0)::numeric as owner_rent
  from lcc_entity_portfolio_facts f group by f.entity_id
),
owners as (
  select distinct po.owner_entity_id as owner_id, e.name as owner_name,
         coalesce(r.owner_rent,0)::numeric as owner_rent,
         lcc_owner_domain_core(e.name) as core
  from lcc_property_owner po
  join entities e on e.id = po.owner_entity_id
  left join owner_rent r on r.entity_id = po.owner_entity_id
  where e.merged_into_entity_id is null and e.entity_type = 'organization'::entity_type
    and coalesce(r.owner_rent,0) >= 500000::numeric
    and not lcc_owner_name_is_public_body(e.name)
),
owner_tok as (
  select o.owner_id, o.owner_name, o.owner_rent, t.t as tok
  from owners o
  cross join lateral unnest(
    regexp_split_to_array(lower(regexp_replace(o.owner_name,'[^a-zA-Z ]','','g')),'\s+')) t(t)
  where length(t.t) >= 5
    and t.t <> all (array[
      -- legal / structural
      'trust','group','holdings','properties','partners','capital','company','realty',
      'investors','management','development','associates','incorporated','limited',
      'national','american','government','property','asset','assets','income','equity',
      'equities','commercial','residential','industrial','venture','ventures','enterprise',
      'enterprises','financial','finance','realestate','services','solutions','systems',
      'corporation','partnership','premier','first','second','third','general','united','global',
      -- directional / generic descriptors
      'western','eastern','northern','southern','pacific','atlantic','central',
      -- P187: generic CRE / address nouns measured as error sources
      'tenant','tenants','developer','developers','office','offices','urban','gateway',
      'street','avenue','building','buildings','center','centre','plaza','tower','towers',
      'place','court','square','station','village','ridge','creek','valley','lakes','river',
      'point','pointe','heights','hills','springs','grove','woods','meadows','landing',
      'crossing','commons','terrace','harbor','island','beach','bridge','summit','estates',
      'campus','market','metro','brook','stone','columbia','century','north','south','america',
      -- P187: geography (SHORT, CURATED — not every city; see header)
      'omaha','denver','dallas','houston','phoenix','austin','seattle','portland','atlanta',
      'boston','chicago','detroit','orlando','tampa','tucson','wichita','spokane','fresno',
      'tulsa','hawaii','alaska','nevada','arizona','indiana','kansas','oregon','montana',
      'dakota','nebraska','oklahoma','missouri','michigan','wisconsin','minnesota','colorado',
      'virginia','carolina','tennessee','kentucky','alabama','mississippi','louisiana',
      'arkansas','delaware','maryland','florida','georgia','worth'
    ])
),
people as (
  select e.id as person_id, e.name as person_name, e.email, e.phone,
         lower(split_part(split_part(e.email,'@',2),'.',1)) as sld,
         regexp_replace(lower(split_part(split_part(e.email,'@',2),'.',1)),'[^a-z0-9]','','g') as sldn,
         lower(split_part(e.email,'@',2)) as domain
  from entities e
  where e.entity_type = 'person'::entity_type
    and e.merged_into_entity_id is null
    and e.email like '%@%'
    and lower(split_part(e.email,'@',2)) <> all (array[
      'gmail.com','yahoo.com','hotmail.com','outlook.com','aol.com','icloud.com','me.com',
      'live.com','msn.com','protonmail.com','mail.com','comcast.net','att.net','verizon.net'])
    -- P187: consumer ISP SUFFIXES (equality alone missed 'hawaii.rr.com')
    and lower(split_part(e.email,'@',2)) !~
        '(^|\.)(rr\.com|sbcglobal\.net|bellsouth\.net|cox\.net|charter\.net|earthlink\.net|optonline\.net|windstream\.net|roadrunner\.com|juno\.com|netzero\.net|mac\.com|frontier\.com)$'
),
person_prefix as (
  select p.person_id, left(p.sld,k) as pfx from people p
  cross join lateral generate_series(5, length(p.sld)) as k
),
-- FAN-OUT GATES. Measured three separate times in this work; each time it was the answer.
-- A key (token, or 8-char prefix) that matches many distinct domains identifies none of them,
-- and a key shared by many owners identifies none of them either.
--
-- ⚠️ ARM 1 HAD NO FAN-OUT GATE UNTIL NOW. P186 measured the gate and reported its effect, but
-- only ever applied it in analysis queries -- it was never shipped into the view. That is why
-- `johnsonlexus.com` (a car dealership) was still matching "Allan Bailey Johnson Group" after
-- P186. **Measuring a gate is not shipping a gate.**
tok_fan as (
  select ot.tok, count(distinct p.sld) as dd, count(distinct ot.owner_id) as od
  from owner_tok ot join people p on p.sld like ot.tok||'%'
  group by ot.tok
),
pfx_fan as (
  select left(sldn,8) as p8, count(distinct sldn) as dd
  from people where length(sldn) >= 8 group by 1
),
matched as (
  -- ARM 1: distinctive token prefix-matches the domain, fan-out gated
  select distinct ot.owner_id, pp.person_id
  from owner_tok ot
  join tok_fan tf on tf.tok = ot.tok and tf.dd <= 2 and tf.od <= 2
  join person_prefix pp on pp.pfx = ot.tok
  union
  -- ARM 2: 8-char core/domain prefix equality, fan-out gated
  select distinct o.owner_id, p.person_id
  from owners o
  join people p on length(o.core) >= 8 and length(p.sldn) >= 8
                and left(o.core,8) = left(p.sldn,8)
  join pfx_fan f on f.p8 = left(p.sldn,8) and f.dd <= 2
),
owner_has_contact as (
  select distinct pv.entity_id from owner_contact_pivot pv
  where pv.active_contact_entity_id is not null
),
rel_pair as (
  select from_entity_id as a, to_entity_id as b from entity_relationships
  union
  select to_entity_id, from_entity_id from entity_relationships
)
select o.owner_id, o.owner_name, o.owner_rent,
       p.person_id, p.person_name, p.email, p.domain,
       uc.title as contact_title, uc.company_name as contact_company,
       case
         when uc.title ~* '(acquisition|investment|capital market)' then 'acquisitions'
         when uc.title ~* '(disposition|asset manage|portfolio manage)' then 'disposition'
         when uc.title ~* '(broker|agent|realtor)' then 'broker'
         when uc.title ~* '(analyst|coordinator|assistant|coordinator|transaction|due diligence|escrow)' then 'transaction_support'
         when uc.title ~* '(president|principal|partner|owner|founder|ceo|managing director)' then 'principal'
         when uc.title is not null and uc.title <> '' then 'other_titled'
         else 'no_title'
       end as role_bucket,
       uc.outlook_contact_id is not null as from_outlook_sync,
       ohc.entity_id is not null         as owner_already_has_contact,
       rp.a is not null                  as already_linked
from matched m
join owners o                 on o.owner_id  = m.owner_id
join people p                 on p.person_id = m.person_id
left join unified_contacts uc on lower(uc.email) = lower(p.email)
left join owner_has_contact ohc on ohc.entity_id = o.owner_id
left join rel_pair rp on rp.a = o.owner_id and rp.b = p.person_id;
