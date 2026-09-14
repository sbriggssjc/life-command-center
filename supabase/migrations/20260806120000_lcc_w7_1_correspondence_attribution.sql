-- ============================================================================
-- W7.1 — Deal-correspondence attribution goes LIVE
-- Wave 7, unit 1. See docs/architecture/WAVE7_COMMS_CONTEXT_PROPAGATION_PLAN.md
--                 + docs/architecture/correspondence-ingestion-design.md
-- ----------------------------------------------------------------------------
-- Three additive pieces (safe to apply before the JS deploy — deploy-ordering
-- doctrine: additive schema first):
--   1. lcc_resolve_contact — now maps a counterparty to the DEAL via the
--      AUTHORITATIVE deal_party roster (email_derived + sf_opp_team edges) and
--      metadata.primary_contact, not only via a prior body-mention. This is the
--      §B ongoing-capture gap: a known deal party self-stamps deal_entity_id at
--      INGEST time (both handleOutlookSent and logInboundCorrespondenceDualAnchor
--      read primary_deal), so new mail on a known thread no longer waits for the
--      matcher pass.
--   2. lcc_deal_match_run_log — observability ledger for the recurring matcher
--      cron (one row per run: scanned/attributed/deduped/roster_edges/errors).
--   3. feature_flags_registry row for the matcher cron gate (DEAL_EMAIL_MATCH).
--
-- NO destructive change. lcc_resolve_contact stays STABLE + fill-only in intent
-- (it only READS). Idempotent (CREATE OR REPLACE / IF NOT EXISTS / ON CONFLICT).
-- ============================================================================

-- 1. ── lcc_resolve_contact: add the deal_party-roster + primary_contact path ──
CREATE OR REPLACE FUNCTION public.lcc_resolve_contact(p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ws uuid := 'a0000000-0000-0000-0000-000000000001';
  v_eid uuid; v_name text; v_conf text := null; v_deals jsonb := '[]'::jsonb; v_primary text;
  v_email text := lower(trim(coalesce(p_email,'')));
  v_phone text := regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
begin
  -- PARTY (relationship) resolution: the person/org is the durable BD unit, spanning all their deals.
  if v_email <> '' then
    select id, name into v_eid, v_name from public.entities where entity_type='person' and lower(email)=v_email limit 1;
    if v_eid is null then
      select ei.entity_id into v_eid from public.external_identities ei
        where ei.source_system='outlook' and lower(ei.external_id)=v_email limit 1;
    end if;
    if v_eid is not null then v_conf := 'high'; end if;
  end if;
  if v_eid is null and length(v_phone) >= 10 then
    select ei.entity_id into v_eid from public.external_identities ei
      where ei.source_system='webex' and right(regexp_replace(ei.external_id,'[^0-9]','','g'),10)=right(v_phone,10) limit 1;
    if v_eid is null then
      select id, name into v_eid, v_name from public.entities
        where entity_type='person' and right(regexp_replace(coalesce(phone,''),'[^0-9]','','g'),10)=right(v_phone,10) limit 1;
    end if;
    if v_eid is not null then v_conf := coalesce(v_conf,'medium'); end if;
  end if;
  if v_eid is not null and v_name is null then select name into v_name from public.entities where id=v_eid; end if;

  -- DEALS (sub-contexts): OPEN deals first (active BD), then closed (retained history). Transactional lifecycle:
  -- BD attention rides the OPEN deal; a closed deal stays as history but is not the active next-step anchor.
  --
  -- W7.1: the deal set is the UNION of two evidences, deduped by deal entity id —
  --   (a) ROSTER (authoritative): the resolved PARTY is a deal_party of the deal
  --       (email_derived / sf_opp_team edge → from_entity_id is the deal asset),
  --       OR is the deal's metadata.primary_contact. This is what lets a known
  --       counterparty self-stamp its deal at INGEST time without a body-mention.
  --   (b) MAIL (prior behaviour): the counterparty email appears in a logged
  --       activity that ties to a deal by entity or the city bridge.
  with roster as (
    select bo.entity_id as id, o.name, bo.is_open, bo.stage, now() as last_seen
    from public.bd_opportunities bo
    join public.entities o on o.id=bo.entity_id
    where bo.workspace_id=v_ws and v_eid is not null and (
        exists (select 1 from public.entity_relationships r
                where r.workspace_id=v_ws and r.relationship_type='deal_party'
                  and r.from_entity_id=bo.entity_id and r.to_entity_id=v_eid)
        or (bo.metadata->>'primary_contact') = v_eid::text
    )
  ),
  mail as (
    select distinct a.title, a.entity_id, a.occurred_at
    from public.activity_events a
    where a.workspace_id=v_ws and v_email <> '' and a.body ilike '%'||v_email||'%'
  ),
  mail_deals as (
    select e.id, e.name, bool_or(o.is_open) as is_open, (array_agg(o.stage order by o.is_open desc))[1] as stage,
           max(m.occurred_at) as last_seen
    from public.bd_opportunities o
    join public.entities e on e.id=o.entity_id
    join mail m on (m.entity_id=e.id or (e.city is not null and length(e.city)>=4 and m.title ilike '%'||e.city||'%'))
    where o.workspace_id=v_ws
    group by e.id, e.name
  ),
  combined as (
    select id, name,
           bool_or(is_open) as is_open,
           (array_agg(stage order by (is_open) desc nulls last))[1] as stage,
           max(last_seen) as last_seen
    from (
      select id, name, is_open, stage, last_seen from roster
      union all
      select id, name, is_open, stage, last_seen from mail_deals
    ) u
    group by id, name
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'entity_id',c.id,'name',c.name,'is_open',c.is_open,'stage',c.stage)
           order by c.is_open desc nulls last, c.last_seen desc nulls last),'[]'::jsonb)
    into v_deals
  from (select * from combined limit 20) c;

  -- primary_deal = the first OPEN deal (active BD); null if only closed deals exist (attention is at the party).
  select (d->>'entity_id') into v_primary
  from jsonb_array_elements(v_deals) d where (d->>'is_open')::boolean is true limit 1;

  return jsonb_build_object(
    'ok', (v_eid is not null or v_deals <> '[]'::jsonb),
    'party_entity_id', v_eid, 'party_name', v_name, 'confidence', v_conf,
    'deals', v_deals,
    'primary_deal', v_primary,                       -- OPEN deal only (active BD anchor)
    'has_open_deal', (v_primary is not null)
  );
end $function$;

-- 2. ── matcher run-log (observability ledger for the recurring cron) ─────────
CREATE TABLE IF NOT EXISTS public.lcc_deal_match_run_log (
  run_id            bigserial PRIMARY KEY,
  ran_at            timestamptz NOT NULL DEFAULT now(),
  trigger_source    text,                    -- 'cron' | 'manual' | 'api'
  dry_run           boolean NOT NULL DEFAULT false,
  deals_scanned     integer,
  deals_with_matches integer,
  emails_attributed integer,
  already_attributed integer,
  roster_edges      integer,
  digest_excluded   integer,
  skipped_thin      integer,
  error_count       integer NOT NULL DEFAULT 0,
  ok                boolean NOT NULL DEFAULT true,
  detail            jsonb
);
COMMENT ON TABLE public.lcc_deal_match_run_log IS
  'W7.1 — one row per deal-email-matcher run (cron/manual). Feeds the propagation-freshness / loud-failure checks.';

-- 3. ── feature-flag registry: the matcher-cron gate (inert until Scott flips) ─
INSERT INTO public.feature_flags_registry (flag, purpose, surface, env_var, state, off_since, owner, notes)
VALUES (
  'DEAL_EMAIL_MATCH_CRON',
  'Hourly recurring run of the deal-email matcher (attributes Outlook mail to open deals by core-tenant + city).',
  'api/_handlers/deal-email-match-cron.js (cron /api/pipeline/match-deal-emails-cron)',
  'DEAL_EMAIL_MATCH_ENABLED',
  'off', now(), 'scott',
  'W7.1. pg_cron job lcc-deal-email-match posts hourly; the handler no-ops until DEAL_EMAIL_MATCH_ENABLED is set in Railway. Flip to on after Scott approves the dry-run report (docs/architecture/W7_1_deal_email_match_dryrun_2026-08-06.md).'
)
ON CONFLICT (flag) DO UPDATE SET
  purpose=EXCLUDED.purpose, surface=EXCLUDED.surface, env_var=EXCLUDED.env_var, notes=EXCLUDED.notes;

-- 4. ── recurring cron (hourly). Inert until DEAL_EMAIL_MATCH_ENABLED is set:
--       the handler no-ops on the flag, so scheduling now is safe. cron.schedule
--       upserts by jobname (pg_cron >= 1.4), so this is idempotent.
SELECT cron.schedule(
  'lcc-deal-email-match', '17 * * * *',
  $$SELECT public.lcc_cron_post('/api/pipeline/match-deal-emails-cron', '{}'::jsonb, 'vercel')$$
);
