-- ============================================================================
-- R28 Unit 1 — reconcile OM/email inbox notifications to the intake pipeline
-- 2026-06-16  (LCC Opps, xengecqvemvfknjvbvrq)
-- ----------------------------------------------------------------------------
-- The Inbox is a capture/notification surface. For OM/flagged-email channels it
-- only ever flows IN — an OM notification row never clears when its underlying
-- `staged_intake_items` document finishes processing, so the rows pile up
-- forever and inflate the Today "Inbox New" count (the same trust-eroding
-- inflated-count class as the R25 sync-error widget).
--
-- The intake EXTRACTION pipeline is healthy and independent; this round only
-- reconciles the NOTIFICATION layer around it. The inbox row is treated as a
-- status MIRROR of its intake — NOT re-processed (the auto-pipeline owns
-- extraction).
--
-- The forward linkage already exists in the data (no JS stamping needed):
--   * email_om / sidebar_om / folder_feed_om / copilot_om — the notification IS
--     the intake: `staged_intake_items.intake_id = inbox_items.id`.
--   * flagged_email — `inbox_items.metadata->>'bridged_to_intake_id'` points at
--     the bridged `staged_intake_items.intake_id` (patched by intake.js).
--
-- This migration adds:
--   1. `lcc_reconcile_inbox_om_notifications(stale_days, lim)` — archives
--      'new' OM-type notification rows when EITHER their linked intake reached a
--      TERMINAL state (finalized/discarded) OR the notification is older than
--      `stale_days` (stale by construction — the pipeline has long since
--      processed/parked that document; the actionable work, if any, lives in the
--      decision lanes, not the inbox). Reversible status flip + a metadata tag.
--   2. cron `lcc-inbox-om-reconcile` (*/30) — pure-DB, gentle. Auto-resolves new
--      terminal intakes within one tick and caps the OM pile at `stale_days` of
--      inflow.
--
-- Count honesty (Unit 1c): the Today "Inbox New" / flagged widgets count
-- `status='new'`, so archived notifications leave the count automatically — no
-- JS change needed.
--
-- Safety / blast radius: inbox_items is on the auth DB (LCC Opps) but is NOT an
-- auth-schema table. The reconcile is a bounded (LIMIT-capped) status UPDATE; no
-- hard deletes (the disk-safe LCC Opps rule); the metadata tag makes every flip
-- reversible. Pure-DB cron (no pg_net round-trip), GENTLE cadence (the
-- artifact-offload connection-exhaustion lesson). Idempotent / additive.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.lcc_reconcile_inbox_om_notifications(
  p_stale_days integer DEFAULT 30,
  p_limit      integer DEFAULT 2000
)
RETURNS TABLE (archived_terminal integer, archived_stale integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_om_types text[] := ARRAY['flagged_email','email_om','sidebar_om','folder_feed_om','copilot_om'];
  v_now      timestamptz := now();
  v_terminal integer := 0;
  v_stale    integer := 0;
BEGIN
  -- Leg A — auto-resolve: the linked intake reached a terminal state. Matches
  -- BOTH the direct linkage (intake_id = inbox.id) and the flagged_email bridge
  -- (metadata.bridged_to_intake_id = intake_id).
  WITH cand AS (
    SELECT i.id, i.status, i.metadata
    FROM public.inbox_items i
    WHERE i.status = 'new'
      AND i.source_type = ANY(v_om_types)
      AND EXISTS (
        SELECT 1 FROM public.staged_intake_items s
        WHERE s.status IN ('finalized','discarded')
          AND (
            s.intake_id = i.id
            OR ( (i.metadata->>'bridged_to_intake_id') IS NOT NULL
                 AND s.intake_id = (i.metadata->>'bridged_to_intake_id')::uuid )
          )
      )
    ORDER BY i.received_at ASC
    LIMIT GREATEST(p_limit, 0)
  ), upd AS (
    UPDATE public.inbox_items i
       SET status = 'archived',
           metadata = COALESCE(i.metadata, '{}'::jsonb)
             || jsonb_build_object('inbox_reconcile', jsonb_build_object(
                  'reason', 'intake_terminal',
                  'prev_status', 'new',
                  'at', v_now,
                  'source', 'r28_unit1')),
           updated_at = v_now
      FROM cand
     WHERE i.id = cand.id
       AND i.status = 'new'
    RETURNING 1
  )
  SELECT count(*) INTO v_terminal FROM upd;

  -- Leg B — stale notification: older than p_stale_days. Catches the
  -- review_required / failed / never-bridged rows whose actionable work (if any)
  -- lives in the decision lanes, not the inbox.
  WITH cand AS (
    SELECT i.id
    FROM public.inbox_items i
    WHERE i.status = 'new'
      AND i.source_type = ANY(v_om_types)
      AND i.received_at < v_now - make_interval(days => GREATEST(p_stale_days, 0))
    ORDER BY i.received_at ASC
    LIMIT GREATEST(p_limit, 0)
  ), upd AS (
    UPDATE public.inbox_items i
       SET status = 'archived',
           metadata = COALESCE(i.metadata, '{}'::jsonb)
             || jsonb_build_object('inbox_reconcile', jsonb_build_object(
                  'reason', 'stale_notification',
                  'prev_status', 'new',
                  'at', v_now,
                  'source', 'r28_unit1')),
           updated_at = v_now
      FROM cand
     WHERE i.id = cand.id
       AND i.status = 'new'
    RETURNING 1
  )
  SELECT count(*) INTO v_stale FROM upd;

  archived_terminal := v_terminal;
  archived_stale    := v_stale;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.lcc_reconcile_inbox_om_notifications(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lcc_reconcile_inbox_om_notifications(integer, integer) TO service_role;

-- Gentle pure-DB cron. */30 — auto-resolves terminal intakes within one tick and
-- holds the OM notification pile at ~30 days of inflow.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('lcc-inbox-om-reconcile');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    PERFORM cron.schedule(
      'lcc-inbox-om-reconcile',
      '*/30 * * * *',
      $cmd$SELECT public.lcc_reconcile_inbox_om_notifications()$cmd$
    );
  END IF;
END $$;
