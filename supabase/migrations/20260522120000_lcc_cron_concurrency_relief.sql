-- ============================================================================
-- 2026-05-22 — pg_cron worker-pool contention relief (LCC Opps)
--
-- ROOT CAUSE of the "job startup timeout" alert storm (2026-05-20 .. 05-22):
--   The LCC Opps instance has only 6 background-worker slots
--   (max_worker_processes = 6, source = configuration file), but pg_cron's
--   cron.max_running_jobs defaults to 32. When several jobs fire in the same
--   minute, pg_cron tries to register more dynamic background workers than the
--   pool can supply; the ones that can't grab a slot fail at launch with
--   "job startup timeout". Because the launcher then backs up and releases a
--   backlog at once, unrelated jobs were observed failing together at identical
--   drifted timestamps (e.g. four jobs all "starting" at 15:20:00.000146).
--
--   The async lcc_cron_post() jobs return in milliseconds (they only enqueue a
--   pg_net request), so they are not the contention source. The pile-up was the
--   *synchronous* SQL jobs clustering in the :15-:20 window:
--     :15 lcc-cron-health-check, :17 lcc-retry-stranded-extractions (*/5),
--     :18 refresh-work-counts (*/5), :20 lcc-autoresolve-http-alerts.
--
-- WHY THIS MIGRATION (and not a GUC change):
--   The proper durable fix is to lower cron.max_running_jobs to <= the worker
--   pool (e.g. 4) OR raise max_worker_processes via a larger compute add-on.
--   Both require a server restart and are blocked from the SQL API on Supabase
--   ("permission denied" / "cannot be changed without restarting the server").
--   Until that is done in the Dashboard, we relieve the contention by thinning
--   and spreading the heavy synchronous jobs so no minute's launch burst can
--   exceed the free worker slots.
--
-- DURABLE FOLLOW-UP (do this in the Supabase Dashboard, then a restart):
--   Database -> Settings -> custom Postgres config: set
--     cron.max_running_jobs = 4
--   and restart. After that, this schedule thinning can optionally be reverted.
--
-- Idempotent: cron.alter_job is a no-op if the schedule already matches.
-- ============================================================================

DO $$
DECLARE
  v_id bigint;
BEGIN
  -- lcc-retry-stranded-extractions: every 5m (2-59/5) -> every 15m at :07/:22/:37/:52,
  -- moved off the :15-:20 synchronous pile-up window.
  SELECT jobid INTO v_id FROM cron.job WHERE jobname = 'lcc-retry-stranded-extractions';
  IF v_id IS NOT NULL THEN
    PERFORM cron.alter_job(v_id, schedule => '7-59/15 * * * *');
  END IF;

  -- refresh-work-counts: every 5m (3-59/5) -> every 10m (3-59/10). Drops the
  -- :08/:18/:28/... firings, halving the launch rate of this synchronous job.
  SELECT jobid INTO v_id FROM cron.job WHERE jobname = 'refresh-work-counts';
  IF v_id IS NOT NULL THEN
    PERFORM cron.alter_job(v_id, schedule => '3-59/10 * * * *');
  END IF;

  -- dia-link-provenance-replay: every 5m (1-59/5) -> every 10m (1-59/10).
  -- This one is an async lcc_cron_post (fast), but halving its cadence further
  -- reduces per-minute launcher pressure with no material loss in replay latency.
  SELECT jobid INTO v_id FROM cron.job WHERE jobname = 'dia-link-provenance-replay';
  IF v_id IS NOT NULL THEN
    PERFORM cron.alter_job(v_id, schedule => '1-59/10 * * * *');
  END IF;
END $$;

-- Verification (run manually after apply):
--   SELECT jobid, jobname, schedule FROM cron.job
--    WHERE jobname IN ('lcc-retry-stranded-extractions','refresh-work-counts','dia-link-provenance-replay');
--   -- expect 7-59/15, 3-59/10, 1-59/10 respectively.
--   SELECT jobname, status, return_message, start_time
--     FROM cron.job_run_details d JOIN cron.job j ON j.jobid=d.jobid
--    WHERE d.start_time > now() - interval '2 hours' AND d.status <> 'succeeded';
--   -- expect no new 'job startup timeout' rows.
