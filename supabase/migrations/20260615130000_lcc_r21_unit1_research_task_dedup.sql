-- ============================================================================
-- R21 Unit 1 — stop research_task duplicate generation + clean up (root cause)
-- ============================================================================
-- Grounded live 2026-06-15: research_tasks had 7,961 queued
-- property_missing_recorded_owner rows for only 1,534 distinct properties
-- (avg 5.2x, worst 140x for one property), 1,597 true_owner_needs_salesforce
-- for 748 distinct, etc. The apparent "completion stall" was a dupe explosion.
--
-- ROOT CAUSE: the generator (api/admin.js handleGenerateResearchTasks, crons
-- generate-research-tasks + -inc) dedupes against the existing OPEN task set,
-- but that fetch hit PostgREST's 1000-row response cap (10,002 queued tasks
-- existed). So the per-run dedupe only covered the first 1000 queued tasks —
-- every gap beyond row 1000 re-inserted on every tick. Concurrent daily+inc
-- ticks compound it.
--
-- THE DURABLE FIX is a DB-level guard so a duplicate OPEN task is impossible
-- regardless of writer path, the 1000-row cap, or concurrent ticks. The JS
-- side is fixed in parallel (full pagination of the open set + 409-tolerant
-- insert) but the index is the guarantee.
--
-- Additive + idempotent. Auth schema (GoTrue / users / workspace_memberships)
-- untouched. Bounded UPDATE (~6.4k rows) + a small partial index on a ~13k-row
-- table; no long locks.
-- ============================================================================

BEGIN;

-- (1) Collapse existing OPEN duplicates. Keep the OLDEST open task per
-- (source_table, source_record_id, research_type, domain); mark the rest
-- terminal 'skipped' (NOT 'completed' — these gaps are NOT resolved, so they
-- must not inflate the completion/resolved metric the audit flagged). The
-- collapse reason + the surviving task id are recorded in outcome jsonb — never
-- a hard delete (LCC Opps disk sensitivity); the retention prune below ages
-- them out.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY source_table, source_record_id, research_type, domain
           ORDER BY created_at ASC, id ASC
         ) AS rn,
         first_value(id) OVER (
           PARTITION BY source_table, source_record_id, research_type, domain
           ORDER BY created_at ASC, id ASC
         ) AS keep_id
  FROM public.research_tasks
  WHERE status IN ('queued','in_progress')
    AND source_record_id IS NOT NULL
)
UPDATE public.research_tasks t
SET status       = 'skipped',
    completed_at = now(),
    updated_at   = now(),
    outcome      = coalesce(t.outcome, '{}'::jsonb)
                   || jsonb_build_object(
                        'status',        'superseded',
                        'reason',        'r21_dedup_collapse',
                        'superseded_by', r.keep_id,
                        'collapsed_at',  now()
                      )
FROM ranked r
WHERE t.id = r.id
  AND r.rn > 1;

-- (2) The durable guard: at most one OPEN task per gap identity. Partial so a
-- gap that was completed/skipped and later reappears can legitimately re-queue
-- the same tuple. source_record_id NOT NULL because entity/owner-level tasks
-- without a source record are out of scope for this key (they dedupe on
-- entity_id via their own paths). Covers ALL research_types (the same dupe risk
-- hits true_owner_needs_salesforce / property_missing_true_owner /
-- trace_ownership_to_developer).
CREATE UNIQUE INDEX IF NOT EXISTS uq_research_tasks_open_source
  ON public.research_tasks (source_table, source_record_id, research_type, domain)
  WHERE status IN ('queued','in_progress') AND source_record_id IS NOT NULL;

-- (3) Retention prune for terminal tasks — the bounded-table discipline shared
-- with sf_sync_log / staged_intake_artifacts / field_provenance / context_packets.
-- Deletes completed/skipped tasks whose terminal timestamp is older than
-- p_retain (default 90 days). This DELETE is the expected retention path; the
-- "no hard delete" rule applies to the dupe collapse (step 1), not to aging out
-- long-terminal rows.
CREATE OR REPLACE FUNCTION public.lcc_prune_research_tasks(p_retain interval DEFAULT interval '90 days')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.research_tasks
  WHERE status IN ('completed','skipped')
    AND coalesce(completed_at, updated_at) < now() - p_retain;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$fn$;

COMMIT;

-- Cron: daily terminal-task retention (04:40 UTC, off shared minute marks).
-- Pure local SQL function, so call it directly (not via lcc_cron_post).
-- Idempotent unschedule-then-schedule.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-research-tasks-prune') THEN
    PERFORM cron.unschedule('lcc-research-tasks-prune');
  END IF;
  PERFORM cron.schedule('lcc-research-tasks-prune', '40 4 * * *',
    $$SELECT public.lcc_prune_research_tasks();$$);
END
$cron$;
