-- ============================================================================
-- P147 / P148 / P148a / P148b — an individual CAN own; and three more classes of
-- organisation were filed as people.
-- Applied live to LCC Opps (xengecqvemvfknjvbvrq) 2026-08-19.
-- lcc_property_owner 3,920 -> 4,053. person_shaped_winner 52 -> 14.
-- purchase_tier_no_org_marker 106 -> 11.
-- ----------------------------------------------------------------------------
-- THE DOCTRINE, from Scott, which is what unblocked this:
--   "a person can be an owner in the LCC if they are the individual in control
--    of the ownership of the LLC or SPE. We often have true companies and true
--    contacts that are the same name and name of an individual."
--
-- lcc_supersede_property_owner had always required owner_entity_type =
-- 'organization'. That guard exists for a real reason -- the TrafficMetrix
-- misparse minted street names and column headers as PERSON entities -- but it
-- also blocked every genuine individual owner, and this book has many.
--
-- ── P147: more org-marker gaps, found by reading the person lane ──────────────
--   Broadstone Real Estate       ("estates" was listed, "real estate" was not)
--   Elman Investors Columbia     ("investments" listed, "investors" not)
--   NorthWall Builders           ("developers" listed, "builders" not)
--   Inland Empire Health Plan · Heart Of Texas Region Mental Health
--   Kayne Anderson JV MBRE Healthcare
--   NASIM MIRZA REVOCABLE FAMILY T · Floyd Brown Living  (truncated trusts)
-- Added: investors · builders · realty · real estate · healthcare · health plan
--        · mental health · revocable · living · JV · family t
-- Gated 18/18 against the genuine individuals in the same lane.
--
-- ── P148: the guard becomes a CREDIBILITY test, not a type test ──────────────
-- A person may own when the name looks like a whole human name:
--   * >= 2 tokens
--   * final token >= 2 chars -- "Adel B", "Brenda G", "Lawrence W", "Rajesh H"
--     are TRUNCATED captures, not names (5 of 38)
--   * no digits, no street vocabulary -- the TrafficMetrix guard, RETAINED
--   * not a brokerage, not an agent, no org marker
--
-- ── P148a: my own two guards had drifted within the hour ─────────────────────
-- P146 excluded agents with
--     OBO | bk & tr | bank...trust | as trustee
-- P148 used only OBO | as trustee. So
--     "LASALLE BANK NA; AMERICAN NATIONAL BK & TR CO OF CHICAGO"
-- -- a trustee bank I had DELIBERATELY left in review one migration earlier --
-- came back as a credible PERSON in the dry run. Caught by reading the sample.
-- When two guards express the same intent they must share the predicate.
--
-- ── P148b: 36 cities and counties went in through the PERSON door ────────────
-- The credibility test had no municipal guard, so "City of Dallas", "County of
-- Riverside", "CITY OF SAN ANTONIO" and 33 more passed it and were written as
-- owners classified as PEOPLE. Caught by checking WHICH ARM each newly-resolved
-- row came through -- the headline "133 resolved" looked entirely healthy.
--
-- A municipality is an ORGANISATION, so it belongs in the org-marker test. The
-- 36 keep resolving, through the correct door, with a corrected entity_type
-- (31 retyped). Whether a municipality should be an owner AT ALL remains the
-- open business question -- this deliberately does NOT answer it by regex, which
-- is exactly what the person arm had just done by accident.
--
-- REVERSAL: drop the P147/P148b arms from lcc_owner_name_has_org_marker; drop
--   lcc_owner_name_is_credible_person and restore the plain
--   owner_entity_type='organization' guard; restore entity_type from
--   metadata.p147_prior_entity_type / p148b_prior_entity_type; and unwind rows
--   via lcc_owner_supersession_log batch 'p148_person_may_own_20260819'.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lcc_owner_name_has_org_marker(p_name text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  select coalesce(p_name,'') ~* '(\m(llc|l\.l\.c|inc|incorporated|corp|corporation|company|co|lp|llp|ltd|limited|trust|dst|reit|holdings|properties|property|partners|partnership|realty|capital|group|ventures|associates|enterprises|investments|investment|fund|bank|assn|association|church|center|centre|university|hospital|authority|district|management|equities|estates|development|developers)\M)'
      or coalesce(p_name,'') ~* '(\m(l\.p|l\.l\.p|p\.c|p\.a|s\.a|n\.a)\.?\M|\mco\.|\minc\.)'
      or coalesce(p_name,'') ~* '\m(investors|builders|realty|real estate|healthcare|health plan|mental health|revocable|living trust|living|JV|family t)\M'
      or coalesce(p_name,'') ~* '\m(city|county|town|village|borough|parish|municipal|school district|retirement system|tax collector|state of)\M'
      or coalesce(p_name,'') ~ '[0-9]';
$$;

CREATE OR REPLACE FUNCTION public.lcc_owner_name_is_credible_person(p_name text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  with n as (select btrim(coalesce(p_name,'')) nm)
  select nm <> ''
     and array_length(string_to_array(nm, ' '), 1) >= 2
     and length(regexp_replace(
           split_part(nm, ' ', array_length(string_to_array(nm,' '),1)),
           '[^A-Za-z]', '', 'g')) >= 2
     and nm !~ '[0-9]'
     and nm !~* '\m(st|street|ave|avenue|rd|road|blvd|boulevard|drive|dr|lane|ln|way|ct|court|pkwy|parkway|plaza|suite|ste|hwy|highway|circle|terrace|traffic|vol|collection)\M'
     and not public.lcc_owner_name_is_brokerage(nm)
     and nm !~* '\mOBO\M|\mas trustee\M|\mbk\s*&\s*tr\M|\mbank\M.*\mtr(ust)?\M'
     and not public.lcc_owner_name_has_org_marker(nm)
  from n;
$$;

COMMENT ON FUNCTION public.lcc_owner_name_is_credible_person(text) IS
  'P148/a/b. May this name stand as an INDIVIDUAL property owner? Scott: a '
  'person can own when they control the LLC/SPE. Requires a whole human name '
  '(>=2 tokens, final token >=2 chars, so truncated "Adel B" is refused), keeps '
  'the TrafficMetrix street-vocabulary misparse guard, shares P146''s AGENT '
  'predicate exactly, and defers anything with an org marker (incl. municipal) '
  'to the organisation path.';

-- Supersede: admit credible individuals alongside organisations.
CREATE OR REPLACE FUNCTION public.lcc_supersede_property_owner(
  p_dry_run boolean DEFAULT true, p_batch text DEFAULT NULL::text, p_limit integer DEFAULT NULL::integer)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_batch text := coalesce(p_batch, 'supersede_' || to_char(now(),'YYYYMMDD_HH24MI'));
  v_applied int := 0; v_sample jsonb; v_review jsonb;
begin
  create temporary table _sup_elig on commit drop as
  select c.entity_id, c.owner_entity_id, c.owner_name, c.tier, c.tier_source,
         c.win_date, c.runner_up_date,
         case when c.tier = 1 then 0.95
              when c.tier = 2 then 0.80
              when c.tier = 3 and (c.runner_up_date is null
                   or c.win_date - c.runner_up_date >= interval '180 days') then 0.75
              when c.tier = 3 then 0.65 else 0.60 end as confidence
    from public.v_lcc_owner_supersession_candidates c
   where c.is_unique
     and (c.owner_entity_type = 'organization'
          or public.lcc_owner_name_is_credible_person(c.owner_name))
     and coalesce(c.owner_name,'') <> ''
     and not public.lcc_owner_name_is_brokerage(c.owner_name)
     and (c.tier <> 3
          or public.lcc_owner_name_has_org_marker(c.owner_name)
          or public.lcc_owner_name_is_credible_person(c.owner_name))
   order by c.tier, c.win_date desc
   limit coalesce(p_limit, 1000000);

  select count(*) into v_applied from _sup_elig;
  select jsonb_object_agg(review_reason, n) into v_review
    from (select review_reason, count(distinct entity_id) n
            from public.v_lcc_owner_supersession_review group by review_reason) r;
  select jsonb_agg(x) into v_sample from (
    select owner_name, tier_source, win_date::date win_date, confidence
      from _sup_elig order by tier, win_date desc limit 8) x;

  if p_dry_run then
    return jsonb_build_object('ok',true,'dry_run',true,'batch',v_batch,
      'would_resolve',v_applied,'review',coalesce(v_review,'{}'::jsonb),
      'sample',coalesce(v_sample,'[]'::jsonb));
  end if;

  insert into public.lcc_property_owner
    (entity_id, owner_entity_id, owner_name, confidence, margin, source, resolved_at, detail)
  select e.entity_id, e.owner_entity_id, e.owner_name, e.confidence, null, 'supersession', now(),
         jsonb_build_object('tier',e.tier,'tier_source',e.tier_source,'win_date',e.win_date,
                            'runner_up_date',e.runner_up_date,'batch_tag',v_batch)
    from _sup_elig e
  on conflict (entity_id) do nothing;
  get diagnostics v_applied = row_count;

  insert into public.lcc_owner_supersession_log
    (batch_tag, entity_id, owner_entity_id, owner_name, tier, tier_source,
     winning_date, runner_up_date, confidence)
  select v_batch, e.entity_id, e.owner_entity_id, e.owner_name, e.tier, e.tier_source,
         e.win_date, e.runner_up_date, e.confidence
    from _sup_elig e
    join public.lcc_property_owner po on po.entity_id=e.entity_id and po.source='supersession';

  return jsonb_build_object('ok',true,'dry_run',false,'batch',v_batch,'resolved',v_applied,
    'review',coalesce(v_review,'{}'::jsonb),'sample',coalesce(v_sample,'[]'::jsonb));
end $function$;

-- Retype the organisations that were filed as people (prior value recorded).
UPDATE public.entities e
   SET entity_type = 'organization',
       metadata = coalesce(e.metadata,'{}'::jsonb)
                || jsonb_build_object('p148b_prior_entity_type', e.entity_type::text,
                                      'p148b_reason','municipality/public body was typed person')
 WHERE e.entity_type = 'person'
   AND public.lcc_owner_name_has_org_marker(e.name)
   AND e.name ~* '\m(city|county|town|village|borough|parish|municipal|school district|retirement system|tax collector|state of)\M';
