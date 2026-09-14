-- ============================================================================
-- P152 / P152a — an AGENT is not the PRINCIPAL. The guard deferred three times.
-- Applied live to LCC Opps (xengecqvemvfknjvbvrq) 2026-08-19.
-- ----------------------------------------------------------------------------
-- P146, P148a and P149 each stopped at the same wall: 24 entities are AGENTS
-- (CMBS special servicers, trustee banks, investment managers acting OBO a
-- pension fund) wearing entity_type='person'. Correcting the type is factually
-- right -- an agent IS an organisation -- but nothing stopped an
-- organisation-typed agent from RESOLVING AS AN OWNER, because
-- lcc_owner_name_is_brokerage lists BROKERAGES, not servicers. Retyping without
-- a guard trades a TYPE error for an OWNERSHIP error, which is worse. So they
-- stayed mistyped, three times, waiting for this.
--
-- ── WHAT THE POPULATION ACTUALLY LOOKS LIKE ─────────────────────────────────
--   OBO   52 rows.  26 are CMBS trusts (JPMCC 2005-CIBC11, ML-CFC 2007-6,
--                   Wachovia 2007-C34...). 26 name a real institutional
--                   principal: CalPERS · CalSTRS · NYSCRF · AustralianSuper ·
--                   Utah State Retirement System · AFL-CIO · Korea Investment
--                   Management · and RMR Group OBO **Government Properties
--                   Income Trust** / **Office Properties Income Trust** -- the
--                   external manager standing in front of two REITs that are
--                   squarely in the government net-lease universe.
--   c/o   63 rows.
--   named servicers  CWCapital · C-III · Midland Loan Services · LNR · KeyCorp
--
-- ── THREE ARMS OF MY OWN FIRST DRAFT WERE WRONG, EACH CAUGHT BY A LIVE ROW ──
--
-- 1. "bank ... trust" would have blocked 60 COMMUNITY BANKS that own their own
--    branch buildings and are perfectly good prospects -- Cedar Rapids Bank &
--    Trust, Hills Bank and Trust, Guaranty Bank & Trust, First Farmers Bank &
--    Trust, Branch Banking and Trust. Caught by running the draft against the
--    ALREADY-RESOLVED owners before applying it: 6 would have been blocked.
--
-- 2. "c/o" is a MAILING artifact, not an agency claim. The owner is the text
--    BEFORE it and the text AFTER it is usually the property manager or a named
--    human -- i.e. the reachable contact, not a disqualification:
--        919 Investments LLC c/o Choice One Development, LLC
--        Allegheny Properties, LLC c/o Ronald Holley at Kingwood address
--    Strip, don't reject -- the same lesson as gov P138b's `by <brokerage>`.
--
-- 3. Bare "Trustee" is usually a PERSON who is trustee of their own family
--    trust -- Leonard Edelman, Trustee · Tony Martin, Trustee · COLLINS, MARY
--    KATHLEEN TRUSTEE · ELK GROVE TRUST, Winfred Tai, Trustee. Under Scott's
--    2026-08-19 doctrine ("a person can be an owner if they are the individual
--    in control of the ownership of the LLC or SPE") those people ARE the
--    owners. Blocking them would have contradicted the ruling given hours
--    earlier. 17 such rows are deliberately untouched.
--
-- ⚠️ And a fourth, from the same family as the lower()/empty-string trap: while
-- sizing the c/o duplicates, "C/O Arshavir Kitsinian" has NO head, so its
-- normalized key is '' -- which compares EQUAL to an entity literally named
-- "--" and inflated the duplicate count from ~15 to 109. Any normalize-then-
-- compare needs a material floor on the result, not just on the input.
--
-- ── THE RULE ────────────────────────────────────────────────────────────────
-- An agent is an INSTITUTION acting FOR A NAMED OTHER PARTY -- both halves
-- required -- plus the named CMBS special servicers, plus the named custodial
-- fiduciaries when they LEAD the name (anchored, so a trailing holding
-- structure like "River Bank Associates LLC Wilmington Trust" stays a real
-- owner). Gated 8 positives / 14 negatives, plus a regression assert that no
-- currently-resolved owner beyond the 3 known OBO rows is reclassified.
--
-- ── P152a: the 3 agent-as-owner rows that predate the guard ─────────────────
-- Repointed to the principal where the principal already exists as an entity --
-- 2 rows, both "Rendina Cos JV Artemis RE Partners OBO CalSTRS" -> CalSTRS.
-- EVIDENCE REPOINTED TOO, and first: fixing lcc_property_owner alone lets the
-- next reconcile re-elect the agent (CLAUDE.md's P116 note). The third,
-- "Genesis Financial Group OBO Gen Net Lease Income Trust", has no principal
-- entity and is left as-is rather than deleted -- removing an owner with no
-- replacement destroys information.
--
-- ── HONEST SIZE ─────────────────────────────────────────────────────────────
-- 135 names flagged as agents · 27 retyped · agents still typed person 0 (this
-- closes P149's deferral) · 60 community banks and 17 individual trustees
-- untouched · 24 evidence rows still point at agents and are now BLOCKED from
-- resolving rather than silently winning. Today's realised dollar value is
-- small ($703k of rent sat on agent rows). The value is that this class can no
-- longer land as CoStar capture grows, and that the OBO principal is now
-- visibly extractable.
--
-- NOT BUILT, SIZED AND LEFT: strip c/o and mint the 15 head-matches as merge
-- candidates (invisible duplicates today); repoint the 26 institutional OBO
-- principals, 12 of which already exist as entities. Each needs its own gate.
--
-- REVERSAL:
--   update entities set entity_type=(metadata->>'p152_prior_entity_type')::entity_type
--    where metadata ? 'p152_prior_entity_type';
--   -- P152a rows carry detail->>'p152a_repointed_from_agent' on both
--   -- lcc_property_owner and lcc_property_owner_evidence.
--   -- drop the lcc_owner_name_is_agent() clause from lcc_supersede_property_owner.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lcc_owner_name_is_agent(p_name text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  with n as (select coalesce(p_name,'') nm)
  select
    -- (1) a named title-holding / custodial fiduciary, LEADING the name
        nm ~* '^\s*(chicago title land trust|newtower trust|san pasqual fiduciary|pensco trust|wilmington trust)\M'
    -- (2) a named CMBS special servicer, anywhere
     or nm ~* '(\mCWCapital\M|\mC-III Asset Management\M|\mMidland Loan Services\M|\mLNR Partners\M|\mLNR Property\M|\mRialto Capital\M|\mTorchlight\M|\mKey Commercial Mortgage\M|\mspecial servicer\M)'
    -- (3) an INSTITUTION acting FOR A NAMED OTHER PARTY: both halves required
     or ( nm ~* '(\mb(an)?k\M|\mtrust co|\mtrust company\M|\mcapital\M|\masset management\M|\madvisors?\M|\mservicing\M|\mfiduciary\M|\mn\.?a\.?\M|\mntnl assn\M)'
      and nm ~* '(\mOBO\M|\mon behalf of\M|\mf/?b/?o\M|\mfor benefit of\M|\mas trustee\M|\mtrustee f/|\mtrustee for\M|\mas nominee\M|;\s*\S)' )
    -- (4) explicit agency that names no institution but is unambiguous
     or nm ~* '(\mOBO\M|\mon behalf of\M)'
  from n;
$$;

COMMENT ON FUNCTION public.lcc_owner_name_is_agent(text) IS
  'P152. Does this name denote an AGENT acting for someone else rather than the '
  'principal that owns the asset? An agent is an INSTITUTION acting for a named '
  'other party -- both halves are required -- plus the named CMBS special '
  'servicers and the named custodial fiduciaries when they lead the name. '
  'DELIBERATE NON-MATCHES, each a live row: a bare "X Bank & Trust Co" is a '
  'community bank that owns its own branch (60 of them); a bare "Trustee" is '
  'usually a PERSON trustee of their own family trust (Leonard Edelman, Trustee; '
  'Tony Martin, Trustee) who under Scott''s 2026-08-19 doctrine IS the owner; '
  '"c/o" is a MAILING artifact, not agency, and the owner is the text before it; '
  'a trailing trust name ("River Bank Associates LLC Wilmington Trust") is a '
  'holding structure on a real owner, which is why (1) is anchored to the start.';

DO $$
DECLARE bad text; n int;
BEGIN
  SELECT string_agg(nm,' | ') INTO bad FROM (VALUES
      ('Cedar Rapids Bank & Trust Co'),('Hills Bank and Trust Co'),
      ('Guaranty Bank & Trust Company'),('First Farmers Bank & Trust Co'),
      ('Branch Banking and Trust Co'),('Bankers Trust Company'),
      ('Leonard Edelman, Trustee'),('Tony Martin, Trustee'),
      ('COLLINS, MARY KATHLEEN TRUSTEE'),('John E Traeger Trustee'),
      ('ELK GROVE TRUST, Winfred Tai, Trustee'),
      ('919 Investments LLC c/o Choice One Development, LLC'),
      ('Allegheny Properties, LLC c/o Ronald Holley at Kingwood address'),
      ('River Bank Associates LLC Wilmington Trust')
    ) v(nm) WHERE public.lcc_owner_name_is_agent(v.nm);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'P152 gate: principal wrongly matched as agent -> %', bad;
  END IF;

  SELECT count(*) INTO n FROM (VALUES
      ('Arch Street Capital Advisors OBO Global Securitization Services'),
      ('RMR Group OBO Government Properties Income Trust'),
      ('CWCapital Asset Management OBO COBALT 2007-C2'),
      ('LASALLE BANK NA; AMERICAN NATIONAL BK & TR CO OF CHICAGO'),
      ('WELLS FARGO BANK NA; HAROLD F HUTTON TRUST'),
      ('CHICAGO TITLE LAND TRUST COMPANY'),
      ('Pensco Trust Company, FBO Shelly R. Dennis IRA'),
      ('HSBC Bank USA, NTNL ASSN Trustee f/MRGN STNLY CAPT''L I INC., COMM MORT. CERTS 2006-HQ9 c/o C-III Asset Management LLC')
    ) v(nm) WHERE NOT public.lcc_owner_name_is_agent(v.nm);
  IF n > 0 THEN RAISE EXCEPTION 'P152 gate: % known agents did NOT match', n; END IF;

  SELECT count(*) INTO n FROM lcc_property_owner o JOIN entities e ON e.id=o.owner_entity_id
   WHERE public.lcc_owner_name_is_agent(e.name);
  IF n > 3 THEN
    RAISE EXCEPTION 'P152 gate: % resolved owners now read as agents (expected the 3 OBO rows)', n;
  END IF;
END $$;

-- Wire into the single owner-writing path, beside the brokerage guard.
-- (Body identical to P148 except for the lcc_owner_name_is_agent clause.)
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
     and not public.lcc_owner_name_is_agent(c.owner_name)          -- P152
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

-- Now that agents can never resolve as owners, correcting their TYPE is safe.
UPDATE public.entities e
   SET entity_type = 'organization',
       metadata = coalesce(e.metadata,'{}'::jsonb)
                || jsonb_build_object('p152_prior_entity_type', e.entity_type::text,
                                      'p152_reason','agent/servicer typed person; P152 guard now blocks ownership')
 WHERE e.entity_type = 'person'
   AND public.lcc_owner_name_is_agent(e.name);

-- ---- P152a: repoint the pre-existing agent-as-owner rows --------------------
CREATE TEMPORARY TABLE _p152a_map ON COMMIT DROP AS
SELECT e.id AS agent_id, e.name AS agent_name, m.id AS principal_id, m.name AS principal_name
  FROM entities e
  JOIN entities m
    ON lower(regexp_replace(m.name,'[^A-Za-z0-9]','','g'))
     = lower(regexp_replace(btrim(regexp_replace(e.name,'^.*\mOBO\M\s*','','i')),'[^A-Za-z0-9]','','g'))
   AND m.id <> e.id
   AND length(regexp_replace(m.name,'[^A-Za-z0-9]','','g')) >= 4   -- material floor
 WHERE lcc_owner_name_is_agent(e.name)
   AND EXISTS (SELECT 1 FROM lcc_property_owner o WHERE o.owner_entity_id = e.id);

-- evidence FIRST: fixing lcc_property_owner alone lets the next reconcile
-- re-elect the agent (CLAUDE.md, P116).
DELETE FROM lcc_property_owner_evidence v USING _p152a_map m
 WHERE v.candidate_owner_entity = m.agent_id
   AND EXISTS (SELECT 1 FROM lcc_property_owner_evidence w
                WHERE w.entity_id = v.entity_id
                  AND w.candidate_owner_entity = m.principal_id
                  AND w.source = v.source);

UPDATE lcc_property_owner_evidence v
   SET candidate_owner_entity = m.principal_id,
       detail = coalesce(v.detail,'{}'::jsonb)
             || jsonb_build_object('p152a_repointed_from_agent', m.agent_name)
  FROM _p152a_map m
 WHERE v.candidate_owner_entity = m.agent_id;

UPDATE lcc_property_owner o
   SET owner_entity_id = m.principal_id,
       owner_name      = m.principal_name,
       detail = coalesce(o.detail,'{}'::jsonb)
             || jsonb_build_object('p152a_repointed_from_agent', m.agent_name)
  FROM _p152a_map m
 WHERE o.owner_entity_id = m.agent_id;
