-- ============================================================================
-- R40 — reconcile historical merge-orphans + consolidate cadence on merge
-- (2026-06-16, LCC Opps only)
--
-- R39 made lcc_merge_entity person-complete, so NEW merges repoint backrefs
-- correctly. But the engine was incomplete historically (it moved only
-- portfolio_facts + external_identities, and NEVER repointed touchpoint_cadence
-- .entity_id), so the 862 historical tombstones left backrefs dangling on dead
-- nodes. Grounded live 2026-06-16:
--   entity_relationships pointing at a tombstone (from_ or to_) : 6,123
--   lcc_entity_portfolio_facts on tombstones                    :    45
--   touchpoint_cadence.entity_id on tombstones                  :    19  (14 of
--       which the final survivor ALSO carries a cadence -> consolidate; 5 -> repoint)
--   activity_events 17 / inbox_items 13 / research_tasks 1
--   external_identities 5
--   lcc_buyer_parents 1 / lcc_operator_affiliate_patterns 3 (all = one clean
--       UIRC duplicate; survivor absent from both registries)
--   merged_into chains (tombstone -> tombstone)                 :     2 (depth 2)
--
-- These don't leak into the priority queue / cadence dashboard (those filter
-- merged_into_entity_id IS NULL) but the entity graph is INACCURATE — anything
-- traversing relationships directly (context packets, MCP, owner->asset rollups)
-- hits dead nodes. R40 reconciles every backref to its FINAL survivor, reversibly.
--
-- Design (single source of truth):
--   * lcc_reconcile_tombstone_backrefs(loser, winner, snapshot) does ALL of the
--     dedup-safe graph repoints (the merge engine's move set + the NEW cadence
--     entity_id consolidate-or-repoint). It is the ONE place "move backrefs to
--     survivor" lives.
--   * lcc_merge_entity now CALLS the helper (byte-identical 2-col return), so the
--     forward merge path inherits cadence consolidation too — no future tombstone
--     leaves a cadence dangling.
--   * lcc_r40_reconcile_merge_orphans(dry_run) is the one-time historical pass:
--     resolves chains to the final survivor (cycle-guarded), loops the helper per
--     tombstone (snapshot=true), reconciles the registry refs, collapses the 2
--     chains. Reversible (every change snapshotted to r40_merge_reconcile_backup);
--     idempotent (re-run finds 0); chain- and cycle-safe; content-dedup so a
--     repoint never creates a duplicate edge.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Reversible backup ledger (mirror R22/R35/R37). Every repoint / dedup-delete /
-- cadence consolidation / chain collapse snapshots the full old row here.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.r40_merge_reconcile_backup (
  id            bigserial PRIMARY KEY,
  reconciled_at timestamptz NOT NULL DEFAULT now(),
  tombstone_id  uuid,
  survivor_id   uuid,
  table_name    text NOT NULL,
  record_pk     text,
  action        text NOT NULL,   -- repoint | dedup_delete | self_loop_delete |
                                  -- cadence_consolidate | cadence_repoint | chain_collapse
  old_row       jsonb,
  new_target    uuid,
  note          text
);

CREATE INDEX IF NOT EXISTS idx_r40_backup_tombstone
  ON public.r40_merge_reconcile_backup (tombstone_id);

-- ---------------------------------------------------------------------------
-- Phase-rank helper for cadence consolidation ("keep the further-along phase").
-- Higher = further along the conversion funnel. Unknown phases rank 0 so the
-- survivor's phase is kept unless the loser is STRICTLY further along.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_cadence_phase_rank(p_phase text)
RETURNS int AS $$
  SELECT CASE lower(coalesce(p_phase, ''))
    WHEN 'converted'    THEN 6
    WHEN 'steady_state' THEN 5
    WHEN 'maintenance'  THEN 4
    WHEN 'buy_side'     THEN 4
    WHEN 'onboarding'   THEN 2
    WHEN 'dormant'      THEN 1
    WHEN 'prospecting'  THEN 1
    ELSE 0
  END;
$$ LANGUAGE sql IMMUTABLE;

-- ---------------------------------------------------------------------------
-- lcc_reconcile_tombstone_backrefs — THE single "move backrefs loser -> winner"
-- routine. Called by both lcc_merge_entity (forward) and the R40 one-time pass.
-- Returns a jsonb of per-table counts. p_snapshot writes the reversible backup
-- (default false for the forward merge -> byte-identical to pre-R40 for moves;
-- cadence consolidation DELETEs always snapshot, since they drop a row).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_reconcile_tombstone_backrefs(
  p_loser uuid, p_winner uuid, p_snapshot boolean DEFAULT false)
RETURNS jsonb AS $$
DECLARE
  c_zero CONSTANT uuid := '00000000-0000-0000-0000-000000000000'::uuid;
  v jsonb := '{}'::jsonb;
  n int;
  v_l record;   -- loser cadence
  v_w record;   -- winner colliding cadence
  v_cad_cons int := 0;
  v_cad_rep  int := 0;
  v_portfolio_moved int := 0;
  v_xids_moved int := 0;
BEGIN
  IF p_loser = p_winner THEN
    RAISE EXCEPTION 'lcc_reconcile_tombstone_backrefs: loser and winner must differ';
  END IF;

  -- == lcc_entity_portfolio_facts (dedup-then-move on (domain, property)) =====
  IF p_snapshot THEN
    INSERT INTO public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row)
    SELECT p_loser, p_winner, 'lcc_entity_portfolio_facts',
           f.source_domain||':'||f.source_property_id, 'dedup_delete', to_jsonb(f.*)
    FROM public.lcc_entity_portfolio_facts f
    WHERE f.entity_id = p_loser AND EXISTS (
      SELECT 1 FROM public.lcc_entity_portfolio_facts w
      WHERE w.entity_id=p_winner AND w.source_domain=f.source_domain AND w.source_property_id=f.source_property_id);
  END IF;
  DELETE FROM public.lcc_entity_portfolio_facts f
  WHERE f.entity_id = p_loser AND EXISTS (
    SELECT 1 FROM public.lcc_entity_portfolio_facts w
    WHERE w.entity_id=p_winner AND w.source_domain=f.source_domain AND w.source_property_id=f.source_property_id);
  IF p_snapshot THEN
    INSERT INTO public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row,new_target)
    SELECT p_loser, p_winner, 'lcc_entity_portfolio_facts',
           f.source_domain||':'||f.source_property_id, 'repoint', to_jsonb(f.*), p_winner
    FROM public.lcc_entity_portfolio_facts f WHERE f.entity_id = p_loser;
  END IF;
  UPDATE public.lcc_entity_portfolio_facts SET entity_id=p_winner, updated_at=now() WHERE entity_id=p_loser;
  GET DIAGNOSTICS n = ROW_COUNT; v_portfolio_moved := n; v := v || jsonb_build_object('portfolio_repointed', n);

  -- == external_identities (dedup-then-move) =================================
  IF p_snapshot THEN
    INSERT INTO public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row)
    SELECT p_loser, p_winner, 'external_identities', x.id::text, 'dedup_delete', to_jsonb(x.*)
    FROM public.external_identities x
    WHERE x.entity_id=p_loser AND EXISTS (
      SELECT 1 FROM public.external_identities w
      WHERE w.entity_id=p_winner AND w.workspace_id=x.workspace_id
        AND w.source_system=x.source_system AND w.source_type=x.source_type AND w.external_id=x.external_id);
  END IF;
  DELETE FROM public.external_identities x
  WHERE x.entity_id=p_loser AND EXISTS (
    SELECT 1 FROM public.external_identities w
    WHERE w.entity_id=p_winner AND w.workspace_id=x.workspace_id
      AND w.source_system=x.source_system AND w.source_type=x.source_type AND w.external_id=x.external_id);
  IF p_snapshot THEN
    INSERT INTO public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row,new_target)
    SELECT p_loser, p_winner, 'external_identities', x.id::text, 'repoint', to_jsonb(x.*), p_winner
    FROM public.external_identities x WHERE x.entity_id=p_loser;
  END IF;
  UPDATE public.external_identities SET entity_id=p_winner WHERE entity_id=p_loser;
  GET DIAGNOSTICS n = ROW_COUNT; v_xids_moved := n; v := v || jsonb_build_object('xids_repointed', n);

  -- == entity_relationships (self-loop drop + both-direction dedup + repoint) ==
  IF p_snapshot THEN
    INSERT INTO public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row)
    SELECT p_loser, p_winner, 'entity_relationships', r.id::text, 'self_loop_delete', to_jsonb(r.*)
    FROM public.entity_relationships r
    WHERE (r.from_entity_id=p_loser AND r.to_entity_id=p_winner)
       OR (r.from_entity_id=p_winner AND r.to_entity_id=p_loser)
       OR (r.from_entity_id=p_loser AND r.to_entity_id=p_loser);
  END IF;
  DELETE FROM public.entity_relationships r
  WHERE (r.from_entity_id=p_loser AND r.to_entity_id=p_winner)
     OR (r.from_entity_id=p_winner AND r.to_entity_id=p_loser)
     OR (r.from_entity_id=p_loser AND r.to_entity_id=p_loser);
  GET DIAGNOSTICS n = ROW_COUNT; v := v || jsonb_build_object('er_selfloop_deleted', n);

  IF p_snapshot THEN
    INSERT INTO public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row)
    SELECT p_loser, p_winner, 'entity_relationships', r.id::text, 'dedup_delete', to_jsonb(r.*)
    FROM public.entity_relationships r
    WHERE r.from_entity_id=p_loser AND EXISTS (
      SELECT 1 FROM public.entity_relationships w WHERE w.from_entity_id=p_winner
        AND w.to_entity_id=r.to_entity_id AND w.relationship_type IS NOT DISTINCT FROM r.relationship_type
        AND w.workspace_id IS NOT DISTINCT FROM r.workspace_id);
  END IF;
  DELETE FROM public.entity_relationships r
  WHERE r.from_entity_id=p_loser AND EXISTS (
    SELECT 1 FROM public.entity_relationships w WHERE w.from_entity_id=p_winner
      AND w.to_entity_id=r.to_entity_id AND w.relationship_type IS NOT DISTINCT FROM r.relationship_type
      AND w.workspace_id IS NOT DISTINCT FROM r.workspace_id);

  IF p_snapshot THEN
    INSERT INTO public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row)
    SELECT p_loser, p_winner, 'entity_relationships', r.id::text, 'dedup_delete', to_jsonb(r.*)
    FROM public.entity_relationships r
    WHERE r.to_entity_id=p_loser AND EXISTS (
      SELECT 1 FROM public.entity_relationships w WHERE w.to_entity_id=p_winner
        AND w.from_entity_id=r.from_entity_id AND w.relationship_type IS NOT DISTINCT FROM r.relationship_type
        AND w.workspace_id IS NOT DISTINCT FROM r.workspace_id);
  END IF;
  DELETE FROM public.entity_relationships r
  WHERE r.to_entity_id=p_loser AND EXISTS (
    SELECT 1 FROM public.entity_relationships w WHERE w.to_entity_id=p_winner
      AND w.from_entity_id=r.from_entity_id AND w.relationship_type IS NOT DISTINCT FROM r.relationship_type
      AND w.workspace_id IS NOT DISTINCT FROM r.workspace_id);

  IF p_snapshot THEN
    INSERT INTO public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row,new_target)
    SELECT p_loser, p_winner, 'entity_relationships', r.id::text, 'repoint', to_jsonb(r.*), p_winner
    FROM public.entity_relationships r WHERE r.from_entity_id=p_loser OR r.to_entity_id=p_loser;
  END IF;
  UPDATE public.entity_relationships SET from_entity_id=p_winner WHERE from_entity_id=p_loser;
  GET DIAGNOSTICS n = ROW_COUNT; v := v || jsonb_build_object('er_from_repointed', n);
  UPDATE public.entity_relationships SET to_entity_id=p_winner WHERE to_entity_id=p_loser;
  GET DIAGNOSTICS n = ROW_COUNT; v := v || jsonb_build_object('er_to_repointed', n);

  -- == watchers (unique on (workspace,user,entity): dedup-then-move) =========
  IF p_snapshot THEN
    INSERT INTO public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row)
    SELECT p_loser, p_winner, 'watchers', w.id::text, 'dedup_delete', to_jsonb(w.*)
    FROM public.watchers w WHERE w.entity_id=p_loser AND EXISTS (
      SELECT 1 FROM public.watchers x WHERE x.entity_id=p_winner
        AND x.workspace_id=w.workspace_id AND x.user_id IS NOT DISTINCT FROM w.user_id);
  END IF;
  DELETE FROM public.watchers w WHERE w.entity_id=p_loser AND EXISTS (
    SELECT 1 FROM public.watchers x WHERE x.entity_id=p_winner
      AND x.workspace_id=w.workspace_id AND x.user_id IS NOT DISTINCT FROM w.user_id);
  IF p_snapshot THEN
    INSERT INTO public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row,new_target)
    SELECT p_loser, p_winner, 'watchers', w.id::text, 'repoint', to_jsonb(w.*), p_winner
    FROM public.watchers w WHERE w.entity_id=p_loser;
  END IF;
  UPDATE public.watchers SET entity_id=p_winner WHERE entity_id=p_loser;
  GET DIAGNOSTICS n = ROW_COUNT; v := v || jsonb_build_object('watchers_repointed', n);

  -- == touchpoint_cadence.contact_id (free text id; never collides on uq) ====
  IF p_snapshot THEN
    INSERT INTO public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row,new_target)
    SELECT p_loser, p_winner, 'touchpoint_cadence.contact_id', c.id::text, 'repoint', to_jsonb(c.*), p_winner
    FROM public.touchpoint_cadence c WHERE c.contact_id=p_loser;
  END IF;
  UPDATE public.touchpoint_cadence SET contact_id=p_winner, updated_at=now() WHERE contact_id=p_loser;
  GET DIAGNOSTICS n = ROW_COUNT; v := v || jsonb_build_object('cadence_contact_repointed', n);

  -- == touchpoint_cadence.entity_id — consolidate-or-repoint (R40 / Unit 2) ===
  -- The uq index uq_cadence_contact_property keys on
  -- (COALESCE(entity_id,zero), COALESCE(property_id,zero), COALESCE(sf_contact_id,'')).
  -- A blind entity_id repoint would 23505 when the winner already carries a
  -- cadence with the same (property,sf) key -> consolidate instead.
  FOR v_l IN SELECT * FROM public.touchpoint_cadence WHERE entity_id = p_loser LOOP
    SELECT * INTO v_w FROM public.touchpoint_cadence w
     WHERE w.entity_id = p_winner
       AND COALESCE(w.property_id, c_zero) = COALESCE(v_l.property_id, c_zero)
       AND COALESCE(w.sf_contact_id, '') = COALESCE(v_l.sf_contact_id, '')
     LIMIT 1;

    IF FOUND THEN
      -- consolidate: fold loser engagement into survivor, then drop loser (always snapshot)
      INSERT INTO public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row,new_target,note)
      VALUES (p_loser, p_winner, 'touchpoint_cadence', v_l.id::text, 'cadence_consolidate',
              to_jsonb(v_l.*), p_winner, 'folded into '||v_w.id::text);

      UPDATE public.touchpoint_cadence SET
        emails_sent        = emails_sent        + v_l.emails_sent,
        emails_opened      = emails_opened      + v_l.emails_opened,
        emails_replied     = emails_replied     + v_l.emails_replied,
        calls_made         = calls_made         + v_l.calls_made,
        calls_connected    = calls_connected    + v_l.calls_connected,
        meetings_scheduled = meetings_scheduled + v_l.meetings_scheduled,
        current_touch      = GREATEST(current_touch, v_l.current_touch),
        last_touch_at      = GREATEST(last_touch_at, v_l.last_touch_at),
        last_touch_type    = COALESCE(last_touch_type, v_l.last_touch_type),
        last_flyer_at      = GREATEST(last_flyer_at, v_l.last_flyer_at),
        last_meeting_at    = GREATEST(last_meeting_at, v_l.last_meeting_at),
        phase = CASE WHEN public.lcc_cadence_phase_rank(v_l.phase) > public.lcc_cadence_phase_rank(phase)
                     THEN v_l.phase ELSE phase END,
        bd_opportunity_id  = COALESCE(bd_opportunity_id, v_l.bd_opportunity_id),
        updated_at = now()
      WHERE id = v_w.id;

      DELETE FROM public.touchpoint_cadence WHERE id = v_l.id;
      v_cad_cons := v_cad_cons + 1;
    ELSE
      IF p_snapshot THEN
        INSERT INTO public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row,new_target)
        VALUES (p_loser, p_winner, 'touchpoint_cadence', v_l.id::text, 'cadence_repoint', to_jsonb(v_l.*), p_winner);
      END IF;
      UPDATE public.touchpoint_cadence SET entity_id = p_winner, updated_at = now() WHERE id = v_l.id;
      v_cad_rep := v_cad_rep + 1;
    END IF;
  END LOOP;
  v := v || jsonb_build_object('cadence_consolidated', v_cad_cons, 'cadence_repointed', v_cad_rep);

  -- == blind repoints (no unique on entity_id) ==============================
  IF p_snapshot THEN
    INSERT INTO public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row,new_target)
    SELECT p_loser, p_winner, 'activity_events', a.id::text, 'repoint', to_jsonb(a.*), p_winner
      FROM public.activity_events a WHERE a.entity_id=p_loser;
    INSERT INTO public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row,new_target)
    SELECT p_loser, p_winner, 'action_items', a.id::text, 'repoint', to_jsonb(a.*), p_winner
      FROM public.action_items a WHERE a.entity_id=p_loser;
    INSERT INTO public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row,new_target)
    SELECT p_loser, p_winner, 'inbox_items', a.id::text, 'repoint', to_jsonb(a.*), p_winner
      FROM public.inbox_items a WHERE a.entity_id=p_loser;
    INSERT INTO public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row,new_target)
    SELECT p_loser, p_winner, 'research_tasks', a.id::text, 'repoint', to_jsonb(a.*), p_winner
      FROM public.research_tasks a WHERE a.entity_id=p_loser;
    INSERT INTO public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row,new_target)
    SELECT p_loser, p_winner, 'entity_aliases', a.id::text, 'repoint', to_jsonb(a.*), p_winner
      FROM public.entity_aliases a WHERE a.entity_id=p_loser;
  END IF;
  UPDATE public.activity_events SET entity_id=p_winner WHERE entity_id=p_loser;
  GET DIAGNOSTICS n = ROW_COUNT; v := v || jsonb_build_object('activity_repointed', n);
  UPDATE public.action_items    SET entity_id=p_winner WHERE entity_id=p_loser;
  GET DIAGNOSTICS n = ROW_COUNT; v := v || jsonb_build_object('action_items_repointed', n);
  UPDATE public.inbox_items     SET entity_id=p_winner WHERE entity_id=p_loser;
  GET DIAGNOSTICS n = ROW_COUNT; v := v || jsonb_build_object('inbox_repointed', n);
  UPDATE public.research_tasks  SET entity_id=p_winner WHERE entity_id=p_loser;
  GET DIAGNOSTICS n = ROW_COUNT; v := v || jsonb_build_object('research_repointed', n);
  UPDATE public.entity_aliases  SET entity_id=p_winner WHERE entity_id=p_loser;
  GET DIAGNOSTICS n = ROW_COUNT; v := v || jsonb_build_object('aliases_repointed', n);

  -- merge-path compatibility aliases (the 2-col lcc_merge_entity return)
  v := v || jsonb_build_object('portfolio_edges_moved', v_portfolio_moved,
                               'external_identities_moved', v_xids_moved);
  RETURN v;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.lcc_reconcile_tombstone_backrefs(uuid,uuid,boolean) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- lcc_merge_entity — now a thin wrapper over the single helper. The 2-col
-- return signature is byte-identical (org auto-merge cron / exact-merge worker /
-- Decision Center merge lane / R39 person-email merges all unaffected), and the
-- forward merge now also consolidates/repoints touchpoint_cadence.entity_id, so
-- no future merge can leave a cadence dangling on a tombstone.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_merge_entity(p_loser uuid, p_winner uuid)
RETURNS TABLE(portfolio_edges_moved int, external_identities_moved int) AS $$
DECLARE
  v jsonb;
BEGIN
  IF p_loser = p_winner THEN
    RAISE EXCEPTION 'lcc_merge_entity: loser and winner must differ';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.entities WHERE id=p_winner) THEN
    RAISE EXCEPTION 'lcc_merge_entity: winner % does not exist', p_winner;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.entities WHERE id=p_loser) THEN
    RAISE EXCEPTION 'lcc_merge_entity: loser % does not exist', p_loser;
  END IF;

  v := public.lcc_reconcile_tombstone_backrefs(p_loser, p_winner, false);

  UPDATE public.entities SET merged_into_entity_id=p_winner, updated_at=now() WHERE id=p_loser;

  portfolio_edges_moved     := (v->>'portfolio_edges_moved')::int;
  external_identities_moved := (v->>'external_identities_moved')::int;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.lcc_merge_entity(uuid, uuid) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- lcc_r40_reconcile_merge_orphans — the one-time historical pass. p_dry_run
-- (default TRUE) reports the per-table dangling counts for review and writes
-- NOTHING. A real run resolves chains to the final survivor, loops the helper
-- (snapshot=true) per tombstone, reconciles the registry refs, collapses chains.
-- Idempotent (re-run finds 0). Returns the per-table report either way.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_r40_reconcile_merge_orphans(p_dry_run boolean DEFAULT true)
RETURNS TABLE(table_name text, rows_affected bigint, detail text, applied boolean) AS $$
DECLARE
  c_zero CONSTANT uuid := '00000000-0000-0000-0000-000000000000'::uuid;
  v_pair record;
  v_er bigint; v_xid bigint; v_pf bigint; v_act bigint; v_inb bigint; v_res bigint;
  v_wat bigint; v_ai bigint; v_al bigint; v_cad bigint; v_cad_cons bigint; v_cad_rep bigint;
  v_bp bigint; v_aff bigint; v_cre bigint; v_chains bigint;
BEGIN
  -- final-survivor resolution (cycle-guarded, depth-capped) into a temp table
  CREATE TEMP TABLE _r40_pairs ON COMMIT DROP AS
  WITH RECURSIVE resolve AS (
    SELECT e.id AS start_id, e.merged_into_entity_id AS cur, 1 AS depth
    FROM public.entities e WHERE e.merged_into_entity_id IS NOT NULL
    UNION ALL
    SELECT r.start_id, e.merged_into_entity_id, r.depth+1
    FROM resolve r JOIN public.entities e ON e.id=r.cur
    WHERE e.merged_into_entity_id IS NOT NULL AND r.depth < 50
  )
  SELECT start_id AS loser, cur AS survivor, depth
  FROM (SELECT start_id, cur, depth, row_number() OVER (PARTITION BY start_id ORDER BY depth DESC) rn FROM resolve) s
  WHERE rn = 1;

  -- guard: every tombstone must resolve to a real, non-tombstone survivor
  IF EXISTS (
    SELECT 1 FROM _r40_pairs p LEFT JOIN public.entities e ON e.id=p.survivor
    WHERE p.survivor IS NULL OR e.id IS NULL OR e.merged_into_entity_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'lcc_r40_reconcile_merge_orphans: unresolved/cyclic survivor detected — aborting';
  END IF;

  -- before-counts for the report (= rows that will be reconciled)
  SELECT count(*) INTO v_er FROM public.entity_relationships r JOIN _r40_pairs p
    ON r.from_entity_id=p.loser OR r.to_entity_id=p.loser;
  SELECT count(*) INTO v_xid FROM public.external_identities x JOIN _r40_pairs p ON x.entity_id=p.loser;
  SELECT count(*) INTO v_pf  FROM public.lcc_entity_portfolio_facts f JOIN _r40_pairs p ON f.entity_id=p.loser;
  SELECT count(*) INTO v_act FROM public.activity_events a JOIN _r40_pairs p ON a.entity_id=p.loser;
  SELECT count(*) INTO v_inb FROM public.inbox_items a JOIN _r40_pairs p ON a.entity_id=p.loser;
  SELECT count(*) INTO v_res FROM public.research_tasks a JOIN _r40_pairs p ON a.entity_id=p.loser;
  SELECT count(*) INTO v_wat FROM public.watchers a JOIN _r40_pairs p ON a.entity_id=p.loser;
  SELECT count(*) INTO v_ai  FROM public.action_items a JOIN _r40_pairs p ON a.entity_id=p.loser;
  SELECT count(*) INTO v_al  FROM public.entity_aliases a JOIN _r40_pairs p ON a.entity_id=p.loser;
  SELECT count(*) INTO v_bp  FROM public.lcc_buyer_parents t JOIN _r40_pairs p ON t.parent_entity_id=p.loser;
  SELECT count(*) INTO v_aff FROM public.lcc_operator_affiliate_patterns t JOIN _r40_pairs p ON t.parent_entity_id=p.loser;
  SELECT count(*) INTO v_cre FROM public.lcc_cre_properties t JOIN _r40_pairs p ON t.owner_entity_id=p.loser;
  SELECT count(*) INTO v_chains FROM _r40_pairs WHERE depth > 1;

  SELECT
    count(*),
    count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM public.touchpoint_cadence w WHERE w.entity_id=p.survivor
        AND COALESCE(w.property_id,c_zero)=COALESCE(c.property_id,c_zero)
        AND COALESCE(w.sf_contact_id,'')=COALESCE(c.sf_contact_id,''))),
    count(*) FILTER (WHERE NOT EXISTS (
      SELECT 1 FROM public.touchpoint_cadence w WHERE w.entity_id=p.survivor
        AND COALESCE(w.property_id,c_zero)=COALESCE(c.property_id,c_zero)
        AND COALESCE(w.sf_contact_id,'')=COALESCE(c.sf_contact_id,'')))
  INTO v_cad, v_cad_cons, v_cad_rep
  FROM public.touchpoint_cadence c JOIN _r40_pairs p ON c.entity_id=p.loser;

  IF NOT p_dry_run THEN
    -- 1) graph backrefs via the single helper (snapshotted)
    FOR v_pair IN SELECT loser, survivor FROM _r40_pairs LOOP
      PERFORM public.lcc_reconcile_tombstone_backrefs(v_pair.loser, v_pair.survivor, true);
    END LOOP;

    -- 2) registry refs (NOT part of the graph move set; bounded one-time clean)
    --    lcc_buyer_parents (PK parent_entity_id): dedup-then-move
    INSERT INTO public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row,new_target)
    SELECT p.loser, p.survivor, 'lcc_buyer_parents', t.parent_entity_id::text,
           CASE WHEN EXISTS (SELECT 1 FROM public.lcc_buyer_parents w WHERE w.parent_entity_id=p.survivor)
                THEN 'dedup_delete' ELSE 'repoint' END,
           to_jsonb(t.*), p.survivor
    FROM public.lcc_buyer_parents t JOIN _r40_pairs p ON t.parent_entity_id=p.loser;
    DELETE FROM public.lcc_buyer_parents t USING _r40_pairs p
     WHERE t.parent_entity_id=p.loser AND EXISTS (SELECT 1 FROM public.lcc_buyer_parents w WHERE w.parent_entity_id=p.survivor);
    UPDATE public.lcc_buyer_parents t SET parent_entity_id=p.survivor, updated_at=now()
      FROM _r40_pairs p WHERE t.parent_entity_id=p.loser;

    --    lcc_operator_affiliate_patterns (PK pattern_id): blind repoint
    INSERT INTO public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row,new_target)
    SELECT p.loser, p.survivor, 'lcc_operator_affiliate_patterns', t.pattern_id::text, 'repoint', to_jsonb(t.*), p.survivor
    FROM public.lcc_operator_affiliate_patterns t JOIN _r40_pairs p ON t.parent_entity_id=p.loser;
    UPDATE public.lcc_operator_affiliate_patterns t SET parent_entity_id=p.survivor
      FROM _r40_pairs p WHERE t.parent_entity_id=p.loser;

    --    lcc_cre_properties.owner_entity_id: blind repoint (0 today, future-proof)
    INSERT INTO public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row,new_target)
    SELECT p.loser, p.survivor, 'lcc_cre_properties', t.id::text, 'repoint', to_jsonb(t.*), p.survivor
    FROM public.lcc_cre_properties t JOIN _r40_pairs p ON t.owner_entity_id=p.loser;
    UPDATE public.lcc_cre_properties t SET owner_entity_id=p.survivor
      FROM _r40_pairs p WHERE t.owner_entity_id=p.loser;

    -- 3) collapse merged_into chains so resolution is direct going forward
    INSERT INTO public.r40_merge_reconcile_backup(tombstone_id,survivor_id,table_name,record_pk,action,old_row,new_target,note)
    SELECT e.id, p.survivor, 'entities', e.id::text, 'chain_collapse', to_jsonb(e.*), p.survivor,
           'merged_into '||e.merged_into_entity_id::text||' -> '||p.survivor::text
    FROM public.entities e JOIN _r40_pairs p ON e.id=p.loser
    WHERE e.merged_into_entity_id IS DISTINCT FROM p.survivor;
    UPDATE public.entities e SET merged_into_entity_id=p.survivor, updated_at=now()
      FROM _r40_pairs p WHERE e.id=p.loser AND e.merged_into_entity_id IS DISTINCT FROM p.survivor;

    -- keep the load-bearing caches honest after the repoints
    PERFORM public.lcc_refresh_priority_queue_resolved();
  END IF;

  RETURN QUERY VALUES
    ('entity_relationships',            v_er,   'self-loop drop + both-direction dedup + repoint', NOT p_dry_run),
    ('external_identities',             v_xid,  'dedup + repoint',                                  NOT p_dry_run),
    ('lcc_entity_portfolio_facts',      v_pf,   'dedup + repoint',                                  NOT p_dry_run),
    ('touchpoint_cadence(entity_id)',   v_cad,  v_cad_cons||' consolidate / '||v_cad_rep||' repoint', NOT p_dry_run),
    ('activity_events',                 v_act,  'repoint',                                          NOT p_dry_run),
    ('inbox_items',                     v_inb,  'repoint',                                          NOT p_dry_run),
    ('research_tasks',                  v_res,  'repoint',                                          NOT p_dry_run),
    ('watchers',                        v_wat,  'dedup + repoint',                                  NOT p_dry_run),
    ('action_items',                    v_ai,   'repoint',                                          NOT p_dry_run),
    ('entity_aliases',                  v_al,   'repoint',                                          NOT p_dry_run),
    ('lcc_buyer_parents',               v_bp,   'registry: dedup + repoint to survivor',            NOT p_dry_run),
    ('lcc_operator_affiliate_patterns', v_aff,  'registry: repoint to survivor',                    NOT p_dry_run),
    ('lcc_cre_properties',              v_cre,  'registry: repoint to survivor',                    NOT p_dry_run),
    ('entities(chain_collapse)',        v_chains,'merged_into -> final survivor',                   NOT p_dry_run);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.lcc_r40_reconcile_merge_orphans(boolean) FROM PUBLIC;

COMMIT;
