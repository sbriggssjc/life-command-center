-- REVIEW-LANES1 (2026-09-25) — three LCC Opps review queues get the writer a human verdict goes
-- through, an undo, a safe auto-resolver, and a backlog health metric.
--
-- Every recent accuracy round correctly sent ambiguous cases to review instead of guessing. None of
-- those queues had a place Scott could act. The Decision Center lanes (api/admin.js
-- REVIEW_LANES1_TYPES) call the functions below. Nothing here decides on its own except the
-- auto-resolvers, and they only take classes where the question is already answered.
--
-- 1. gov owner → hub contact review (lcc_gov_owner_unification_review, CONTACTS-GOV-WRITER).
--      lcc_decide_gov_owner_review(review, decision, by)
--        link                → the tick's own link write (candidate must still be unlinked)
--        create              → the tick's own create write (a new business contact)
--        already_represented → no write; a hub contact already stands for this company
--        not_same            → no write; dismissed
--      lcc_undo_gov_owner_review(review, by) — reverses the write and reopens the review.
--      lcc_autoresolve_gov_owner_reviews(dry_run) — owner_now_linked / owner_merged_away /
--        already_represented_by_duplicate_gov_owner (candidate linked to a LIVE gov owner with the
--        same company_canonical_key and no state conflict). Measured 2026-09-25: 88 of the 94
--        'unified_row_already_linked' reviews fall in that class; the other 6 do not.
--      The tick no longer re-queues an owner whose review was decided (open OR decided rows now
--        exclude it). Before this, resolving a review would have re-minted it within 30 minutes.
-- 2. asset → property relink (lcc_asset_property_link_resolution, MERGELOG-GAP candidates).
--      lcc_decide_asset_property_link(ledger, decision, kept, by)
--        relink   → lcc_repoint_entity_property_id(domain, kept, dropped); kept must be one of the
--                   evidence candidates; the Not-on-file flag is lifted; the research task completes
--        no_match → no write; research task skipped
--      lcc_undo_asset_property_link(ledger, by) — lcc_unrepoint_entity_property_id + restore.
-- 3. contacts-hub conflict (merge_follow_conflict rows in lcc_gov_owner_contact_link_log).
--      repoint_to_survivor → moves the tombstone contact onto the survivor owner (only when no other
--                            hub contact holds the survivor); undo moves it back.
--      merge               → api/_handlers/contacts-handler.js mergeUnifiedContacts (the contact
--                            merge path). lcc_snapshot_contact_conflict_merge() captures both rows,
--                            the dropped contact's change-log ids and merge-queue rows first;
--                            lcc_undo_contact_conflict_merge() puts them back.
--      keep_both           → record only (lcc_decisions).
-- 4. Backlog health: lcc_record_review_lane_backlog(rows) logs each lane's open count and opens
--    lcc_health_alerts('review_lane_backlog') when a lane has open work and nobody decided anything
--    in it for 14 days; it auto-resolves when the lane is empty or someone decides.

BEGIN;

-- ------------------------------------------------------------------ 1. owner reviews -------------
ALTER TABLE public.lcc_gov_owner_unification_review ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
ALTER TABLE public.lcc_gov_owner_unification_review ADD COLUMN IF NOT EXISTS decided_by text;
ALTER TABLE public.lcc_gov_owner_unification_review ADD COLUMN IF NOT EXISTS resolution jsonb;

ALTER TABLE public.lcc_gov_owner_contact_link_log DROP CONSTRAINT IF EXISTS lcc_gov_owner_contact_link_log_action_check;
ALTER TABLE public.lcc_gov_owner_contact_link_log ADD CONSTRAINT lcc_gov_owner_contact_link_log_action_check
  CHECK (action IN ('created', 'linked', 'merge_follow_repoint', 'merge_follow_conflict',
                    'review_unlinked', 'review_deleted', 'conflict_repoint', 'conflict_unrepoint'));

CREATE OR REPLACE FUNCTION public.lcc_decide_gov_owner_review(
  p_review_id bigint, p_decision text, p_decided_by text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE
  r record; u record; o record; v_batch text := 'owner_review_' || p_review_id; v_new uuid;
BEGIN
  SELECT * INTO r FROM public.lcc_gov_owner_unification_review WHERE review_id = p_review_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'review_not_found'); END IF;
  IF r.status <> 'open' THEN RETURN jsonb_build_object('ok', false, 'error', 'review_not_open', 'status', r.status); END IF;

  IF p_decision = 'link' THEN
    SELECT * INTO u FROM public.unified_contacts WHERE unified_id = r.candidate_unified_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'candidate_not_found'); END IF;
    IF u.recorded_owner_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'candidate_already_linked',
                                'linked_to', u.recorded_owner_id);
    END IF;
    UPDATE public.unified_contacts SET recorded_owner_id = r.recorded_owner_id,
           match_method = coalesce(match_method, '') || '|linked_gov_owner_review',
           match_confidence = greatest(coalesce(match_confidence, 0), coalesce(r.match_score, 0)),
           field_sources = coalesce(field_sources, '{}'::jsonb)
                           || jsonb_build_object('recorded_owner_id', 'gov.recorded_owners',
                                                 '_contacts_gov_writer', v_batch)
     WHERE unified_id = u.unified_id;
    INSERT INTO public.lcc_gov_owner_contact_link_log (batch, action, unified_id, recorded_owner_id, prior_match_method, detail)
    VALUES (v_batch, 'linked', u.unified_id, r.recorded_owner_id, u.match_method,
            jsonb_build_object('prior_match_confidence', u.match_confidence, 'prior_field_sources', u.field_sources));
    UPDATE public.lcc_gov_owner_unification_review
       SET status = 'resolved', resolved_at = now(), decided_by = p_decided_by,
           resolution = jsonb_build_object('decision', 'link', 'at', now(), 'unified_id', u.unified_id,
                                           'batch', v_batch, 'prior_match_method', u.match_method,
                                           'prior_match_confidence', u.match_confidence,
                                           'prior_field_sources', u.field_sources)
     WHERE review_id = p_review_id;
    RETURN jsonb_build_object('ok', true, 'decision', 'link', 'unified_id', u.unified_id);

  ELSIF p_decision = 'create' THEN
    IF EXISTS (SELECT 1 FROM public.unified_contacts WHERE recorded_owner_id = r.recorded_owner_id) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'owner_already_linked');
    END IF;
    SELECT * INTO o FROM public.lcc_gov_recorded_owner_mirror WHERE recorded_owner_id = r.recorded_owner_id;
    INSERT INTO public.unified_contacts (contact_class, company_name, state, recorded_owner_id,
           match_method, match_confidence, field_sources, created_at, updated_at)
    VALUES ('business', coalesce(o.name, r.owner_name), o.state, r.recorded_owner_id, 'new_from_gov_owner_review', 0.5,
            jsonb_build_object('recorded_owner_id', 'gov.recorded_owners', '_contacts_gov_writer', v_batch),
            now(), now())
    RETURNING unified_id INTO v_new;
    INSERT INTO public.lcc_gov_owner_contact_link_log (batch, action, unified_id, recorded_owner_id)
    VALUES (v_batch, 'created', v_new, r.recorded_owner_id);
    UPDATE public.lcc_gov_owner_unification_review
       SET status = 'resolved', resolved_at = now(), decided_by = p_decided_by,
           resolution = jsonb_build_object('decision', 'create', 'at', now(), 'unified_id', v_new, 'batch', v_batch)
     WHERE review_id = p_review_id;
    RETURN jsonb_build_object('ok', true, 'decision', 'create', 'unified_id', v_new);

  ELSIF p_decision IN ('already_represented', 'not_same') THEN
    UPDATE public.lcc_gov_owner_unification_review
       SET status = CASE p_decision WHEN 'not_same' THEN 'dismissed' ELSE 'resolved' END,
           resolved_at = now(), decided_by = p_decided_by,
           resolution = jsonb_build_object('decision', p_decision, 'at', now(),
                                           'candidate_unified_id', r.candidate_unified_id)
     WHERE review_id = p_review_id;
    RETURN jsonb_build_object('ok', true, 'decision', p_decision);
  END IF;
  RETURN jsonb_build_object('ok', false, 'error', 'unknown_decision', 'decision', p_decision);
END
$fn$;

CREATE OR REPLACE FUNCTION public.lcc_undo_gov_owner_review(p_review_id bigint, p_undone_by text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE r record; u record; v_dec text; v_uid uuid; v_n int := 0;
BEGIN
  SELECT * INTO r FROM public.lcc_gov_owner_unification_review WHERE review_id = p_review_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'review_not_found'); END IF;
  IF r.status = 'open' THEN RETURN jsonb_build_object('ok', false, 'error', 'review_not_decided'); END IF;
  v_dec := r.resolution->>'decision';
  v_uid := nullif(r.resolution->>'unified_id', '')::uuid;

  IF v_dec = 'link' THEN
    UPDATE public.unified_contacts
       SET recorded_owner_id = NULL,
           match_method = r.resolution->>'prior_match_method',
           match_confidence = (r.resolution->>'prior_match_confidence')::numeric,
           field_sources = r.resolution->'prior_field_sources'
     WHERE unified_id = v_uid AND recorded_owner_id = r.recorded_owner_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'link_no_longer_in_place'); END IF;
    INSERT INTO public.lcc_gov_owner_contact_link_log (batch, action, unified_id, recorded_owner_id)
    VALUES (r.resolution->>'batch', 'review_unlinked', v_uid, r.recorded_owner_id);
  ELSIF v_dec = 'create' THEN
    SELECT * INTO u FROM public.unified_contacts WHERE unified_id = v_uid FOR UPDATE;
    IF FOUND THEN
      -- Only delete a contact nothing else has touched since it was minted.
      IF u.updated_at > u.created_at + interval '5 minutes'
         OR u.recorded_owner_id IS DISTINCT FROM r.recorded_owner_id
         OR EXISTS (SELECT 1 FROM public.contact_change_log c WHERE c.unified_id = v_uid) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'created_contact_modified', 'unified_id', v_uid);
      END IF;
      DELETE FROM public.unified_contacts WHERE unified_id = v_uid;
      GET DIAGNOSTICS v_n = ROW_COUNT;
    END IF;
    INSERT INTO public.lcc_gov_owner_contact_link_log (batch, action, unified_id, recorded_owner_id, detail)
    VALUES (r.resolution->>'batch', 'review_deleted', NULL, r.recorded_owner_id,
            jsonb_build_object('deleted_unified_id', v_uid, 'deleted', v_n));
  END IF;

  UPDATE public.lcc_gov_owner_unification_review
     SET status = 'open', resolved_at = NULL, decided_by = NULL,
         resolution = coalesce(r.resolution, '{}'::jsonb)
                      || jsonb_build_object('undone_at', now(), 'undone_by', p_undone_by, 'undone_from_status', r.status)
   WHERE review_id = p_review_id;
  RETURN jsonb_build_object('ok', true, 'review_id', p_review_id, 'undone', coalesce(v_dec, 'none'), 'rows', v_n);
END
$fn$;

CREATE OR REPLACE FUNCTION public.lcc_autoresolve_gov_owner_reviews(p_dry_run boolean DEFAULT true)
RETURNS TABLE(review_id bigint, auto_class text, action text)
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
#variable_conflict use_column
DECLARE r record; v_class text;
BEGIN
  FOR r IN
    SELECT q.review_id AS rid, q.recorded_owner_id, q.owner_name, q.reason, q.candidate_unified_id,
           own.survivor_id AS own_survivor, own.state AS own_state,
           cm.recorded_owner_id AS cand_owner, cm.survivor_id AS cand_survivor, cm.name AS cand_owner_name,
           cm.state AS cand_state,
           EXISTS (SELECT 1 FROM public.unified_contacts x WHERE x.recorded_owner_id = q.recorded_owner_id) AS owner_linked
      FROM public.lcc_gov_owner_unification_review q
      LEFT JOIN public.lcc_gov_recorded_owner_mirror own ON own.recorded_owner_id = q.recorded_owner_id
      LEFT JOIN public.unified_contacts u ON u.unified_id = q.candidate_unified_id
      LEFT JOIN public.lcc_gov_recorded_owner_mirror cm ON cm.recorded_owner_id = u.recorded_owner_id
     WHERE q.status = 'open'
     ORDER BY q.review_id
  LOOP
    v_class := CASE
      WHEN r.owner_linked THEN 'owner_now_linked'
      WHEN r.own_survivor IS NOT NULL AND r.own_survivor <> r.recorded_owner_id THEN 'owner_merged_away'
      WHEN r.reason = 'unified_row_already_linked'
           AND r.cand_owner IS NOT NULL AND r.cand_owner <> r.recorded_owner_id
           AND r.cand_survivor = r.cand_owner
           AND public.lcc_company_canonical_key(r.owner_name) IS NOT NULL
           AND public.lcc_company_canonical_key(r.owner_name) = public.lcc_company_canonical_key(r.cand_owner_name)
           AND (r.own_state IS NULL OR r.cand_state IS NULL OR upper(r.own_state) = upper(r.cand_state))
        THEN 'already_represented_by_duplicate_gov_owner'
    END;
    CONTINUE WHEN v_class IS NULL;
    review_id := r.rid; auto_class := v_class;
    action := CASE WHEN p_dry_run THEN 'would_resolve' ELSE 'resolved' END;
    IF NOT p_dry_run THEN
      UPDATE public.lcc_gov_owner_unification_review q
         SET status = CASE v_class WHEN 'owner_merged_away' THEN 'dismissed' ELSE 'resolved' END,
             resolved_at = now(), decided_by = 'auto:review_lanes1',
             resolution = jsonb_build_object('decision', 'auto_' || v_class, 'at', now(), 'auto_class', v_class,
                                             'candidate_owner', r.cand_owner)
       WHERE q.review_id = r.rid;
    END IF;
    RETURN NEXT;
  END LOOP;
END
$fn$;

-- The tick must not re-queue an owner someone already decided. It excluded only OPEN reviews, so a
-- resolved or dismissed owner would have been picked up and re-queued on the next run (every 30
-- minutes). Rewritten in place from the DEPLOYED body so this cannot regress anything else in it.
DO $$
DECLARE d text; v_old text := 'WHERE q.recorded_owner_id = o.recorded_owner_id AND q.status = ''open'')';
BEGIN
  d := pg_get_functiondef('public.lcc_unify_gov_owners_tick(int,boolean,text)'::regprocedure);
  IF position(v_old IN d) = 0 THEN
    IF position('WHERE q.recorded_owner_id = o.recorded_owner_id)' IN d) > 0 THEN
      RETURN;  -- already applied
    END IF;
    RAISE EXCEPTION 'REVIEW-LANES1: lcc_unify_gov_owners_tick no longer carries the open-review predicate';
  END IF;
  IF position(v_old IN substr(d, position(v_old IN d) + 1)) > 0 THEN
    RAISE EXCEPTION 'REVIEW-LANES1: the open-review predicate appears more than once';
  END IF;
  EXECUTE replace(d, v_old, 'WHERE q.recorded_owner_id = o.recorded_owner_id)');
END $$;

-- ------------------------------------------------------------------ 2. asset relinks -------------
ALTER TABLE public.lcc_asset_property_link_resolution ADD COLUMN IF NOT EXISTS decided_at timestamptz;
ALTER TABLE public.lcc_asset_property_link_resolution ADD COLUMN IF NOT EXISTS decided_by text;
ALTER TABLE public.lcc_asset_property_link_resolution ADD COLUMN IF NOT EXISTS decision jsonb;

CREATE OR REPLACE FUNCTION public.lcc_decide_asset_property_link(
  p_ledger_id bigint, p_decision text, p_kept text DEFAULT NULL, p_decided_by text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE l record; e record; v_n int := 0;
BEGIN
  SELECT * INTO l FROM public.lcc_asset_property_link_resolution WHERE id = p_ledger_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'ledger_not_found'); END IF;
  IF l.verdict <> 'candidate' THEN RETURN jsonb_build_object('ok', false, 'error', 'not_a_candidate'); END IF;
  IF l.decided_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'already_decided'); END IF;
  SELECT id, metadata INTO e FROM public.entities WHERE id = l.entity_id;

  IF p_decision = 'relink' THEN
    IF p_kept IS NULL OR NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(coalesce(l.evidence->'candidates', '[]'::jsonb)) c WHERE c = p_kept) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'kept_not_a_candidate', 'kept', p_kept);
    END IF;
    v_n := public.lcc_repoint_entity_property_id(l.domain, p_kept, l.dropped_property_id);
    IF v_n = 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'nothing_repointed'); END IF;
    UPDATE public.entities
       SET metadata = metadata - 'domain_property_missing', updated_at = now()
     WHERE id = l.entity_id;
    UPDATE public.research_tasks SET status = 'completed', updated_at = now()
     WHERE id = l.research_task_id AND status IN ('queued', 'in_progress');
    UPDATE public.lcc_asset_property_link_resolution
       SET decided_at = now(), decided_by = p_decided_by,
           decision = jsonb_build_object('decision', 'relink', 'kept', p_kept, 'repointed', v_n,
                                         'prior_flag', e.metadata->'domain_property_missing')
     WHERE id = p_ledger_id;
    RETURN jsonb_build_object('ok', true, 'decision', 'relink', 'kept', p_kept, 'repointed', v_n);
  ELSIF p_decision = 'no_match' THEN
    UPDATE public.research_tasks SET status = 'skipped', updated_at = now()
     WHERE id = l.research_task_id AND status IN ('queued', 'in_progress');
    UPDATE public.lcc_asset_property_link_resolution
       SET decided_at = now(), decided_by = p_decided_by,
           decision = jsonb_build_object('decision', 'no_match')
     WHERE id = p_ledger_id;
    RETURN jsonb_build_object('ok', true, 'decision', 'no_match');
  END IF;
  RETURN jsonb_build_object('ok', false, 'error', 'unknown_decision', 'decision', p_decision);
END
$fn$;

CREATE OR REPLACE FUNCTION public.lcc_undo_asset_property_link(p_ledger_id bigint, p_undone_by text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE l record; v_n int := 0;
BEGIN
  SELECT * INTO l FROM public.lcc_asset_property_link_resolution WHERE id = p_ledger_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'ledger_not_found'); END IF;
  IF l.decided_at IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_decided'); END IF;
  IF l.decision->>'decision' = 'relink' THEN
    v_n := public.lcc_unrepoint_entity_property_id(l.domain, l.dropped_property_id, l.decision->>'kept');
    IF v_n = 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'nothing_unrepointed'); END IF;
    IF l.decision ? 'prior_flag' AND jsonb_typeof(l.decision->'prior_flag') = 'object' THEN
      UPDATE public.entities
         SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('domain_property_missing', l.decision->'prior_flag'),
             updated_at = now()
       WHERE id = l.entity_id;
    END IF;
  END IF;
  UPDATE public.research_tasks SET status = 'queued', updated_at = now()
   WHERE id = l.research_task_id AND status IN ('completed', 'skipped');
  UPDATE public.lcc_asset_property_link_resolution
     SET decided_at = NULL, decided_by = NULL,
         decision = coalesce(l.decision, '{}'::jsonb)
                    || jsonb_build_object('undone_at', now(), 'undone_by', p_undone_by, 'unrepointed', v_n)
   WHERE id = p_ledger_id;
  RETURN jsonb_build_object('ok', true, 'ledger_id', p_ledger_id, 'unrepointed', v_n);
END
$fn$;

-- ------------------------------------------------------------------ 3. hub conflicts -------------
CREATE TABLE IF NOT EXISTS public.lcc_contact_conflict_merge_backup (
  backup_id         bigserial PRIMARY KEY,
  conflict_log_id   bigint NOT NULL,
  keep_id           uuid NOT NULL,
  drop_id           uuid NOT NULL,
  keep_row          jsonb NOT NULL,
  drop_row          jsonb NOT NULL,
  change_log_rows   jsonb NOT NULL DEFAULT '[]'::jsonb,
  merge_queue_rows  jsonb NOT NULL DEFAULT '[]'::jsonb,
  decided_by        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  restored_at       timestamptz
);
ALTER TABLE public.lcc_contact_conflict_merge_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lcc_contact_conflict_merge_backup FROM public, anon, authenticated;
REVOKE ALL ON SEQUENCE public.lcc_contact_conflict_merge_backup_backup_id_seq FROM public, anon, authenticated;

-- The conflict row: which hub contact sits on the tombstone, and who (if anyone) holds the survivor.
CREATE OR REPLACE VIEW public.v_lcc_contact_hub_conflict_open
WITH (security_invoker = on) AS
SELECT l.log_id AS conflict_log_id, l.created_at, l.unified_id, l.recorded_owner_id AS survivor_owner_id,
       l.prior_recorded_owner_id AS tomb_owner_id,
       u.contact_class, u.company_name, u.first_name, u.last_name, u.email, u.phone, u.sf_account_id,
       u.recorded_owner_id AS current_owner_id,
       sm.name AS survivor_owner_name, tm.name AS tomb_owner_name,
       h.unified_id AS holder_unified_id, h.contact_class AS holder_class, h.company_name AS holder_company_name,
       h.first_name AS holder_first_name, h.last_name AS holder_last_name, h.email AS holder_email,
       h.sf_account_id AS holder_sf_account_id,
       (SELECT count(*) FROM public.unified_contacts z WHERE z.recorded_owner_id = l.recorded_owner_id) AS survivor_holders
  FROM public.lcc_gov_owner_contact_link_log l
  JOIN public.unified_contacts u ON u.unified_id = l.unified_id
  LEFT JOIN public.lcc_gov_recorded_owner_mirror sm ON sm.recorded_owner_id = l.recorded_owner_id
  LEFT JOIN public.lcc_gov_recorded_owner_mirror tm ON tm.recorded_owner_id = l.prior_recorded_owner_id
  LEFT JOIN LATERAL (SELECT * FROM public.unified_contacts z
                      WHERE z.recorded_owner_id = l.recorded_owner_id AND z.unified_id <> l.unified_id
                      ORDER BY z.created_at LIMIT 1) h ON true
 WHERE l.action = 'merge_follow_conflict'
   AND u.recorded_owner_id = l.prior_recorded_owner_id;   -- still sitting on the tombstone
REVOKE ALL ON public.v_lcc_contact_hub_conflict_open FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.lcc_decide_contact_hub_conflict(
  p_log_id bigint, p_decision text, p_decided_by text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE c record; v_n int;
BEGIN
  SELECT * INTO c FROM public.v_lcc_contact_hub_conflict_open WHERE conflict_log_id = p_log_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'conflict_not_open'); END IF;
  IF p_decision = 'repoint_to_survivor' THEN
    IF c.survivor_holders > 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'survivor_already_held', 'holder', c.holder_unified_id);
    END IF;
    UPDATE public.unified_contacts SET recorded_owner_id = c.survivor_owner_id
     WHERE unified_id = c.unified_id AND recorded_owner_id = c.tomb_owner_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO public.lcc_gov_owner_contact_link_log (batch, action, unified_id, recorded_owner_id, prior_recorded_owner_id, detail)
    VALUES ('conflict_review_' || p_log_id, 'conflict_repoint', c.unified_id, c.survivor_owner_id, c.tomb_owner_id,
            jsonb_build_object('decided_by', p_decided_by));
    RETURN jsonb_build_object('ok', v_n = 1, 'decision', p_decision, 'rows', v_n);
  ELSIF p_decision = 'keep_both' THEN
    RETURN jsonb_build_object('ok', true, 'decision', p_decision);
  END IF;
  RETURN jsonb_build_object('ok', false, 'error', 'unknown_decision', 'decision', p_decision);
END
$fn$;

CREATE OR REPLACE FUNCTION public.lcc_undo_contact_hub_conflict_repoint(p_log_id bigint, p_undone_by text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE r record; v_n int;
BEGIN
  SELECT * INTO r FROM public.lcc_gov_owner_contact_link_log
   WHERE batch = 'conflict_review_' || p_log_id AND action = 'conflict_repoint'
   ORDER BY log_id DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'no_repoint_logged'); END IF;
  UPDATE public.unified_contacts SET recorded_owner_id = r.prior_recorded_owner_id
   WHERE unified_id = r.unified_id AND recorded_owner_id = r.recorded_owner_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'repoint_no_longer_in_place'); END IF;
  INSERT INTO public.lcc_gov_owner_contact_link_log (batch, action, unified_id, recorded_owner_id, prior_recorded_owner_id, detail)
  VALUES (r.batch, 'conflict_unrepoint', r.unified_id, r.prior_recorded_owner_id, r.recorded_owner_id,
          jsonb_build_object('undone_by', p_undone_by));
  RETURN jsonb_build_object('ok', true, 'rows', v_n);
END
$fn$;

-- Snapshot before the contact merge path deletes the dropped contact. Refuses what the merge path
-- would get wrong silently: a person folded into a company, or a dropped contact another table
-- pins with a non-cascading FK (the merge path's DELETE is unchecked, so it would half-merge).
CREATE OR REPLACE FUNCTION public.lcc_snapshot_contact_conflict_merge(
  p_log_id bigint, p_decided_by text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE c record; k record; d record; v_id bigint;
BEGIN
  SELECT * INTO c FROM public.v_lcc_contact_hub_conflict_open WHERE conflict_log_id = p_log_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'conflict_not_open'); END IF;
  IF c.holder_unified_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_survivor_holder'); END IF;
  IF c.survivor_holders > 1 THEN RETURN jsonb_build_object('ok', false, 'error', 'several_survivor_holders'); END IF;
  IF coalesce(c.contact_class, '') IS DISTINCT FROM coalesce(c.holder_class, '') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'contact_class_differs',
                              'conflict_class', c.contact_class, 'holder_class', c.holder_class);
  END IF;
  IF EXISTS (SELECT 1 FROM public.lcc_n15_sf_campaign_hub_mint_log WHERE unified_id = c.unified_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'dropped_contact_pinned_by_mint_log');
  END IF;
  SELECT * INTO k FROM public.unified_contacts WHERE unified_id = c.holder_unified_id;
  SELECT * INTO d FROM public.unified_contacts WHERE unified_id = c.unified_id;
  INSERT INTO public.lcc_contact_conflict_merge_backup
    (conflict_log_id, keep_id, drop_id, keep_row, drop_row, change_log_rows, merge_queue_rows, decided_by)
  VALUES (p_log_id, k.unified_id, d.unified_id, to_jsonb(k), to_jsonb(d),
          coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM public.contact_change_log x WHERE x.unified_id = d.unified_id), '[]'::jsonb),
          coalesce((SELECT jsonb_agg(to_jsonb(m)) FROM public.contact_merge_queue m
                     WHERE m.contact_a = d.unified_id OR m.contact_b = d.unified_id), '[]'::jsonb),
          p_decided_by)
  RETURNING backup_id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'backup_id', v_id, 'keep_id', k.unified_id, 'drop_id', d.unified_id);
END
$fn$;

-- Undo a conflict merge: the kept contact gets its pre-merge values back, the dropped contact is
-- re-inserted as it was, its change-log rows point at it again, its merge-queue rows come back.
CREATE OR REPLACE FUNCTION public.lcc_undo_contact_conflict_merge(p_backup_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE b record; v_cols text; v_set text; v_pk text;
BEGIN
  SELECT * INTO b FROM public.lcc_contact_conflict_merge_backup WHERE backup_id = p_backup_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'backup_not_found'); END IF;
  IF b.restored_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'already_restored'); END IF;
  IF EXISTS (SELECT 1 FROM public.unified_contacts WHERE unified_id = b.drop_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'dropped_contact_still_exists');
  END IF;

  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position),
         string_agg(format('%1$I = s.%1$I', column_name), ', ' ORDER BY ordinal_position)
    INTO v_cols, v_set
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'unified_contacts'
     AND is_generated = 'NEVER' AND column_name <> 'unified_id';
  EXECUTE format('UPDATE public.unified_contacts u SET %s FROM jsonb_populate_record(NULL::public.unified_contacts, $1) s '
                 'WHERE u.unified_id = $2', v_set) USING b.keep_row, b.keep_id;
  EXECUTE format('INSERT INTO public.unified_contacts (unified_id, %1$s) SELECT unified_id, %1$s '
                 'FROM jsonb_populate_record(NULL::public.unified_contacts, $1)', v_cols) USING b.drop_row;

  SELECT a.attname INTO v_pk FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
   WHERE i.indrelid = 'public.contact_change_log'::regclass AND i.indisprimary;
  IF v_pk IS NOT NULL AND jsonb_array_length(b.change_log_rows) > 0 THEN
    EXECUTE format('UPDATE public.contact_change_log c SET unified_id = $1 WHERE c.%1$I::text IN '
                   '(SELECT x->>%2$L FROM jsonb_array_elements($2) x) AND c.unified_id IS NULL', v_pk, v_pk)
      USING b.drop_id, b.change_log_rows;
  END IF;
  INSERT INTO public.contact_merge_queue
  SELECT (jsonb_populate_record(NULL::public.contact_merge_queue, x)).*
    FROM jsonb_array_elements(b.merge_queue_rows) x
  ON CONFLICT DO NOTHING;

  UPDATE public.lcc_contact_conflict_merge_backup SET restored_at = now() WHERE backup_id = p_backup_id;
  RETURN jsonb_build_object('ok', true, 'backup_id', p_backup_id, 'keep_id', b.keep_id, 'drop_id', b.drop_id);
END
$fn$;

-- ------------------------------------------------------------------ 4. backlog health ------------
CREATE TABLE IF NOT EXISTS public.lcc_review_lane_backlog_log (
  id              bigserial PRIMARY KEY,
  measured_at     timestamptz NOT NULL DEFAULT now(),
  lane_key        text NOT NULL,
  decision_type   text NOT NULL,
  open_count      integer,
  oldest_open_at  timestamptz,
  decided_14d     integer,
  auto_resolved   integer
);
CREATE INDEX IF NOT EXISTS idx_lcc_review_lane_backlog_log_lane ON public.lcc_review_lane_backlog_log (lane_key, measured_at DESC);
ALTER TABLE public.lcc_review_lane_backlog_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lcc_review_lane_backlog_log FROM public, anon, authenticated;

-- p_rows: [{lane_key, decision_type, open_count, oldest_open_at, auto_resolved}]. A lane "stalls"
-- when it holds open work older than 14 days and nobody decided anything in it for 14 days. A NULL
-- open_count means the count could not be read — logged, never alerted on, never resolved.
CREATE OR REPLACE FUNCTION public.lcc_record_review_lane_backlog(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE x jsonb; v_open int; v_oldest timestamptz; v_dec int; v_lane text; v_type text;
        v_opened int := 0; v_resolved int := 0; v_stalled text[] := '{}';
BEGIN
  FOR x IN SELECT * FROM jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) LOOP
    v_lane := x->>'lane_key'; v_type := x->>'decision_type';
    v_open := nullif(x->>'open_count', '')::int;
    v_oldest := nullif(x->>'oldest_open_at', '')::timestamptz;
    SELECT count(*) INTO v_dec FROM public.lcc_decisions
     WHERE decision_type = v_type AND status <> 'open' AND decided_at > now() - interval '14 days'
       AND coalesce(decided_by::text, '') <> '';
    INSERT INTO public.lcc_review_lane_backlog_log (lane_key, decision_type, open_count, oldest_open_at, decided_14d, auto_resolved)
    VALUES (v_lane, v_type, v_open, v_oldest, v_dec, nullif(x->>'auto_resolved', '')::int);
    CONTINUE WHEN v_open IS NULL;

    IF v_open > 0 AND v_dec = 0 AND v_oldest < now() - interval '14 days' THEN
      v_stalled := v_stalled || v_lane;
      IF NOT EXISTS (SELECT 1 FROM public.lcc_health_alerts
                      WHERE alert_kind = 'review_lane_backlog' AND resolved_at IS NULL
                        AND details->>'lane_key' = v_lane) THEN
        INSERT INTO public.lcc_health_alerts (alert_kind, source, severity, summary, details)
        VALUES ('review_lane_backlog', 'lcc_record_review_lane_backlog', 'warning',
                v_lane || ': ' || v_open || ' open, oldest ' || to_char(v_oldest, 'YYYY-MM-DD')
                  || ', no decisions in 14 days',
                jsonb_build_object('lane_key', v_lane, 'decision_type', v_type, 'open_count', v_open,
                                   'oldest_open_at', v_oldest));
        v_opened := v_opened + 1;
      END IF;
    ELSE
      UPDATE public.lcc_health_alerts
         SET resolved_at = now(),
             resolved_note = CASE WHEN v_open = 0 THEN 'lane empty' ELSE 'decisions resumed' END
       WHERE alert_kind = 'review_lane_backlog' AND resolved_at IS NULL AND details->>'lane_key' = v_lane;
      GET DIAGNOSTICS v_dec = ROW_COUNT;
      v_resolved := v_resolved + v_dec;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('alerts_opened', v_opened, 'alerts_resolved', v_resolved, 'stalled', to_jsonb(v_stalled));
END
$fn$;

-- ------------------------------------------------------------------ privileges -------------------
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.lcc_decide_gov_owner_review(bigint,text,text)',
    'public.lcc_undo_gov_owner_review(bigint,text)',
    'public.lcc_autoresolve_gov_owner_reviews(boolean)',
    'public.lcc_decide_asset_property_link(bigint,text,text,text)',
    'public.lcc_undo_asset_property_link(bigint,text)',
    'public.lcc_decide_contact_hub_conflict(bigint,text,text)',
    'public.lcc_undo_contact_hub_conflict_repoint(bigint,text)',
    'public.lcc_snapshot_contact_conflict_merge(bigint,text)',
    'public.lcc_undo_contact_conflict_merge(bigint)',
    'public.lcc_record_review_lane_backlog(jsonb)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM public, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
    IF has_function_privilege('anon', f, 'execute') OR has_function_privilege('authenticated', f, 'execute') THEN
      RAISE EXCEPTION 'REVIEW-LANES1: % still executable by anon/authenticated', f;
    END IF;
  END LOOP;
  IF has_table_privilege('anon', 'public.v_lcc_contact_hub_conflict_open', 'SELECT') THEN
    RAISE EXCEPTION 'REVIEW-LANES1: v_lcc_contact_hub_conflict_open readable by anon';
  END IF;
END $$;

-- The tick's cron lives in 20261102370000_lcc_review_lanes1_tick_cron.sql: it posts to
-- /api/review-lanes-tick, so it is applied only after the Railway deploy that serves that route.

COMMIT;
