-- ============================================================================
-- R64 Unit 3 — auto-resolve the mechanically-SAFE Decision-Center verdicts
-- (2026-06-23). Producer/Consumer invariant #2: a scheduled sweep auto-resolves
-- the high-confidence subset, leaving only genuine judgment calls for a human.
--
-- Two lanes auto-resolve; confirm_true_owner stays HUMAN (too risky to
-- auto-confirm ownership — the deliberate exception).
--
--   sf_link_collision  — a 2-entity collision whose two entities normalize to the
--     SAME owner name (a true duplicate: one SF Account id sitting on a second
--     shell of the same owner) → auto-MERGE the sf_linked entity INTO the
--     domain-owner entity (lcc_merge_entity moves the SF id onto the bridged
--     owner). A distinct-name or >2-entity collision is a real "which owner?"
--     question → LEFT OPEN for a human.
--   map_sf_parent_account — the parent entity ALREADY carries exactly ONE
--     salesforce Account identity in the entity graph but
--     lcc_buyer_parents.sf_account_id is null (a pure wiring gap — no SF lookup
--     needed) → auto-MAP it + clear needs_sf_mapping (releasing the held
--     government_buyer sync). 0 or >1 candidates → LEFT OPEN.
--
-- Isolated from lcc_refresh_decisions (R7 Phase-1 isolation pattern): this
-- function MERGES entities, so a failure must never break the auth-critical
-- refresh sweep. Dry-run default TRUE; reversible (merge tombstones the loser via
-- merged_into_entity_id, exactly like a manual merge verdict; the map records the
-- prior needs_sf_mapping in effects); idempotent (resolved rows leave 'open', a
-- merged collision no longer exists, a mapped parent has needs_sf_mapping=false so
-- lcc_refresh_decisions won't re-seed it).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.lcc_r64_auto_resolve_decisions(p_dry_run boolean DEFAULT true)
RETURNS TABLE(lane text, candidates integer, resolved integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_coll_cand int := 0; v_coll_done int := 0;
  v_map_cand  int := 0; v_map_done  int := 0;
  v_winner uuid; v_loser uuid;
  v_sfid text; v_cnt int; v_prev_sf text; v_prev_need boolean;
BEGIN
  -- ── sf_link_collision: same-owner duplicate → auto-merge ──────────────────
  FOR r IN
    SELECT d.id,
           (d.context->'entities'->0->>'entity_id')::uuid AS e0,
           (d.context->'entities'->1->>'entity_id')::uuid AS e1,
           (d.context->'entities'->0->>'source')          AS s0,
           (d.context->'entities'->1->>'source')          AS s1
    FROM public.lcc_decisions d
    WHERE d.decision_type='sf_link_collision' AND d.status='open'
      AND jsonb_array_length(d.context->'entities') = 2
      AND lcc_normalize_entity_name(d.context->'entities'->0->>'name')
        = lcc_normalize_entity_name(d.context->'entities'->1->>'name')
      AND ((d.context->'entities'->0->>'source'='domain_owner')
           <> (d.context->'entities'->1->>'source'='domain_owner'))
  LOOP
    IF r.s0='domain_owner' THEN v_winner:=r.e0; v_loser:=r.e1;
    ELSE                        v_winner:=r.e1; v_loser:=r.e0; END IF;
    -- both must be live (not tombstoned) and distinct
    CONTINUE WHEN v_winner IS NULL OR v_loser IS NULL OR v_winner=v_loser;
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM public.entities e WHERE e.id=v_winner AND e.merged_into_entity_id IS NULL);
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM public.entities e WHERE e.id=v_loser  AND e.merged_into_entity_id IS NULL);
    v_coll_cand := v_coll_cand + 1;
    IF NOT p_dry_run THEN
      PERFORM public.lcc_merge_entity(v_loser, v_winner);
      UPDATE public.lcc_decisions SET
        verdict='auto_merge', status='decided',
        verdict_payload=jsonb_build_object('winner_entity_id',v_winner,
          'loser_entity_ids',jsonb_build_array(v_loser),'auto',true),
        effects=jsonb_build_object('lcc_merge_entity','merged',
          'merged',jsonb_build_array(v_loser),'auto_resolved',true,
          'reason','same_owner_sf_collision'),
        decided_at=now(), updated_at=now()
      WHERE id=r.id;
      v_coll_done := v_coll_done + 1;
    END IF;
  END LOOP;

  -- ── map_sf_parent_account: existing single SF Account identity → auto-map ──
  FOR r IN
    SELECT d.id, d.subject_entity_id AS pid
    FROM public.lcc_decisions d
    WHERE d.decision_type='map_sf_parent_account' AND d.status='open'
  LOOP
    SELECT count(*), min(t.external_id) INTO v_cnt, v_sfid
    FROM (
      SELECT DISTINCT ei.external_id
      FROM public.external_identities ei
      WHERE ei.entity_id=r.pid AND ei.source_system='salesforce'
        AND ei.source_type='Account' AND ei.external_id IS NOT NULL
    ) t;
    SELECT bp.sf_account_id, bp.needs_sf_mapping INTO v_prev_sf, v_prev_need
    FROM public.lcc_buyer_parents bp WHERE bp.parent_entity_id=r.pid;
    CONTINUE WHEN v_cnt <> 1 OR v_prev_sf IS NOT NULL;
    v_map_cand := v_map_cand + 1;
    IF NOT p_dry_run THEN
      UPDATE public.lcc_buyer_parents
        SET sf_account_id=v_sfid, needs_sf_mapping=false, updated_at=now()
        WHERE parent_entity_id=r.pid;
      UPDATE public.lcc_decisions SET
        verdict='auto_map', status='decided',
        verdict_payload=jsonb_build_object('sf_account_id',v_sfid,'auto',true),
        effects=jsonb_build_object('lcc_buyer_parents','mapped','sf_account_id',v_sfid,
          'prev_needs_sf_mapping',v_prev_need,'auto_resolved',true,
          'reason','existing_sf_identity'),
        decided_at=now(), updated_at=now()
      WHERE id=r.id;
      v_map_done := v_map_done + 1;
    END IF;
  END LOOP;

  RETURN QUERY VALUES
    ('sf_link_collision', v_coll_cand, v_coll_done),
    ('map_sf_parent_account', v_map_cand, v_map_done);
END;
$function$;

REVOKE ALL ON FUNCTION public.lcc_r64_auto_resolve_decisions(boolean) FROM anon, authenticated;

-- Gentle scheduled sweep (every 6h at :40 — artifact-offload connection-budget
-- lesson; the forward volume is tiny). Idempotent unschedule-then-schedule.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    PERFORM cron.unschedule('lcc-decision-auto-resolve')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='lcc-decision-auto-resolve');
    PERFORM cron.schedule('lcc-decision-auto-resolve', '40 */6 * * *',
      $job$SELECT public.lcc_r64_auto_resolve_decisions(false);$job$);
  END IF;
END
$cron$;
