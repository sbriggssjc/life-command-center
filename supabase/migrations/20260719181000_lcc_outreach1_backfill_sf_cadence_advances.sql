-- ============================================================================
-- OUTREACH #1 — backfill the historical SF outreach misses (reversible)
-- ----------------------------------------------------------------------------
-- RC1 (the dominant, currently-biting miss, grounded live 2026-06-19): Scott
-- logs most of his real outreach in Salesforce as plain Tasks (sf_type='Task',
-- no TaskSubtype). The ingest's mapSfTypeToCategory collapsed those to category
-- 'note', and the advance trigger explicitly skips 'note' — so those touches
-- never advanced any cadence. Receipts: 31/44 recent SF events are category
-- 'note', 29/31 are real outreach ("Sent RE: …", "… sent Re: …", "Call"), and
-- 14 resolve directly onto an active cadence (+6 onto a cadence's contact_id).
-- The forward fix is in the JS ingest (deriveSfCategory) + the RC3 contact tier;
-- this function repairs the EXISTING rows so the dashboard reflects reality.
--
-- Approach — watermark, not blind replay (safe + idempotent):
--   For each ACTIVE cadence, advance it (via the SAME lcc_advance_onboarding_
--   cadence the trigger uses) once per real SF outreach event that resolves to
--   it (entity_id / contact_id / owns-hop) and occurred AFTER the cadence's
--   current last_touch_at, in chronological order. Events already reflected
--   (occurred_at <= last_touch_at — e.g. the call/email events the trigger
--   already advanced) are skipped, so nothing double-counts. A re-run finds 0.
--   Real-outreach 'note' rows are detected by an OUTBOUND/INBOUND-shaped subject
--   (the same conservative patterns deriveSfCategory uses); genuine internal
--   notes ("2 - Medical Buyer/Portfolio") do NOT match and are left alone.
--
-- Reversible: every advance snapshots the cadence's pre-state into
-- lcc_sf_cadence_backfill_log and stamps the source activity
-- metadata.cadence_backfilled=true. Dry-run (default) writes nothing.
--
-- Undo a real run:
--   UPDATE touchpoint_cadence t SET
--     current_touch=b.pre_current_touch, last_touch_at=b.pre_last_touch_at,
--     last_touch_type=b.pre_last_touch_type, next_touch_due=b.pre_next_touch_due,
--     phase=b.pre_phase
--   FROM (SELECT DISTINCT ON (cadence_id) * FROM lcc_sf_cadence_backfill_log
--         ORDER BY cadence_id, id ASC) b   -- earliest snapshot = original state
--   WHERE t.id=b.cadence_id;
--   UPDATE activity_events SET metadata = metadata - 'cadence_backfilled'
--   WHERE metadata->>'cadence_backfilled'='true';
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.lcc_sf_cadence_backfill_log (
  id                   bigserial PRIMARY KEY,
  activity_id          uuid,
  cadence_id           uuid,
  logged_type          text,
  occurred_at          timestamptz,
  pre_current_touch    int,
  pre_phase            text,
  pre_last_touch_at    timestamptz,
  pre_last_touch_type  text,
  pre_next_touch_due   timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.lcc_backfill_sf_cadence_advances(p_dry_run boolean DEFAULT true)
 RETURNS TABLE(processed int, cadences_touched int)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_processed int := 0;
  v_cads      uuid[] := '{}';
  v_wm        timestamptz;
  v_logged    text;
  rec         record;
  -- conservative real-outreach subject shape (mirrors JS deriveSfCategory).
  -- NOTE: Postgres ARE uses \y for a word boundary (\b is BACKSPACE here).
  c_outreach_re constant text :=
    '(^\s*(re|aw|antw|sv|vs|rv|fw|fwd)\s*:)|(\ysent\y)|(\ycall\y)|(voicemail)|(left (a )?(vm|message))|(re:|fw:|fwd:)';
  c_call_re constant text :=
    '(\ycall\y)|(voicemail)|(left (a )?(vm|message))';
BEGIN
  FOR rec IN
    SELECT ae.id AS activity_id, ae.occurred_at, ae.category::text AS cat, ae.title,
           res.cad_id, res.next_touch_type
    FROM public.activity_events ae
    JOIN LATERAL (
      SELECT tc.id AS cad_id, tc.next_touch_type
      FROM public.touchpoint_cadence tc
      WHERE tc.phase IN ('onboarding','steady_state','prospecting')
        AND (
              tc.entity_id  = ae.entity_id
           OR tc.contact_id = ae.entity_id
           OR tc.entity_id IN (
                SELECT er.from_entity_id FROM public.entity_relationships er
                WHERE er.to_entity_id = ae.entity_id AND er.relationship_type = 'owns'
              )
        )
      ORDER BY (CASE WHEN tc.entity_id = ae.entity_id THEN 0
                     WHEN tc.contact_id = ae.entity_id THEN 1 ELSE 2 END),
               tc.updated_at DESC
      LIMIT 1
    ) res ON true
    WHERE ae.source_type = 'salesforce'
      AND ae.entity_id IS NOT NULL
      AND ae.occurred_at IS NOT NULL
      AND COALESCE(ae.metadata->>'skip_cadence_advance','') <> 'true'
      AND COALESCE(ae.metadata->>'cadence_backfilled','') <> 'true'
      AND (
            ae.category IN ('call','email')
         OR (ae.category = 'note' AND ae.title ~* c_outreach_re)
      )
    ORDER BY res.cad_id, ae.occurred_at ASC
  LOOP
    -- Re-read the cadence watermark each iteration (it advances as we go).
    SELECT last_touch_at INTO v_wm
    FROM public.touchpoint_cadence WHERE id = rec.cad_id;

    IF rec.occurred_at <= COALESCE(v_wm, '-infinity'::timestamptz) THEN
      CONTINUE;   -- already reflected (e.g. trigger-advanced call/email) — skip
    END IF;

    -- Infer the touch type the same way the trigger would.
    v_logged := CASE
      WHEN rec.cat = 'email' THEN 'email'
      WHEN rec.cat = 'call'  THEN CASE WHEN rec.next_touch_type = 'vm' THEN 'vm' ELSE 'call' END
      ELSE CASE WHEN rec.title ~* c_call_re THEN 'call' ELSE 'email' END  -- note → outreach
    END;

    IF NOT p_dry_run THEN
      INSERT INTO public.lcc_sf_cadence_backfill_log
        (activity_id, cadence_id, logged_type, occurred_at,
         pre_current_touch, pre_phase, pre_last_touch_at, pre_last_touch_type, pre_next_touch_due)
      SELECT rec.activity_id, rec.cad_id, v_logged, rec.occurred_at,
             tc.current_touch, tc.phase, tc.last_touch_at, tc.last_touch_type, tc.next_touch_due
      FROM public.touchpoint_cadence tc WHERE tc.id = rec.cad_id;

      PERFORM public.lcc_advance_onboarding_cadence(
        p_cadence_id  := rec.cad_id,
        p_logged_type := v_logged,
        p_logged_at   := rec.occurred_at
      );

      UPDATE public.activity_events
      SET metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object('cadence_backfilled', true)
      WHERE id = rec.activity_id;
    END IF;

    v_processed := v_processed + 1;
    IF NOT (rec.cad_id = ANY(v_cads)) THEN v_cads := v_cads || rec.cad_id; END IF;
  END LOOP;

  IF NOT p_dry_run THEN
    PERFORM public.lcc_refresh_priority_queue_resolved();
  END IF;

  processed := v_processed;
  cadences_touched := COALESCE(array_length(v_cads, 1), 0);
  RETURN NEXT;
END;
$function$;
