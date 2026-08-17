-- ============================================================================
-- Prompt 116 — brokerages recorded as PROPERTY OWNERS (46 rows, two classes)
-- LCC Opps (xengecqvemvfknjvbvrq)
-- ----------------------------------------------------------------------------
-- Surfaced 2026-08-15 when the P112-A2 cadence enrolment dry-run put Marcus &
-- Millichap ($4.99M connected value) at the TOP of the enrolment list — one
-- confirm away from cold-prospecting a competitor's brokerage as a landlord.
-- A brokerage in the owner slot is not cosmetic: it renders as Current Owner on
-- the property panel, feeds comps/exports/matching, and is cadence-eligible.
--
-- GROUNDED CLASSIFICATION (re-verified live 2026-08-17, do not re-derive):
--
--   source              owner rows   brokerage-as-owner
--   relationship_graph      1,763            42
--   domain_true_owner         401             4
--   supersession              418             0   <- its guard already held
--                                            ---
--                                             46
--
--   class (a)  27 rows / 27 entities  "<owner> by <brokerage>"  -> owner CORRECT,
--              the NAME carries a CoStar capture artefact.
--   class (b)  19 rows /  7 entities  pure brokerage            -> owner WRONG.
--              Marcus & Millichap, Capital Pacific, Stan Johnson Co,
--              Lee & Associates, NAI Pfefferle, Svn(R), Trammell Crow Co (CBRE).
--
-- ⚠ WHY THE OBVIOUS FIX (rename in place) IS WRONG FOR MOST OF CLASS (a)
--   Stripping " by <broker>" yields 27 clean, plausible names. But 21 of the 27
--   COLLIDE with an entity that already exists under the clean name. The CoStar
--   capture minted "X LLC by Broker" as a SEPARATE entity from the existing
--   "X LLC". So this is a DUPLICATE-ENTITY problem, not a naming problem, and
--   the property is pointed at the duplicate — with its own split portfolio,
--   cadence and contact history.
--
-- ⚠ IDENTITY IS SCORED ON A STRICT CORE, NEVER lcc_normalize_entity_name().
--   That normalizer strips SEMANTIC tokens (partners, properties, capital,
--   group, holdings) — the CLAUDE.md stoplist footgun. Under it "Century Park
--   Partners" and "Century Park Properties LLC" both collapse to "century park"
--   and would have been merged as one party. §1 adds lcc_owner_strict_core(),
--   the SQL mirror of the regression-tested JS strictOwnerCore()
--   (owner-contact-propagate-planner.js) / gov_owner_strict_core (gov §20):
--   strip ONLY pure legal-entity forms, keep every semantic token.
--   Measured effect: that one change moved Century Park from a would-be
--   automatic re-point onto the WRONG party to an abstain.
--
-- CLASS (a) DISPOSITION (strict core, live):
--   16  repoint            exactly ONE clean twin, entity_type compatible
--    4  review_ambiguous   TWO clean twins  (BGC-Havasu, Century Park Partners,
--                          Mielkemark, MLC Ranch) -> never guess the survivor
--    1  review_type_shape  "Michael Moore by Matthews(TM)" is a PERSON whose
--                          clean twin is an ORGANIZATION. Merging those is the
--                          person/org conflation sf-account-link.js guards
--                          against -> abstain.
--    6  strip_in_place     no clean twin exists, safe to clean the name
--   --
--   27
--
-- DISCIPLINE: additive · reversible by batch tag · idempotent · dry-run DEFAULT ·
-- conservative (ambiguity -> review, never guess) · reuses
-- lcc_owner_name_is_brokerage() and lcc_merge_entity rather than forking either.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- §1  IDENTITY core — legal forms stripped, meaning preserved.
--     SQL mirror of JS strictOwnerCore(); see the footgun note above.
-- ---------------------------------------------------------------------------
create or replace function public.lcc_owner_strict_core(p_name text)
returns text language sql immutable set search_path to 'public','pg_temp' as $$
  select coalesce(
    (select string_agg(t, ' ' order by t)
       from (select distinct tok as t
               from unnest(string_to_array(
                 btrim(regexp_replace(regexp_replace(regexp_replace(
                   lower(coalesce(p_name,'')), '&', ' and ', 'g'),
                   '[^a-z0-9]+', ' ', 'g'), '\s+', ' ', 'g')), ' ')) as tok
              where length(tok) > 1
                and tok not in ('llc','llp','lp','inc','incorporated','corp','corporation',
                                'ltd','limited','trust','reit','dst','lllp')
            ) d),
  '');
$$;

comment on function public.lcc_owner_strict_core(text) is
  'P116. Semantic identity core: strips ONLY pure legal-entity forms, KEEPS every '
  'semantic token (co/company/group/partners/holdings/properties/capital/realty). '
  'Use this for IDENTITY. Never use lcc_normalize_entity_name() or dup-pair-planner '
  'ownerCore for identity — they strip a generic-CRE stoplist, so "Century Park '
  'Partners" == "Century Park Properties" and "Realty Income Corporation" collapses '
  'to the empty string. Mirror of JS strictOwnerCore / gov_owner_strict_core.';


-- Enough distinctive material to let core equality drive an automatic write.
create or replace function public.lcc_owner_strict_core_substantial(p_core text)
returns boolean language sql immutable as $$
  select length(replace(coalesce(p_core,''), ' ', '')) >= 5
     and exists (select 1 from unnest(string_to_array(coalesce(p_core,''),' ')) t
                  where length(t) >= 3);
$$;


-- ---------------------------------------------------------------------------
-- §2  The capture artefact: strip a TRAILING " by <brokerage>" suffix.
--     Returns NULL when the pattern does not apply, i.e. when there is no
--     " by " at all, when what follows it is NOT a brokerage (so we are not
--     truncating a legitimate name), or when the REMAINDER is itself a
--     brokerage (that is class (b), not a polluted suffix).
--     Splits on the LAST " by " so "Molly Huang by Marcus & Millichap ; Colliers"
--     keeps "Molly Huang".
-- ---------------------------------------------------------------------------
create or replace function public.lcc_p116_broker_suffix_strip(p_name text)
returns text language plpgsql immutable set search_path to 'public','pg_temp' as $$
declare v_head text; v_tail text;
begin
  if coalesce(p_name,'') !~* '\s+by\s+' then return null; end if;
  v_head := btrim(regexp_replace(p_name, '\s+by\s+(?!.*\s+by\s+).*$', '', 'i'));
  v_tail := substring(p_name from '(?i)\s+by\s+(?!.*\s+by\s+)(.*)$');
  -- the suffix must actually be a brokerage, and the survivor must not be one
  if not public.lcc_owner_name_is_brokerage(v_tail) then return null; end if;
  if coalesce(v_head,'') = '' then return null; end if;
  if public.lcc_owner_name_is_brokerage(v_head) then return null; end if;
  return v_head;
end $$;


-- ---------------------------------------------------------------------------
-- §3  Reversible ledger. Every write below records its prior value here.
-- ---------------------------------------------------------------------------
create table if not exists public.lcc_p116_brokerage_owner_log (
  id                     bigserial primary key,
  batch_tag              text not null,
  unit                   text not null,          -- repoint | strip_in_place | clear_brokerage
  asset_entity_id        uuid,                   -- lcc_property_owner.entity_id
  owner_entity_id_before uuid,
  owner_entity_id_after  uuid,
  owner_name_before      text,
  owner_name_after       text,
  entity_renamed_id      uuid,
  entity_name_before     text,
  entity_name_after      text,
  detail                 jsonb not null default '{}'::jsonb,
  created_at             timestamptz not null default now()
);
create index if not exists idx_p116_log_batch on public.lcc_p116_brokerage_owner_log(batch_tag);

comment on table public.lcc_p116_brokerage_owner_log is
  'P116 reversible ledger for brokerage-as-owner corrections. REVERSAL RUNBOOK at '
  'the foot of migration 20260817120000.';


-- ---------------------------------------------------------------------------
-- §4  The live PLAN. Recomputed on every read, so the collision check is always
--     current (Unit 1 can create new clean-named twins that Unit 2 must see).
-- ---------------------------------------------------------------------------
create or replace view public.v_lcc_p116_polluted_owner_plan as
with polluted as (
  select distinct po.owner_entity_id as polluted_id,
         po.owner_name,
         public.lcc_p116_broker_suffix_strip(po.owner_name) as clean_name
    from public.lcc_property_owner po
   where po.owner_entity_id is not null
     and public.lcc_owner_name_is_brokerage(po.owner_name)
     and public.lcc_p116_broker_suffix_strip(po.owner_name) is not null
), pc as (
  select p.*, e.entity_type::text as polluted_type,
         public.lcc_owner_strict_core(p.clean_name) as core
    from polluted p join public.entities e on e.id = p.polluted_id
), cand as (
  select pc.polluted_id, c.id as cand_id, c.name as cand_name, c.entity_type::text as cand_type
    from pc
    join public.entities c
      on c.merged_into_entity_id is null
     and c.id <> pc.polluted_id
     and public.lcc_owner_strict_core(c.name) = pc.core
   where public.lcc_owner_strict_core_substantial(pc.core)
     and not public.lcc_owner_name_is_brokerage(c.name)
), agg as (
  select pc.*,
         (select count(*) from cand c where c.polluted_id = pc.polluted_id) as candidate_count,
         (select c.cand_id   from cand c where c.polluted_id = pc.polluted_id limit 1) as cand_id,
         (select c.cand_name from cand c where c.polluted_id = pc.polluted_id limit 1) as cand_name,
         (select c.cand_type from cand c where c.polluted_id = pc.polluted_id limit 1) as cand_type
    from pc
)
select polluted_id, owner_name, clean_name, polluted_type, core,
       candidate_count, cand_id, cand_name, cand_type,
       case
         when candidate_count = 0                    then 'strip_in_place'
         when candidate_count > 1                    then 'review_ambiguous'
         when cand_type is distinct from polluted_type then 'review_type_shape'
         else 'repoint'
       end as plan
  from agg;

comment on view public.v_lcc_p116_polluted_owner_plan is
  'P116 class (a) plan, recomputed live. repoint = exactly one clean twin of the '
  'same entity_type; review_ambiguous = 2+ twins (never guess the survivor); '
  'review_type_shape = person/organization mismatch (the conflation '
  'sf-account-link.js guards against); strip_in_place = no twin, safe to rename.';


-- ---------------------------------------------------------------------------
-- §5  UNIT 1 — re-point the property to the EXISTING clean entity, and rename
--     the polluted duplicate so the EXISTING merge machinery can see it.
--
--     Why the rename matters: v_lcc_merge_candidates groups on
--     lcc_normalize_entity_name and needs >= 2 members. "DP Brighton LLC by
--     Marcus & Millichap" normalizes to "dp brighton by marcus millichap", which
--     never groups with "dp brighton" — which is exactly WHY the duplication has
--     been invisible. Renaming the loser to the clean name makes the pair
--     surface in v_lcc_merge_candidates, where the existing lane confirms it
--     through lcc_merge_entity. No second merge path is invented here.
--
--     The EVIDENCE row is re-pointed too. Without that, the next
--     lcc_reconcile_property_owner cron pass would re-elect the duplicate and
--     silently undo the correction.
-- ---------------------------------------------------------------------------
create or replace function public.lcc_p116_repoint_polluted_owners(
  p_dry_run boolean default true, p_batch text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_batch text := coalesce(p_batch, 'p116_repoint_' || to_char(now(),'YYYYMMDD_HH24MI'));
  v_rows int := 0; v_ent int := 0; v_ev int := 0; v_sample jsonb;
begin
  create temporary table _p116_rp on commit drop as
  select polluted_id, owner_name, clean_name, cand_id, cand_name
    from public.v_lcc_p116_polluted_owner_plan where plan = 'repoint';

  select count(*) into v_rows from _p116_rp;
  select jsonb_agg(x) into v_sample from
    (select owner_name, clean_name, cand_name from _p116_rp order by owner_name limit 8) x;

  if p_dry_run then
    return jsonb_build_object('ok',true,'dry_run',true,'batch',v_batch,
      'would_repoint_entities',v_rows,'sample',coalesce(v_sample,'[]'::jsonb));
  end if;

  -- ledger BEFORE the writes
  insert into public.lcc_p116_brokerage_owner_log
    (batch_tag, unit, asset_entity_id, owner_entity_id_before, owner_entity_id_after,
     owner_name_before, owner_name_after, entity_renamed_id, entity_name_before,
     entity_name_after, detail)
  select v_batch, 'repoint', po.entity_id, r.polluted_id, r.cand_id,
         po.owner_name, r.cand_name, r.polluted_id, r.owner_name, r.clean_name,
         jsonb_build_object('reason','class_a_suffix_polluted_duplicate',
                            'merge_winner', r.cand_id, 'merge_loser', r.polluted_id)
    from _p116_rp r
    join public.lcc_property_owner po on po.owner_entity_id = r.polluted_id;

  -- 1. the property now points at the REAL owner
  update public.lcc_property_owner po
     set owner_entity_id = r.cand_id, owner_name = r.cand_name, resolved_at = now(),
         detail = coalesce(po.detail,'{}'::jsonb)
                  || jsonb_build_object('p116_repointed_from', r.polluted_id, 'p116_batch', v_batch)
    from _p116_rp r
   where po.owner_entity_id = r.polluted_id;
  get diagnostics v_rows = row_count;

  -- 2. re-point the EVIDENCE, else the next reconcile pass re-elects the duplicate.
  --    PK is (entity_id, candidate_owner_entity, source) — skip where the real
  --    entity is already a candidate for that asset+source, then drop the stale row.
  update public.lcc_property_owner_evidence ev
     set candidate_owner_entity = r.cand_id, updated_at = now()
    from _p116_rp r
   where ev.candidate_owner_entity = r.polluted_id
     and not exists (select 1 from public.lcc_property_owner_evidence ev2
                      where ev2.entity_id = ev.entity_id
                        and ev2.candidate_owner_entity = r.cand_id
                        and ev2.source = ev.source);
  get diagnostics v_ev = row_count;
  delete from public.lcc_property_owner_evidence ev
   using _p116_rp r where ev.candidate_owner_entity = r.polluted_id;

  -- 3. rename the loser so v_lcc_merge_candidates surfaces the duplicate pair
  update public.entities e
     set name = r.clean_name, updated_at = now(),
         metadata = coalesce(e.metadata,'{}'::jsonb)
                    || jsonb_build_object('p116_broker_suffix_stripped', r.owner_name,
                                          'p116_merge_winner', r.cand_id,
                                          'p116_batch', v_batch)
    from _p116_rp r
   where e.id = r.polluted_id;
  get diagnostics v_ent = row_count;

  return jsonb_build_object('ok',true,'dry_run',false,'batch',v_batch,
    'owner_rows_repointed',v_rows,'entities_renamed_for_merge',v_ent,
    'evidence_rows_repointed',v_ev,'sample',coalesce(v_sample,'[]'::jsonb));
end $$;


-- ---------------------------------------------------------------------------
-- §6  UNIT 2 — no clean twin exists, so the name is simply dirty. Strip it on
--     entities.name AND the denormalised lcc_property_owner.owner_name.
--     Collisions are re-checked at RUN TIME (the view is live), so a twin
--     created by Unit 1 is respected rather than duplicated.
-- ---------------------------------------------------------------------------
create or replace function public.lcc_p116_strip_orphan_suffixes(
  p_dry_run boolean default true, p_batch text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_batch text := coalesce(p_batch, 'p116_strip_' || to_char(now(),'YYYYMMDD_HH24MI'));
  v_ent int := 0; v_own int := 0; v_sample jsonb;
begin
  create temporary table _p116_st on commit drop as
  select polluted_id, owner_name, clean_name
    from public.v_lcc_p116_polluted_owner_plan where plan = 'strip_in_place';

  select count(*) into v_ent from _p116_st;
  select jsonb_agg(x) into v_sample from
    (select owner_name, clean_name from _p116_st order by owner_name limit 8) x;

  if p_dry_run then
    return jsonb_build_object('ok',true,'dry_run',true,'batch',v_batch,
      'would_strip_entities',v_ent,'sample',coalesce(v_sample,'[]'::jsonb));
  end if;

  insert into public.lcc_p116_brokerage_owner_log
    (batch_tag, unit, asset_entity_id, owner_entity_id_before, owner_entity_id_after,
     owner_name_before, owner_name_after, entity_renamed_id, entity_name_before,
     entity_name_after, detail)
  select v_batch, 'strip_in_place', po.entity_id, s.polluted_id, s.polluted_id,
         po.owner_name, s.clean_name, s.polluted_id, s.owner_name, s.clean_name,
         jsonb_build_object('reason','class_a_no_clean_twin')
    from _p116_st s
    join public.lcc_property_owner po on po.owner_entity_id = s.polluted_id;

  update public.entities e
     set name = s.clean_name, updated_at = now(),
         metadata = coalesce(e.metadata,'{}'::jsonb)
                    || jsonb_build_object('p116_broker_suffix_stripped', s.owner_name,
                                          'p116_batch', v_batch)
    from _p116_st s where e.id = s.polluted_id;
  get diagnostics v_ent = row_count;

  update public.lcc_property_owner po
     set owner_name = s.clean_name, resolved_at = now()
    from _p116_st s where po.owner_entity_id = s.polluted_id;
  get diagnostics v_own = row_count;

  return jsonb_build_object('ok',true,'dry_run',false,'batch',v_batch,
    'entities_stripped',v_ent,'owner_rows_renamed',v_own,
    'sample',coalesce(v_sample,'[]'::jsonb));
end $$;


-- ---------------------------------------------------------------------------
-- §7  UNIT 3 — class (b): the owner is WRONG. Remove the assignment so the
--     asset reverts to an honest "Unresolved". An unresolved owner is honest;
--     a brokerage in the owner slot is misinformation.
--
--     The whole prior row is ledgered, so the removal is reversible. The
--     BROKERAGE EVIDENCE is deleted too — otherwise the next reconcile pass
--     just re-elects it. Any OTHER candidate for the asset survives, so an
--     asset that has a real owner underneath the brokerage self-resolves on the
--     next pass instead of staying blank.
-- ---------------------------------------------------------------------------
create or replace function public.lcc_p116_clear_brokerage_owners(
  p_dry_run boolean default true, p_batch text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_batch text := coalesce(p_batch, 'p116_clear_' || to_char(now(),'YYYYMMDD_HH24MI'));
  v_rows int := 0; v_ev int := 0; v_sample jsonb;
begin
  create temporary table _p116_cl on commit drop as
  select po.entity_id, po.owner_entity_id, po.owner_name, po.confidence, po.margin,
         po.source, po.resolved_at, po.detail
    from public.lcc_property_owner po
   where po.owner_entity_id is not null
     and public.lcc_owner_name_is_brokerage(po.owner_name)
     and public.lcc_p116_broker_suffix_strip(po.owner_name) is null;  -- pure brokerage

  select count(*) into v_rows from _p116_cl;
  select jsonb_agg(x) into v_sample from
    (select owner_name, source, count(*) as rows from _p116_cl
      group by 1,2 order by 3 desc limit 10) x;

  if p_dry_run then
    return jsonb_build_object('ok',true,'dry_run',true,'batch',v_batch,
      'would_clear_owner_rows',v_rows,
      'distinct_brokerages',(select count(distinct owner_entity_id) from _p116_cl),
      'sample',coalesce(v_sample,'[]'::jsonb));
  end if;

  insert into public.lcc_p116_brokerage_owner_log
    (batch_tag, unit, asset_entity_id, owner_entity_id_before, owner_entity_id_after,
     owner_name_before, owner_name_after, detail)
  select v_batch, 'clear_brokerage', c.entity_id, c.owner_entity_id, null,
         c.owner_name, null,
         jsonb_build_object('reason','class_b_pure_brokerage_is_not_the_owner',
           'restore', jsonb_build_object('confidence',c.confidence,'margin',c.margin,
             'source',c.source,'resolved_at',c.resolved_at,'detail',c.detail))
    from _p116_cl c;

  delete from public.lcc_property_owner po using _p116_cl c
   where po.entity_id = c.entity_id and po.owner_entity_id = c.owner_entity_id;
  get diagnostics v_rows = row_count;

  delete from public.lcc_property_owner_evidence ev using _p116_cl c
   where ev.entity_id = c.entity_id and ev.candidate_owner_entity = c.owner_entity_id;
  get diagnostics v_ev = row_count;

  return jsonb_build_object('ok',true,'dry_run',false,'batch',v_batch,
    'owner_rows_cleared',v_rows,'evidence_rows_cleared',v_ev,
    'sample',coalesce(v_sample,'[]'::jsonb));
end $$;


-- ---------------------------------------------------------------------------
-- §8  UNIT 4 — STOP THE BLEEDING. 42 of the 46 came from relationship_graph,
--     whose writer (lcc_reconcile_property_owner) had no brokerage guard and
--     will otherwise re-create every row this migration fixes.
--
--     The supersession feeder already carries exactly this guard
--     (lcc_supersede_property_owner: "and not lcc_owner_name_is_brokerage(...)")
--     and produced 0 brokerage owners. Same predicate, same function, no second
--     definition. Because `source` on lcc_property_owner is derived from the
--     evidence rows this function scores, ONE guard here also covers the 4
--     domain_true_owner rows.
--
--     Only the guard line and its join are added; scoring is byte-identical.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_reconcile_property_owner(
  p_entity_id uuid, p_min_confidence numeric DEFAULT 0.55, p_write boolean DEFAULT true)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_top uuid; v_top_score numeric; v_second numeric := 0; v_total numeric;
  v_conf numeric; v_margin numeric; v_name text; v_wrote boolean := false; v_source text;
begin
  with scored as (
    select ev.candidate_owner_entity,
           sum(ev.weight * greatest(0.25, 1.0 - (current_date - coalesce(ev.observed_at::date, current_date))::numeric / 365.0)) as score
    from public.lcc_property_owner_evidence ev
    join public.entities ce on ce.id = ev.candidate_owner_entity
    where ev.entity_id = p_entity_id
      and ev.candidate_owner_entity not in (select owner_entity_id from public.lcc_owner_operator_block)
      -- P116: a brokerage is the agent, never the principal. Same predicate the
      -- supersession feeder already uses.
      and not public.lcc_owner_name_is_brokerage(ce.name)
    group by ev.candidate_owner_entity
  ), ranked as (
    select candidate_owner_entity, score,
           sum(score) over () as total,
           row_number() over (order by score desc) as rn,
           lead(score) over (order by score desc) as next_score
    from scored
  )
  select candidate_owner_entity, score, total, coalesce(next_score,0)
    into v_top, v_top_score, v_total, v_second
  from ranked where rn = 1;

  if v_top is null or coalesce(v_total,0) = 0 then
    return jsonb_build_object('ok',true,'entity_id',p_entity_id,'owner',null,'reason','no_evidence');
  end if;

  v_conf   := round(v_top_score / v_total, 3);
  v_margin := case when v_top_score = 0 then 0 else round((v_top_score - v_second) / v_top_score, 3) end;
  select name into v_name from public.entities where id = v_top;
  select string_agg(distinct source, ',') into v_source
    from public.lcc_property_owner_evidence
    where entity_id = p_entity_id and candidate_owner_entity = v_top;

  if p_write and v_conf >= p_min_confidence then
    insert into public.lcc_property_owner(entity_id, owner_entity_id, owner_name, confidence, margin, source, resolved_at, detail)
    values (p_entity_id, v_top, v_name, v_conf, v_margin, coalesce(v_source,'relationship_graph'), now(),
            jsonb_build_object('total_score', round(v_total,3)))
    on conflict (entity_id) do update
      set owner_entity_id = excluded.owner_entity_id, owner_name = excluded.owner_name,
          confidence = excluded.confidence, margin = excluded.margin,
          source = excluded.source, resolved_at = now(), detail = excluded.detail;
    v_wrote := true;
  end if;

  return jsonb_build_object('ok',true,'entity_id',p_entity_id,'owner',v_top,'owner_name',v_name,
    'confidence',v_conf,'margin',v_margin,'source',coalesce(v_source,'relationship_graph'),'wrote',v_wrote);
end $function$;


-- ---------------------------------------------------------------------------
-- §9  The CONSUMER. Prompt 114's lesson: a review TABLE with no consumer is an
--     un-consumed producer, so this is a value-ranked VIEW over live state.
--     Three lanes, all self-clearing as the underlying condition is resolved:
--       class_a_ambiguous / class_a_type_shape — the 5 abstains from §4
--       class_b_owner_removed                  — assets whose brokerage owner
--                                                was cleared and which the
--                                                feeder could not re-resolve
--     Includes FUTURE blocks: if the §8 guard ever suppresses a candidate (a
--     false positive on the brokerage regex, e.g. a genuine "Marcus Family
--     Trust"), the asset appears here rather than failing silently.
-- ---------------------------------------------------------------------------
create or replace view public.v_lcc_p116_brokerage_owner_review as
with class_a as (
  select p.polluted_id as subject_entity_id,
         p.owner_name  as observed_name,
         p.clean_name,
         p.plan        as lane,
         p.candidate_count,
         p.cand_name   as candidate_name,
         (select po.entity_id from public.lcc_property_owner po
           where po.owner_entity_id = p.polluted_id limit 1) as asset_entity_id
    from public.v_lcc_p116_polluted_owner_plan p
   where p.plan in ('review_ambiguous','review_type_shape')
), class_b as (
  -- an asset whose brokerage owner was removed and which still has no owner
  select l.owner_entity_id_before as subject_entity_id,
         l.owner_name_before      as observed_name,
         null::text               as clean_name,
         'class_b_owner_removed'::text as lane,
         0                        as candidate_count,
         null::text               as candidate_name,
         l.asset_entity_id
    from public.lcc_p116_brokerage_owner_log l
   where l.unit = 'clear_brokerage'
     and not exists (select 1 from public.lcc_property_owner po
                      where po.entity_id = l.asset_entity_id and po.owner_entity_id is not null)
), person_dupe as (
  -- a re-pointed PERSON duplicate. v_lcc_merge_candidates is organization-only and
  -- v_lcc_person_email_merge_candidates keys on email, so a person duplicate with no
  -- email would otherwise be corrected but never surfaced for consolidation. Live:
  -- 1 row ("Molly Huang"). Without this lane it would be silent residue.
  select l.entity_renamed_id, l.entity_name_before, l.entity_name_after,
         'person_duplicate_unmerged'::text, 1, l.owner_name_after, l.asset_entity_id
    from public.lcc_p116_brokerage_owner_log l
    join public.entities e on e.id = l.entity_renamed_id
   where l.unit = 'repoint'
     and e.entity_type::text <> 'organization'
     and e.merged_into_entity_id is null
     and not exists (select 1 from public.v_lcc_merge_candidates mc
                      where l.entity_renamed_id = any(mc.loser_ids)
                         or l.entity_renamed_id = mc.winner_id)
), blocked as (
  -- a live asset whose ONLY owner evidence names a brokerage (the §8 guard is
  -- suppressing it) and which therefore has no resolved owner
  select distinct ev.candidate_owner_entity as subject_entity_id,
         ce.name                   as observed_name,
         public.lcc_p116_broker_suffix_strip(ce.name) as clean_name,
         'guard_blocked_candidate'::text as lane,
         0 as candidate_count, null::text as candidate_name,
         ev.entity_id as asset_entity_id
    from public.lcc_property_owner_evidence ev
    join public.entities ce on ce.id = ev.candidate_owner_entity
   where public.lcc_owner_name_is_brokerage(ce.name)
     and not exists (select 1 from public.lcc_property_owner po
                      where po.entity_id = ev.entity_id and po.owner_entity_id is not null)
), u as (
  select * from class_a
  union all select * from class_b
  union all select * from person_dupe
  union all select * from blocked
)
select u.*,
       a.name   as asset_name,
       a.domain as asset_domain,
       coalesce((select cv.connected_property_value
                   from public.lcc_entity_connected_value cv
                  where cv.entity_id = u.subject_entity_id), 0) as connected_value
  from u left join public.entities a on a.id = u.asset_entity_id;

comment on view public.v_lcc_p116_brokerage_owner_review is
  'P116 review lanes for brokerage-as-owner. review_ambiguous / review_type_shape = '
  'suffix-polluted duplicates we deliberately abstained on (2+ clean twins, or a '
  'person/organization shape mismatch) — resolve by picking the survivor and merging '
  'via lcc_merge_entity. class_b_owner_removed = asset reverted to honest Unresolved. '
  'person_duplicate_unmerged = re-pointed person duplicate the org-only merge lane '
  'cannot see. guard_blocked_candidate = the §8 feeder guard is suppressing a '
  'brokerage-named candidate; a false positive on the regex shows up HERE rather '
  'than silently.';


-- ---------------------------------------------------------------------------
-- APPLIED LIVE 2026-08-17 to LCC Opps (xengecqvemvfknjvbvrq), in four parts:
--   lcc_p116_brokerage_as_owner          (§1–§4)
--   lcc_p116_brokerage_as_owner_units    (§5–§7)
--   lcc_p116_feeder_guard_and_review     (§8–§9)
--   lcc_p116_review_person_dupe_lane     (§9 person_dupe lane)
-- This file is the single consolidated source of truth for all four.
--
-- MEASURED RESULT (before -> after)
--   brokerage-as-owner rows            46 -> 5   (the 5 are the deliberate abstains)
--     relationship_graph               42 -> 5
--     domain_true_owner                 4 -> 0
--     supersession                      0 -> 0   (its guard held throughout)
--   Unit 1 repoint      16 owner rows, 16 evidence rows, 16 entities renamed
--   Unit 2 strip         6 entities,    6 owner rows
--   Unit 3 clear        19 owner rows, 19 evidence rows, 7 distinct brokerages
--   Re-running all three units: 0 / 0 / 0  (idempotent)
--   Feeder re-run over all 41 touched assets: 22 kept the corrected owner,
--     19 returned no_evidence, brokerage-as-owner stayed 5 (the guard holds).
--   15 of the 16 re-pointed duplicates now surface in v_lcc_merge_candidates;
--     the 16th is a person and surfaces in the person_duplicate_unmerged lane.
-- ---------------------------------------------------------------------------


grant select on public.v_lcc_p116_polluted_owner_plan     to anon, authenticated, service_role;
grant select on public.v_lcc_p116_brokerage_owner_review  to anon, authenticated, service_role;
grant select on public.lcc_p116_brokerage_owner_log       to anon, authenticated, service_role;


-- ============================================================================
-- REVERSAL RUNBOOK  (batch_tag is stamped on every row written above)
-- ----------------------------------------------------------------------------
-- Unit 1 (repoint + rename):
--   update public.lcc_property_owner po
--      set owner_entity_id = l.owner_entity_id_before, owner_name = l.owner_name_before
--     from public.lcc_p116_brokerage_owner_log l
--    where l.batch_tag = '<tag>' and l.unit = 'repoint' and po.entity_id = l.asset_entity_id;
--   update public.entities e set name = l.entity_name_before
--     from public.lcc_p116_brokerage_owner_log l
--    where l.batch_tag = '<tag>' and l.unit = 'repoint' and e.id = l.entity_renamed_id;
--   -- NOTE: re-pointed EVIDENCE rows are not restored by the above; they are
--   -- rebuilt by the next feeder pass. If an exact restore is required, capture
--   -- lcc_property_owner_evidence before running.
--
-- Unit 2 (strip in place):
--   update public.entities e set name = l.entity_name_before
--     from public.lcc_p116_brokerage_owner_log l
--    where l.batch_tag = '<tag>' and l.unit = 'strip_in_place' and e.id = l.entity_renamed_id;
--   update public.lcc_property_owner po set owner_name = l.owner_name_before
--     from public.lcc_p116_brokerage_owner_log l
--    where l.batch_tag = '<tag>' and l.unit = 'strip_in_place' and po.entity_id = l.asset_entity_id;
--
-- Unit 3 (clear):
--   insert into public.lcc_property_owner
--     (entity_id, owner_entity_id, owner_name, confidence, margin, source, resolved_at, detail)
--   select l.asset_entity_id, l.owner_entity_id_before, l.owner_name_before,
--          (l.detail->'restore'->>'confidence')::numeric,
--          (l.detail->'restore'->>'margin')::numeric,
--           l.detail->'restore'->>'source',
--          (l.detail->'restore'->>'resolved_at')::timestamptz,
--    coalesce(l.detail->'restore'->'detail','{}'::jsonb)
--     from public.lcc_p116_brokerage_owner_log l
--    where l.batch_tag = '<tag>' and l.unit = 'clear_brokerage'
--   on conflict (entity_id) do nothing;
--
-- Unit 4 (guard): re-run the prior body of lcc_reconcile_property_owner without
--   the `join public.entities ce` + `not lcc_owner_name_is_brokerage(ce.name)` lines.
-- ============================================================================
