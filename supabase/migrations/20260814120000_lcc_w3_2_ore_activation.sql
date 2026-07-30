-- ============================================================================
-- W3.2 — ORE ACTIVATION (audit 3.2.3). LCC Opps (xengecqvemvfknjvbvrq).
-- Additive · reversible · idempotent.
-- ----------------------------------------------------------------------------
-- Activates the multi-signal owner reconciliation ENGINE that was built
-- (20260716140000) but never run at a conservative, verdicts-only cadence, and
-- stands up the training-corpus + guardrails around it:
--
--   1. entity_match_labels — the labeled-pair training corpus for Wave 4's
--      Splink resolver. Every Decision-Center owner-reconcile verdict (across
--      all THREE folded seeders) writes one row here.
--   2. lcc_check_owner_reconcile_queue_depth() — a queue-depth alert for
--      lcc_owner_reconcile_queue (986 queued at audit; 1,447 live at activation).
--   3. lcc_check_disabled_critical_crons() — extended to watch the engine drain,
--      so a silently-disabled drain (queue grows unbounded) opens an alert.
--   4. Re-schedule lcc-owner-reconcile-engine at a CONSERVATIVE 25/hour drain
--      from the QUEUE, with auto-merge OFF (merge=0 → verdicts only). Fold the
--      new depth check into the proven hourly lcc-cron-health-check tick.
--
-- ⚠️ GROUNDING CORRECTION (live, 2026-08-14): the audit premise said the engine
--    drain "was deliberately left unscheduled (20260716141000:13-19)". It was in
--    FACT already scheduled — `lcc-owner-reconcile-engine` at '50 6 * * *' with
--    command `.../owner-reconcile-engine-tick?source=candidates&limit=100` and NO
--    `merge=0`, so `doMerge` defaulted TRUE and it AUTO-MERGED (2 pairs recorded
--    action='merged' in lcc_owner_reconcile_evidence). This unit REPLACES that
--    schedule with the audit-specified verdicts-only drain (source=queue,
--    limit=25, merge=0). The 2 prior auto-merges are reversible via each loser's
--    entities.merged_into_entity_id tombstone if a review flags one.
--
-- REVERSAL: drop entity_match_labels + the two functions restored to their prior
--   bodies; `SELECT cron.schedule('lcc-owner-reconcile-engine','50 6 * * *', ...)`
--   to restore the old schedule. No existing object's DATA is mutated.
-- ============================================================================

-- ============================================================================
-- UNIT 1 — entity_match_labels: the labeled-pair training corpus (Wave 4).
-- One row per human verdict on a candidate SAME-PARTY pair, from any of the
-- three folded seeders (ORE reconcile / owner_unification / entity_match_cand).
-- `verdict` is the LABEL ('same_party' = positive, 'distinct' = negative).
-- owner_a/owner_b are the NAMES (per the audit spec); entity_a/entity_b carry the
-- ids (uuid-or-text, cross-DB) so the pair is resolvable back to its source.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.entity_match_labels (
  id             bigserial PRIMARY KEY,
  seeder         text NOT NULL,               -- 'ore_reconcile' | 'owner_unification' | 'entity_match_candidate'
  source_domain  text,                        -- 'lcc' | 'gov' | 'dia'
  owner_a        text,                        -- name A (per spec)
  owner_b        text,                        -- name B (per spec)
  entity_a       text,                        -- id A (uuid/text)
  entity_b       text,                        -- id B (uuid/text)
  verdict        text NOT NULL,               -- 'same_party' (positive) | 'distinct' (negative)
  raw_verdict    text,                        -- the lane verdict token ('approve'|'reject'|…)
  match_score    numeric,                     -- the seeder's confidence signal (weighted_score / match_score / similarity)
  evidence_json  jsonb,                        -- the evidence trace / reason at decision time
  decision_id    bigint,                      -- the lcc_decisions row this verdict recorded
  subject_ref    text,                        -- the canonical decision subject key
  decided_by     uuid,
  decided_at     timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- One label per decided subject (idempotent on a re-record / double-click; the
-- verdict handler is already 409-guarded on a decided subject, this is defense).
CREATE UNIQUE INDEX IF NOT EXISTS uq_entity_match_labels_subject
  ON public.entity_match_labels (subject_ref);
CREATE INDEX IF NOT EXISTS idx_entity_match_labels_seeder
  ON public.entity_match_labels (seeder, decided_at DESC);
CREATE INDEX IF NOT EXISTS idx_entity_match_labels_verdict
  ON public.entity_match_labels (verdict);

COMMENT ON TABLE public.entity_match_labels IS
  'W3.2: labeled entity-match pairs (owner_a/owner_b + verdict same_party|distinct + evidence) — the training corpus for Wave 4''s Splink/libpostal resolver. Written by every Decision-Center owner_reconcile verdict across all three folded seeders (ORE reconcile / owner_unification_review_queue / entity_match_candidates).';

GRANT SELECT ON public.entity_match_labels TO anon, authenticated, service_role;
GRANT INSERT, UPDATE ON public.entity_match_labels TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.entity_match_labels_id_seq TO service_role;

-- ============================================================================
-- UNIT 2 — queue-depth alert for lcc_owner_reconcile_queue.
-- Opens ONE unresolved 'owner_reconcile_queue_depth' warn when the queued depth
-- exceeds the threshold (the 25/hour verdict drain not keeping up with the daily
-- seed); auto-resolves when it falls back within threshold. p_threshold is a
-- parameter so the hourly tick uses the default and a synthetic test can force it.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.lcc_check_owner_reconcile_queue_depth(p_threshold int DEFAULT 1500)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_depth    int;
  v_new      int := 0;
  v_resolved int := 0;
BEGIN
  SELECT count(*) INTO v_depth
    FROM public.lcc_owner_reconcile_queue
   WHERE status = 'queued';

  IF v_depth > p_threshold THEN
    INSERT INTO public.lcc_health_alerts (alert_kind, source, severity, summary, details)
    SELECT 'owner_reconcile_queue_depth', 'lcc_owner_reconcile_queue', 'warn',
           'ORE owner-reconcile queue depth ' || v_depth || ' exceeds the ' || p_threshold ||
           ' threshold — the 25/hour verdicts-only drain (lcc-owner-reconcile-engine) is not keeping up ' ||
           'with the daily reconcile-seed. Confirm the engine cron is active and draining; consider raising ' ||
           'the hourly limit or the seed cadence.',
           jsonb_build_object('depth', v_depth, 'threshold', p_threshold)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.lcc_health_alerts a
       WHERE a.alert_kind = 'owner_reconcile_queue_depth'
         AND a.source = 'lcc_owner_reconcile_queue'
         AND a.resolved_at IS NULL
    );
    GET DIAGNOSTICS v_new = ROW_COUNT;
  ELSE
    UPDATE public.lcc_health_alerts
       SET resolved_at = now(),
           resolved_note = 'Auto-resolved: queue depth ' || v_depth || ' back within threshold ' || p_threshold
     WHERE alert_kind = 'owner_reconcile_queue_depth'
       AND source = 'lcc_owner_reconcile_queue'
       AND resolved_at IS NULL;
    GET DIAGNOSTICS v_resolved = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('depth', v_depth, 'threshold', p_threshold,
                            'new_alerts', v_new, 'resolved', v_resolved);
END;
$$;

REVOKE ALL ON FUNCTION public.lcc_check_owner_reconcile_queue_depth(int) FROM public;
GRANT EXECUTE ON FUNCTION public.lcc_check_owner_reconcile_queue_depth(int) TO service_role;

COMMENT ON FUNCTION public.lcc_check_owner_reconcile_queue_depth(int) IS
  'W3.2: opens/auto-resolves an owner_reconcile_queue_depth warn alert when lcc_owner_reconcile_queue queued depth exceeds p_threshold (default 1500). Folded into the hourly lcc-cron-health-check tick.';

-- ============================================================================
-- UNIT 3 — extend the disabled-critical-cron watchdog to cover the engine drain.
-- A silently-disabled drain lets lcc_owner_reconcile_queue grow unbounded (the
-- daily seed keeps enqueuing), so the watchdog treats it like the other
-- maintenance crons whose being-off is a silent data-integrity risk. Full-body
-- replace of the W2.5 version with `lcc-owner-reconcile-engine` added to BOTH the
-- allowlist and the reported `down` set.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.lcc_check_disabled_critical_crons()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_new      int := 0;
  v_resolved int := 0;
  v_down     jsonb;
begin
  with allow(jobname) as (
    values
      ('lcc-artifact-offload-edge'),          -- drains staged_intake_artifacts inline_data → Storage
      ('sf-sync-log-prune'),                  -- bounds sf_sync_log row count
      ('field-provenance-prune'),             -- bounds field_provenance
      ('lcc-context-packet-prune'),           -- bounds context_packets
      ('lcc-staged-intake-artifacts-prune'),  -- bounds staged_intake_artifacts
      ('lcc-disk-health-check'),              -- the disk-pressure early warning itself
      ('lcc-pg-net-response-cleanup'),        -- bounds net._http_response
      ('lcc-provenance-flush-dia'),           -- W2.5: drains dia.provenance_event_log into the ledger
      ('lcc-provenance-flush-gov'),           -- W2.5: drains gov.provenance_event_log into the ledger
      ('lcc-owner-reconcile-engine')          -- W3.2: drains lcc_owner_reconcile_queue (verdicts only)
  ),
  state as (
    select a.jobname,
           count(j.jobid) = 0               as is_missing,
           coalesce(bool_or(j.active), false) as any_active,
           max(j.schedule)                  as schedule
      from allow a
      left join cron.job j on j.jobname = a.jobname
     group by a.jobname
  ),
  down as (
    select jobname,
           case when is_missing then 'missing' else 'inactive' end as reason,
           schedule
      from state
     where is_missing or not any_active
  ),
  ins as (
    insert into public.lcc_health_alerts (alert_kind, source, severity, summary, details)
    select 'maintenance_cron_disabled', d.jobname, 'warn',
           'Critical maintenance cron ' || d.jobname || ' is ' ||
             case when d.reason = 'missing'
                  then 'MISSING (not scheduled)'
                  else 'DISABLED (active=false)' end ||
             '. While it is off, its table can grow unbounded — disk-full puts ' ||
             'LCC Opps read-only and locks out sign-in. Re-enable it.',
           jsonb_build_object('jobname', d.jobname, 'reason', d.reason,
                              'schedule', d.schedule)
      from down d
     where not exists (
       select 1 from public.lcc_health_alerts a
        where a.alert_kind = 'maintenance_cron_disabled'
          and a.source = d.jobname
          and a.resolved_at is null
     )
    returning 1
  )
  select count(*) into v_new from ins;

  update public.lcc_health_alerts a
     set resolved_at = now(),
         resolved_note = 'Auto-resolved: maintenance cron re-enabled (active)'
   where a.alert_kind = 'maintenance_cron_disabled'
     and a.resolved_at is null
     and exists (
       select 1 from cron.job j
        where j.jobname = a.source
          and j.active is true
     );
  get diagnostics v_resolved = row_count;

  select coalesce(jsonb_agg(a.jobname), '[]'::jsonb) into v_down
    from (
      values ('lcc-artifact-offload-edge'),('sf-sync-log-prune'),
             ('field-provenance-prune'),('lcc-context-packet-prune'),
             ('lcc-staged-intake-artifacts-prune'),('lcc-disk-health-check'),
             ('lcc-pg-net-response-cleanup'),
             ('lcc-provenance-flush-dia'),('lcc-provenance-flush-gov'),
             ('lcc-owner-reconcile-engine')
    ) as a(jobname)
   where not exists (
     select 1 from cron.job j where j.jobname = a.jobname and j.active is true
   );

  return jsonb_build_object(
    'new_alerts', v_new,
    'resolved', v_resolved,
    'down', coalesce(v_down, '[]'::jsonb)
  );
end;
$$;

-- ============================================================================
-- UNIT 4 — schedule the conservative verdicts-only drain + fold in the depth
-- check. 25/hour from the QUEUE, auto-merge OFF (merge=0). The engine handler
-- records same-party pairs as action='flagged_review' when merge is disabled, so
-- they surface in v_lcc_owner_reconcile_review for the Decision-Center lane
-- (human verdict), never a silent auto-merge.
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Replace the (incorrectly auto-merging, candidate-sourced) engine schedule
    -- with the audit-specified verdicts-only queue drain: 25 rows/hour, merge=0.
    BEGIN PERFORM cron.unschedule('lcc-owner-reconcile-engine'); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM cron.schedule(
      'lcc-owner-reconcile-engine',
      '25 * * * *',
      $cron$SELECT public.lcc_cron_post('/api/owner-reconcile-engine-tick?source=queue&limit=25&merge=0', '{}'::jsonb, 'vercel')$cron$
    );

    -- Fold the queue-depth check into the proven hourly health tick (no new
    -- watcher cron — a new watcher could itself be silently disabled).
    BEGIN PERFORM cron.unschedule('lcc-cron-health-check'); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM cron.schedule(
      'lcc-cron-health-check',
      '15 * * * *',
      'SELECT public.lcc_check_cron_health(); SELECT public.lcc_check_disabled_critical_crons(); SELECT public.lcc_check_research_backlog_growth(); SELECT public.lcc_check_feed_freshness(); SELECT public.lcc_check_provenance_flush_health(); SELECT public.lcc_check_owner_reconcile_queue_depth();'
    );
  END IF;
END $$;
