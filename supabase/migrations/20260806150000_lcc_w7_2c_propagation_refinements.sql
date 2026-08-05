-- ===========================================================================
-- W7.2c — propagation refinements (milestone collapse · briefing delta ·
-- incremental summaries · reply-SLA). Companion to
-- 20260806140000_lcc_w7_2_deal_comms_propagate.sql. The tick is LIVE
-- (DEAL_COMMS_PROPAGATE_CRON on); every change here is backward-safe against a
-- running consumer and its existing ledger/run-log (additive columns only).
--
-- 1. Milestone same-key COLLAPSE (the Banning finding). Repeat deterministic
--    cues had written one lcc_deal_milestone row PER occurrence date (Banning:
--    6+ 'loi' rows over months). New semantics: FIRST occurrence is THE row; a
--    re-occurrence rolls up into its metadata (occurrence_count / last_seen_on /
--    last_detail_ref / occurrences[≤20]). A stale (>90d) + stage-REGRESSED
--    re-occurrence opens a genuinely new row (a second LOI round after a
--    fell-through deal). The rule is the canonical spec in
--    api/_shared/deal-milestone-collapse.js; lcc_deal_record_milestone() and the
--    one-shot collapse below MIRROR it.
--    ⚠ Return type of lcc_deal_record_milestone changes boolean → jsonb. Safe
--    against the running (old) tick: the old JS checks `data === true`, which is
--    now false, so it merely UNDER-counts milestones_written during the deploy
--    window — the writes (roll-up/insert) still land correctly. New JS ships on
--    the same redeploy.
--
-- 2. Incremental summaries — no schema change (compressed_block /
--    compressed_through_activity_id ride lcc_deal_correspondence_summary.metadata,
--    already jsonb).
--
-- 3. Reply-SLA to-dos — new 'reply_sla' branch on lcc_advance_todos (additive,
--    backward-compatible) + lcc_deal_reply_sla_candidates() reader.
--
-- 4. Run-log: additive columns milestones_rolled_up, reply_overdue_generated.
--
-- Concurrency: lcc_deal_record_milestone and the one-shot collapse both take the
-- SAME per-entity advisory xact lock, so an in-flight tick write and the collapse
-- serialize per deal. Additive · idempotent · reversible. APPLIED LIVE to LCC
-- Opps (xengecqvemvfknjvbvrq).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. Run-log additive columns.
-- ---------------------------------------------------------------------------
ALTER TABLE public.lcc_deal_comms_propagation_run_log
  ADD COLUMN IF NOT EXISTS milestones_rolled_up    integer,
  ADD COLUMN IF NOT EXISTS reply_overdue_generated integer;

-- ---------------------------------------------------------------------------
-- 1a. Canonical stage-rank helper (mirrors deal-milestone-collapse.js STAGE_RANK).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_milestone_stage_rank(p_key text)
RETURNS integer
LANGUAGE sql IMMUTABLE
AS $function$
  SELECT CASE lower(btrim(coalesce(p_key,'')))
    WHEN 'prospecting' THEN 10
    WHEN 'bov'         THEN 20
    WHEN 'ela'         THEN 30
    WHEN 'marketing'   THEN 40
    WHEN 'offers'      THEN 50
    WHEN 'loi'         THEN 60
    WHEN 'psa'         THEN 70
    WHEN 'escrow'      THEN 80
    WHEN 'diligence'   THEN 90
    WHEN 'financing'   THEN 95
    WHEN 'close'       THEN 100
    ELSE 0
  END;
$function$;
GRANT EXECUTE ON FUNCTION public.lcc_milestone_stage_rank(text) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1b. The collapse-aware milestone writer. Returns jsonb
--     { outcome: 'inserted'|'rolled_up'|'new_round'|'noop', id }.
--     STALE_DAYS = 90 (mirrors the JS spec).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.lcc_deal_record_milestone(uuid,text,date,text,text,text,text);
CREATE OR REPLACE FUNCTION public.lcc_deal_record_milestone(
  p_entity     uuid,
  p_key        text,
  p_on         date,
  p_status     text,
  p_summary    text,
  p_source     text DEFAULT 'comms_tick',
  p_detail_ref text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c_stale_days   constant int := 90;
  v_key          text := lower(btrim(coalesce(p_key,'')));
  v_status       text := CASE WHEN p_status IN ('past','now','next') THEN p_status ELSE 'past' END;
  v_source       text := COALESCE(NULLIF(p_source,''),'comms_tick');
  v_prior        public.lcc_deal_milestone%ROWTYPE;
  v_deal_max     int := 0;
  v_key_rank     int;
  v_prior_seen   date;
  v_stale        boolean;
  v_regressed    boolean;
  v_new_id       uuid;
  v_occ          jsonb;
  v_refs         jsonb;
BEGIN
  IF p_entity IS NULL OR v_key = '' THEN
    RETURN jsonb_build_object('outcome','noop','reason','no_key');
  END IF;

  -- Serialize per-deal with the one-shot collapse (same lock key).
  PERFORM pg_advisory_xact_lock(hashtext('lcc_deal_milestone'), hashtext(p_entity::text));

  -- Latest same-key row (the "round" head we might roll into).
  SELECT * INTO v_prior
  FROM public.lcc_deal_milestone
  WHERE entity_id = p_entity AND lower(milestone_key) = v_key
  ORDER BY occurred_on DESC NULLS LAST, created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    INSERT INTO public.lcc_deal_milestone
      (entity_id, milestone_key, occurred_on, status, summary, source, detail_ref, metadata)
    VALUES
      (p_entity, v_key, p_on, v_status, p_summary, v_source, p_detail_ref,
       jsonb_build_object(
         'occurrence_count', 1,
         'first_on', p_on,
         'last_seen_on', p_on,
         'last_detail_ref', p_detail_ref,
         'occurrences', CASE WHEN p_detail_ref IS NULL AND p_on IS NULL THEN '[]'::jsonb
                             ELSE jsonb_build_array(jsonb_build_object('on', p_on, 'detail_ref', p_detail_ref)) END))
    ON CONFLICT (entity_id, milestone_key, COALESCE(occurred_on,'0001-01-01'::date)) DO NOTHING
    RETURNING id INTO v_new_id;
    IF v_new_id IS NOT NULL THEN
      RETURN jsonb_build_object('outcome','inserted','id',v_new_id);
    END IF;
    -- Conflict (exact same date already there) → fall through to roll-up on it.
    SELECT * INTO v_prior FROM public.lcc_deal_milestone
     WHERE entity_id = p_entity AND lower(milestone_key)=v_key
       AND COALESCE(occurred_on,'0001-01-01'::date)=COALESCE(p_on,'0001-01-01'::date)
     LIMIT 1;
  END IF;

  -- Idempotency: this exact evidence already folded in.
  v_refs := COALESCE(v_prior.metadata->'occurrences','[]'::jsonb);
  IF p_detail_ref IS NOT NULL AND (
       v_prior.detail_ref = p_detail_ref
       OR v_prior.metadata->>'last_detail_ref' = p_detail_ref
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_refs) e WHERE e->>'detail_ref' = p_detail_ref)
     ) THEN
    RETURN jsonb_build_object('outcome','noop','id',v_prior.id,'reason','dup_evidence');
  END IF;

  -- Deal's max stage rank (captured BEFORE this write) → regression test.
  SELECT COALESCE(MAX(public.lcc_milestone_stage_rank(milestone_key)),0) INTO v_deal_max
  FROM public.lcc_deal_milestone WHERE entity_id = p_entity;
  v_key_rank   := public.lcc_milestone_stage_rank(v_key);
  v_prior_seen := COALESCE((v_prior.metadata->>'last_seen_on')::date, v_prior.occurred_on);
  v_stale      := v_prior_seen IS NOT NULL AND p_on IS NOT NULL AND (p_on - v_prior_seen) > c_stale_days;
  v_regressed  := v_deal_max > v_key_rank;

  IF v_stale AND v_regressed THEN
    -- Genuinely new round.
    INSERT INTO public.lcc_deal_milestone
      (entity_id, milestone_key, occurred_on, status, summary, source, detail_ref, metadata)
    VALUES
      (p_entity, v_key, p_on, v_status, p_summary, v_source, p_detail_ref,
       jsonb_build_object('occurrence_count',1,'first_on',p_on,'last_seen_on',p_on,
         'last_detail_ref',p_detail_ref,'round','new',
         'occurrences', jsonb_build_array(jsonb_build_object('on',p_on,'detail_ref',p_detail_ref))))
    ON CONFLICT (entity_id, milestone_key, COALESCE(occurred_on,'0001-01-01'::date)) DO NOTHING
    RETURNING id INTO v_new_id;
    RETURN jsonb_build_object('outcome', CASE WHEN v_new_id IS NOT NULL THEN 'new_round' ELSE 'noop' END,'id',v_new_id);
  END IF;

  -- Roll up into the prior row's metadata (bounded occurrences ≤ 20).
  v_occ := v_refs || jsonb_build_array(jsonb_build_object('on', p_on, 'detail_ref', p_detail_ref));
  IF jsonb_array_length(v_occ) > 20 THEN
    v_occ := (SELECT jsonb_agg(e) FROM (
               SELECT e FROM jsonb_array_elements(v_occ) WITH ORDINALITY t(e,ord)
               ORDER BY ord DESC LIMIT 20) s);
  END IF;
  UPDATE public.lcc_deal_milestone SET
    metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
       'occurrence_count', COALESCE((metadata->>'occurrence_count')::int,1) + 1,
       'first_on', COALESCE(metadata->>'first_on', occurred_on::text),
       'last_seen_on', GREATEST(COALESCE((metadata->>'last_seen_on')::date, occurred_on, p_on), COALESCE(p_on, occurred_on)),
       'last_detail_ref', COALESCE(p_detail_ref, metadata->>'last_detail_ref'),
       'occurrences', v_occ),
    updated_at = now()
  WHERE id = v_prior.id;
  RETURN jsonb_build_object('outcome','rolled_up','id',v_prior.id);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.lcc_deal_record_milestone(uuid,text,date,text,text,text,text) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.lcc_deal_record_milestone(uuid,text,date,text,text,text,text) IS
  'W7.2c — collapse-aware milestone writer. Returns {outcome:inserted|rolled_up|new_round|noop,id}. First occurrence = the row; re-occurrence rolls up into metadata unless >90d stale AND stage-regressed (new round). Mirrors api/_shared/deal-milestone-collapse.js. Per-deal advisory-locked with the one-shot collapse.';

-- ---------------------------------------------------------------------------
-- 1c. One-shot COLLAPSE of existing comms_tick duplicates. Keeps the earliest
--     row per (entity, key) round; rolls the rest into its metadata; backs up +
--     deletes the collapsed rows (reversible). Same per-entity advisory lock.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public._lcc_milestone_collapse_20260806_backup (
  LIKE public.lcc_deal_milestone,
  collapsed_into uuid,
  backed_up_at   timestamptz NOT NULL DEFAULT now()
);

DO $collapse$
DECLARE
  r_deal   uuid;
  r_key    text;
  r_head   public.lcc_deal_milestone%ROWTYPE;
  r_row    public.lcc_deal_milestone%ROWTYPE;
  v_deal_max int;
  v_key_rank int;
  v_prior_seen date;
  v_occ    jsonb;
  v_count  int;
BEGIN
  FOR r_deal, r_key IN
    SELECT entity_id, lower(milestone_key)
    FROM public.lcc_deal_milestone
    WHERE source IN ('comms_tick','comms_tick_confirmed')
    GROUP BY entity_id, lower(milestone_key)
    HAVING count(*) > 1
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext('lcc_deal_milestone'), hashtext(r_deal::text));
    v_deal_max := COALESCE((SELECT MAX(public.lcc_milestone_stage_rank(milestone_key))
                            FROM public.lcc_deal_milestone WHERE entity_id = r_deal),0);
    v_key_rank := public.lcc_milestone_stage_rank(r_key);
    r_head := NULL;
    -- Walk rows oldest→newest; each becomes a roll-up on the current round head
    -- unless it is >90d after the head's last_seen AND the deal regressed → new head.
    FOR r_row IN
      SELECT * FROM public.lcc_deal_milestone
      WHERE entity_id = r_deal AND lower(milestone_key) = r_key
        AND source IN ('comms_tick','comms_tick_confirmed')
      ORDER BY occurred_on ASC NULLS FIRST, created_at ASC
    LOOP
      IF r_head.id IS NULL THEN
        r_head := r_row;
        -- normalize the head's metadata occurrence bookkeeping
        UPDATE public.lcc_deal_milestone SET metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
            'occurrence_count', COALESCE((metadata->>'occurrence_count')::int,1),
            'first_on', COALESCE(metadata->>'first_on', occurred_on::text),
            'last_seen_on', COALESCE((metadata->>'last_seen_on')::date, occurred_on),
            'last_detail_ref', COALESCE(metadata->>'last_detail_ref', detail_ref),
            'occurrences', CASE WHEN metadata ? 'occurrences' THEN metadata->'occurrences'
                                WHEN occurred_on IS NULL AND detail_ref IS NULL THEN '[]'::jsonb
                                ELSE jsonb_build_array(jsonb_build_object('on',occurred_on,'detail_ref',detail_ref)) END)
          WHERE id = r_head.id RETURNING * INTO r_head;
        CONTINUE;
      END IF;
      v_prior_seen := COALESCE((r_head.metadata->>'last_seen_on')::date, r_head.occurred_on);
      IF v_prior_seen IS NOT NULL AND r_row.occurred_on IS NOT NULL
         AND (r_row.occurred_on - v_prior_seen) > 90 AND v_deal_max > v_key_rank THEN
        r_head := r_row;   -- new round; leave r_row as its own head
        UPDATE public.lcc_deal_milestone SET metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
            'occurrence_count', COALESCE((metadata->>'occurrence_count')::int,1),
            'first_on', COALESCE(metadata->>'first_on', occurred_on::text),
            'last_seen_on', COALESCE((metadata->>'last_seen_on')::date, occurred_on),
            'last_detail_ref', COALESCE(metadata->>'last_detail_ref', detail_ref),
            'round','new',
            'occurrences', CASE WHEN metadata ? 'occurrences' THEN metadata->'occurrences'
                                ELSE jsonb_build_array(jsonb_build_object('on',occurred_on,'detail_ref',detail_ref)) END)
          WHERE id = r_head.id RETURNING * INTO r_head;
        CONTINUE;
      END IF;
      -- roll r_row into r_head, then back up + delete r_row
      v_occ := COALESCE(r_head.metadata->'occurrences','[]'::jsonb)
               || jsonb_build_array(jsonb_build_object('on', r_row.occurred_on, 'detail_ref', r_row.detail_ref));
      IF jsonb_array_length(v_occ) > 20 THEN
        v_occ := (SELECT jsonb_agg(e) FROM (
                   SELECT e FROM jsonb_array_elements(v_occ) WITH ORDINALITY t(e,ord)
                   ORDER BY ord DESC LIMIT 20) s);
      END IF;
      UPDATE public.lcc_deal_milestone SET metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
          'occurrence_count', COALESCE((metadata->>'occurrence_count')::int,1) + 1,
          'last_seen_on', GREATEST(COALESCE((metadata->>'last_seen_on')::date, occurred_on), COALESCE(r_row.occurred_on, occurred_on)),
          'last_detail_ref', COALESCE(r_row.detail_ref, metadata->>'last_detail_ref'),
          'occurrences', v_occ),
          updated_at = now()
        WHERE id = r_head.id RETURNING * INTO r_head;
      INSERT INTO public._lcc_milestone_collapse_20260806_backup
        SELECT r_row.*, r_head.id, now();
      DELETE FROM public.lcc_deal_milestone WHERE id = r_row.id;
    END LOOP;
  END LOOP;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'W7.2c collapse complete. Backed-up/deleted rows: %', (SELECT count(*) FROM public._lcc_milestone_collapse_20260806_backup);
END;
$collapse$;

-- ---------------------------------------------------------------------------
-- 2. Update lcc_deal_spine milestones jsonb → include occurrence metadata so the
--    dossier can render "LOI — first 2025-02-20, discussed ×6, last 2026-03-31".
--    (CREATE OR REPLACE; only the milestones sub-select changes.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_deal_spine(p_entity uuid)
 returns jsonb
 language sql stable security definer set search_path to 'public'
as $function$
  select jsonb_build_object(
    'entity_id', p_entity,
    'commission', coalesce((
      select jsonb_agg(jsonb_build_object(
        'stage_basis',stage_basis,'direct_pct',direct_pct,'co_broker_pct',co_broker_pct,
        'co_broker_split',co_broker_split,'structure',structure,'fee_amount',fee_amount,
        'executed_date',executed_date,'source',source,'source_doc',source_doc)
        order by executed_date desc nulls last, created_at desc)
      from public.lcc_deal_commission where entity_id = p_entity), '[]'::jsonb),
    'milestones', coalesce((
      select jsonb_agg(jsonb_build_object(
        'milestone_key',milestone_key,'date',occurred_on,'status',status,'summary',summary,
        'source',source,'detail_ref',detail_ref,
        'occurrence_count', COALESCE((metadata->>'occurrence_count')::int, 1),
        'first_on', COALESCE(metadata->>'first_on', occurred_on::text),
        'last_seen_on', COALESCE(metadata->>'last_seen_on', occurred_on::text))
        order by coalesce(sort_order, 999), occurred_on nulls last)
      from public.lcc_deal_milestone where entity_id = p_entity), '[]'::jsonb),
    'diligence', coalesce((
      select jsonb_agg(jsonb_build_object(
        'vendor',vendor,'type',vendor_type,'ordered_date',ordered_date,'site_visit_date',site_visit_date,
        'report_eta',report_eta,'completed_date',completed_date,'lender_required',lender_required,'source',source)
        order by ordered_date nulls last)
      from public.lcc_deal_diligence where entity_id = p_entity), '[]'::jsonb),
    'correspondence_summary', (
      select jsonb_build_object('summary',summary,'topics',topics,'thread_count',thread_count,
        'latest_activity_at',latest_activity_at,'source',source,'generated_at',generated_at)
      from public.v_lcc_deal_correspondence_summary_current where entity_id = p_entity),
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'type',doc_type,'name',name,'date',doc_date,'source',source,'reconciled',reconciled,'detail_ref',detail_ref)
        order by doc_date desc nulls last)
      from public.lcc_deal_document where entity_id = p_entity), '[]'::jsonb),
    'conflicts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'field',field,'values',values,'reconciled',reconciled,'note',note,'status',status)
        order by created_at)
      from public.lcc_deal_conflict where entity_id = p_entity and status = 'open'), '[]'::jsonb)
  );
$function$;

-- ---------------------------------------------------------------------------
-- 3a. Reply-SLA branch on lcc_advance_todos (additive; existing callers unchanged).
--     p_direction='reply_sla' → insert ONE open reply_overdue per deal (guarded),
--     with NO auto-resolution side effects. p_next_action carries the full title.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_advance_todos(
  p_entity_id uuid default null::uuid,
  p_activity_id uuid default null::uuid,
  p_party_entity_id uuid default null::uuid,
  p_channel text default 'email'::text,
  p_direction text default 'outbound'::text,
  p_context text default null::text,
  p_follow_due date default null::date,
  p_owner_user_id uuid default null::uuid,
  p_next_action text default null::text,
  p_next_type text default null::text,
  p_next_due_offset int default null::int
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_ws uuid := 'a0000000-0000-0000-0000-000000000001';
  v_sys uuid := 'b0000000-0000-0000-0000-000000000001';
  v_owner uuid := coalesce(p_owner_user_id, 'b0000000-0000-0000-0000-000000000001');
  v_offer int := 0; v_reach int := 0; v_resolved_await int := 0;
  v_deal text; v_new_id uuid; v_created jsonb := '[]'::jsonb;
  v_prov jsonb;
  v_next_type text;
  v_next_title text;
  v_next_due date;
  v_ai jsonb;
begin
  if p_entity_id is null and p_party_entity_id is null then
    return jsonb_build_object('ok',true,'note','no_anchor');
  end if;
  select name into v_deal from public.entities where id = p_entity_id;
  v_prov := jsonb_build_object('auto_engine',true,'by_activity',p_activity_id,'channel',p_channel,
                               'reversible',true,'at',now());

  if p_direction = 'outbound' then
    update public.action_items ai set status='completed'::action_status,
      metadata = coalesce(ai.metadata,'{}') || v_prov || jsonb_build_object('auto_resolved',true,'auto_resolved_reason','offer_submitted')
     where ai.workspace_id=v_ws and ai.entity_id=p_entity_id and ai.action_type='offer_review' and ai.status='open';
    get diagnostics v_offer = row_count;

    update public.action_items ai set status='completed'::action_status,
      metadata = coalesce(ai.metadata,'{}') || v_prov || jsonb_build_object('auto_resolved',true,'auto_resolved_reason','outreach_touch')
     where ai.workspace_id=v_ws
       and ai.entity_id in (select x from unnest(array[p_entity_id,p_party_entity_id]) x where x is not null)
       and ai.action_type='follow_up' and ai.status in ('open'::action_status,'in_progress'::action_status)
       and coalesce(ai.metadata->>'premise','') not in ('awaiting_seller','awaiting_response');
    get diagnostics v_reach = row_count;

    -- An outbound reply CLEARS an open reply_overdue for this deal (loop closed).
    update public.action_items ai set status='completed'::action_status,
      metadata = coalesce(ai.metadata,'{}') || v_prov || jsonb_build_object('auto_resolved',true,'auto_resolved_reason','reply_sent')
     where ai.workspace_id=v_ws and ai.entity_id=p_entity_id and ai.action_type='reply_overdue'
       and ai.status in ('open'::action_status,'in_progress'::action_status);

    if v_offer > 0 and p_entity_id is not null
       and not exists (select 1 from public.action_items where workspace_id=v_ws and entity_id=p_entity_id
                        and action_type='seller_follow_up' and status in ('open','in_progress')) then
      insert into public.action_items (workspace_id, created_by, owner_id, visibility, action_type, status, title, description,
                                       priority, due_date, entity_id, source_type, metadata)
      values (v_ws, v_sys, v_owner, 'shared', 'seller_follow_up', 'open',
              'Follow up with seller — '||coalesce(v_deal,'deal'),
              coalesce(p_context,'Offer submitted; awaiting seller decision.'),
              'high', coalesce(p_follow_due, current_date + 1), p_entity_id, 'auto_engine',
              v_prov || jsonb_build_object('auto_created',true,'premise','awaiting_seller','context',p_context))
      returning id into v_new_id;
      v_created := jsonb_build_array(jsonb_build_object('id',v_new_id,'action_type','seller_follow_up',
                    'due',coalesce(p_follow_due, current_date+1)));
    end if;

  elsif p_direction = 'reply_sla' then
    -- W7.2c reply-SLA: one open reply_overdue per deal (existence-guarded), no
    -- auto-resolution side effects. p_next_action = the full title.
    if p_entity_id is not null
       and not exists (select 1 from public.action_items where workspace_id=v_ws and entity_id=p_entity_id
                        and action_type='reply_overdue' and status in ('open','in_progress')) then
      insert into public.action_items (workspace_id, created_by, owner_id, visibility, action_type, status, title, description,
                                       priority, due_date, entity_id, source_type, metadata)
      values (v_ws, v_sys, v_owner, 'shared', 'reply_overdue', 'open',
              coalesce(nullif(trim(p_next_action),''), 'Reply overdue — '||coalesce(v_deal,'deal')),
              coalesce(p_context,'Inbound received; no reply sent in over 3 business days.'),
              'high', current_date, p_entity_id, 'auto_engine',
              v_prov || jsonb_build_object('auto_created',true,'premise','reply_overdue',
                                           'sla_business_days',p_next_due_offset,'context',p_context))
      returning id into v_new_id;
      v_created := jsonb_build_array(jsonb_build_object('id',v_new_id,'action_type','reply_overdue','due',current_date));
    end if;

  elsif p_direction = 'inbound' then
    update public.action_items ai set status='completed'::action_status,
      metadata = coalesce(ai.metadata,'{}') || v_prov || jsonb_build_object('auto_resolved',true,'auto_resolved_reason','inbound_reply_received')
     where ai.workspace_id=v_ws
       and ai.entity_id in (select x from unnest(array[p_entity_id,p_party_entity_id]) x where x is not null)
       and ai.action_type in ('seller_follow_up','follow_up')
       and ai.status in ('open'::action_status,'in_progress'::action_status)
       and coalesce(ai.metadata->>'premise','awaiting_seller') in ('awaiting_seller','awaiting_response');
    get diagnostics v_resolved_await = row_count;

    v_next_type  := coalesce(nullif(trim(p_next_type),''), 'review_response');
    v_next_title := coalesce(nullif(trim(p_next_action),''), 'Review seller response & set next step')
                      || ' — ' || coalesce(v_deal,'deal');
    v_next_due   := current_date + coalesce(p_next_due_offset, 0);
    v_ai := case when nullif(trim(p_next_action),'') is not null or nullif(trim(p_next_type),'') is not null
                 then jsonb_build_object('ai_derived',true,'ai_next_action',p_next_action,
                                         'ai_next_type',p_next_type,'ai_due_offset',p_next_due_offset)
                 else jsonb_build_object('ai_derived',false) end;

    if p_entity_id is not null
       and not exists (select 1 from public.action_items where workspace_id=v_ws and entity_id=p_entity_id
                        and action_type=v_next_type and status in ('open','in_progress')) then
      insert into public.action_items (workspace_id, created_by, owner_id, visibility, action_type, status, title, description,
                                       priority, due_date, entity_id, source_type, metadata)
      values (v_ws, v_sys, v_owner, 'shared', v_next_type, 'open',
              v_next_title,
              coalesce(p_context,'Seller replied — read the message and decide the next move.'),
              'high', v_next_due, p_entity_id, 'auto_engine',
              v_prov || v_ai || jsonb_build_object('auto_created',true,'premise','review_inbound','context',p_context))
      returning id into v_new_id;
      v_created := jsonb_build_array(jsonb_build_object('id',v_new_id,'action_type',v_next_type,'due',v_next_due));
    end if;
  end if;

  return jsonb_build_object('ok',true,'direction',p_direction,
    'resolved_offer_review',v_offer,'resolved_reach_follow_up',v_reach,
    'resolved_awaiting',v_resolved_await,'created',v_created);
end $function$;

-- ---------------------------------------------------------------------------
-- 3b. Reply-SLA candidate reader. Open in-scope deals (open bd_opportunity, not
--     paused/on_hold) whose LATEST deal-stamped comm is INBOUND and where more
--     than p_threshold_days BUSINESS days have elapsed since that inbound with
--     no outbound after it. Deterministic; no LLM.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_deal_reply_sla_candidates(
  p_threshold_days int DEFAULT 3,
  p_limit          int DEFAULT 200
)
RETURNS TABLE (
  entity_id       uuid,
  deal_name       text,
  last_inbound_at timestamptz,
  last_sender     text,
  business_days   int
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH stamped AS (
    SELECT
      COALESCE(ae.entity_id, NULLIF(ae.metadata->>'deal_entity_id','')::uuid) AS deal_entity_id,
      ae.occurred_at,
      CASE
        WHEN NULLIF(ae.metadata->>'direction','') IS NOT NULL THEN (ae.metadata->>'direction')
        WHEN eb.is_sent IS TRUE THEN 'outbound'
        WHEN eb.is_sent IS FALSE THEN 'inbound'
        ELSE NULL
      END AS direction,
      COALESCE(NULLIF(ae.metadata->>'from',''), eb.from_name, eb.from_email) AS sender
    FROM public.activity_events ae
    LEFT JOIN public.email_bodies eb ON eb.id = NULLIF(ae.metadata->>'source_email_id','')::uuid
    WHERE (ae.source_type = 'lcc:deal_match' OR (ae.metadata->>'deal_entity_id') IS NOT NULL)
      AND COALESCE(ae.entity_id, NULLIF(ae.metadata->>'deal_entity_id','')::uuid) IS NOT NULL
      AND ae.occurred_at IS NOT NULL
  ),
  latest AS (
    SELECT DISTINCT ON (deal_entity_id)
      deal_entity_id, occurred_at, direction, sender
    FROM stamped
    ORDER BY deal_entity_id, occurred_at DESC
  ),
  open_deals AS (   -- in-scope = has an OPEN bd_opportunity, not paused/on_hold
    SELECT DISTINCT entity_id
    FROM public.bd_opportunities
    WHERE is_open = true AND entity_id IS NOT NULL
      AND coalesce(stage,'') !~* '(on[ _-]?hold|paused|dead|abandon)'
  )
  SELECT
    l.deal_entity_id AS entity_id,
    (SELECT e.name FROM public.entities e WHERE e.id = l.deal_entity_id) AS deal_name,
    l.occurred_at AS last_inbound_at,
    l.sender AS last_sender,
    (SELECT count(*)::int FROM generate_series(
        (l.occurred_at AT TIME ZONE 'UTC')::date + 1, (now() AT TIME ZONE 'UTC')::date, interval '1 day') d
      WHERE extract(dow from d) NOT IN (0,6)) AS business_days
  FROM latest l
  JOIN open_deals od ON od.entity_id = l.deal_entity_id
  WHERE l.direction = 'inbound'
    AND (SELECT count(*) FROM generate_series(
          (l.occurred_at AT TIME ZONE 'UTC')::date + 1, (now() AT TIME ZONE 'UTC')::date, interval '1 day') d
         WHERE extract(dow from d) NOT IN (0,6)) > GREATEST(0, COALESCE(p_threshold_days,3))
  ORDER BY l.occurred_at ASC
  LIMIT GREATEST(1, COALESCE(p_limit,200));
$function$;
GRANT EXECUTE ON FUNCTION public.lcc_deal_reply_sla_candidates(int,int) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.lcc_deal_reply_sla_candidates(int,int) IS
  'W7.2c — open in-scope deals whose latest deal-stamped comm is inbound with >N business days elapsed and no outbound since. Feeds the tick reply-SLA generator (reply_overdue to-dos).';

-- ===========================================================================
-- REVERSAL RUNBOOK
--   -- restore collapsed milestone rows:
--   INSERT INTO public.lcc_deal_milestone
--     SELECT (b.*)::public.lcc_deal_milestone.*  -- (drop collapsed_into/backed_up_at)
--     FROM public._lcc_milestone_collapse_20260806_backup b;  -- see column list
--   DROP TABLE IF EXISTS public._lcc_milestone_collapse_20260806_backup;
--   -- revert the writer to the boolean version (20260806140000) + spine + advance_todos:
--   --   re-run the relevant CREATE OR REPLACE bodies from the prior migrations.
--   DROP FUNCTION IF EXISTS public.lcc_deal_reply_sla_candidates(int,int);
--   DROP FUNCTION IF EXISTS public.lcc_milestone_stage_rank(text);
--   ALTER TABLE public.lcc_deal_comms_propagation_run_log
--     DROP COLUMN IF EXISTS milestones_rolled_up, DROP COLUMN IF EXISTS reply_overdue_generated;
--   -- reply_overdue to-dos: DELETE FROM action_items WHERE action_type='reply_overdue' AND source_type='auto_engine';
-- ===========================================================================
