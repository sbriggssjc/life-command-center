-- ============================================================================
-- P123 — deal-email-matcher: make a DROPPED run distinguishable from a slow one.
--
-- THE BREAK (grounded live 2026-08-21, LCC Opps xengecqvemvfknjvbvrq):
--   `pg_net:no_response [/api/pipeline/match-deal-emails-cron]` was NOT a crash and
--   NOT a statement timeout. `lcc_cron_post` posts with `timeout_milliseconds := 60000`
--   and the handler took ~75-90 s, so pg_net gave up at exactly 60,000 ms on EVERY
--   hourly call (`net._http_response.timed_out = true`, "Timeout of 60000 ms reached"),
--   while Railway finished the work and wrote an ok=true run-log row a few seconds
--   later. The health check reported "6 in 24h" only because net._http_response is
--   pruned to a ~6-hour window — the real rate was 100% of retained calls.
--
--   The run itself was doing ~680 SEQUENTIAL PostgREST round trips per hour (one
--   idempotency GET + one roster-edge GET per matched email, 341 matches) to
--   rediscover that every single one was ALREADY attributed: `emails_attributed: 0`
--   / `already_attributed: 341`, unchanged hour after hour. Per-deal candidate SQL
--   was only ~100 ms (36 deals ≈ 3.6 s) — the DB was never the problem. That is the
--   P159a shape: a worker whose own tally reads like throughput while the state
--   delta is zero.
--
-- WHAT THIS MIGRATION DOES (additive only — no data mutated):
--   The run log could only ever be written AFTER the run finished, so a request
--   that died mid-flight left NO row at all and was indistinguishable from a run
--   that never fired. The handler now writes the row FIRST (status='started') and
--   PATCHes it on completion; these columns carry that lifecycle plus the per-run
--   work budget (deadline/cursor) that keeps a run inside pg_net's window.
--
-- Reversal: ALTER TABLE public.lcc_deal_match_run_log DROP COLUMN <each>;
--           DROP VIEW public.v_lcc_deal_match_run_health, public.v_lcc_deal_match_stalled_runs;
-- ============================================================================

ALTER TABLE public.lcc_deal_match_run_log
  ADD COLUMN IF NOT EXISTS status               text NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS finished_at          timestamptz,
  ADD COLUMN IF NOT EXISTS duration_ms          integer,
  ADD COLUMN IF NOT EXISTS deals_total          integer,
  ADD COLUMN IF NOT EXISTS cursor_start         integer,
  ADD COLUMN IF NOT EXISTS cursor_end           integer,
  ADD COLUMN IF NOT EXISTS budget_stopped       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS candidates_truncated integer;

-- Safe to add NOW (not "after the writer deploy"): the currently-deployed writer
-- never sets `status`, so every row it inserts takes the 'completed' default and
-- passes. Only the NEW writer emits 'started'/'failed'.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.lcc_deal_match_run_log'::regclass
       AND conname  = 'chk_deal_match_run_log_status'
  ) THEN
    ALTER TABLE public.lcc_deal_match_run_log
      ADD CONSTRAINT chk_deal_match_run_log_status
      CHECK (status IN ('started', 'completed', 'failed'));
  END IF;
END $$;

COMMENT ON COLUMN public.lcc_deal_match_run_log.status IS
  'started = row written at request entry, never updated ⇒ the run was DROPPED mid-flight '
  '(pg_net timeout, Railway restart, crash). completed/failed = the handler came back.';
COMMENT ON COLUMN public.lcc_deal_match_run_log.duration_ms IS
  'Wall-clock ms inside the handler. Must stay well under lcc_cron_post''s 60000 ms pg_net window.';
COMMENT ON COLUMN public.lcc_deal_match_run_log.cursor_end IS
  'Index into the eligible-deal list where the NEXT run resumes. Lets one invocation drain a '
  'bounded slice and advance instead of re-scanning everything and blowing the response window.';
COMMENT ON COLUMN public.lcc_deal_match_run_log.budget_stopped IS
  'TRUE = this run hit its deadline/write cap and stopped early (work remains). Never a silent cap.';
COMMENT ON COLUMN public.lcc_deal_match_run_log.candidates_truncated IS
  'Count of deals whose candidate scan hit the per-deal page cap, so matches beyond it were not '
  'seen. PostgREST caps a response at 1000 rows regardless of limit= — this makes the loss visible.';

-- Latest-run-per-status lookups (cursor read + stalled-run sweep).
CREATE INDEX IF NOT EXISTS idx_deal_match_run_log_status_run
  ON public.lcc_deal_match_run_log (status, run_id DESC);

-- ── Observability: a run that never came back ───────────────────────────────
CREATE OR REPLACE VIEW public.v_lcc_deal_match_stalled_runs AS
SELECT run_id, ran_at, trigger_source, dry_run, cursor_start,
       round(extract(epoch FROM (now() - ran_at))::numeric, 0) AS stalled_secs
  FROM public.lcc_deal_match_run_log
 WHERE status = 'started'
   AND ran_at < now() - interval '10 minutes'
 ORDER BY run_id DESC;

COMMENT ON VIEW public.v_lcc_deal_match_stalled_runs IS
  'P123 — runs whose row was opened and never closed: the handler did not return. '
  'Non-empty means dropped runs, which pre-P123 left no trace at all.';

CREATE OR REPLACE VIEW public.v_lcc_deal_match_run_health AS
SELECT run_id, ran_at, finished_at, status, ok, duration_ms,
       deals_scanned, deals_total, cursor_start, cursor_end, budget_stopped,
       deals_with_matches, emails_attributed, already_attributed, roster_edges,
       candidates_truncated, error_count
  FROM public.lcc_deal_match_run_log
 WHERE dry_run = false
 ORDER BY run_id DESC;

COMMENT ON VIEW public.v_lcc_deal_match_run_health IS
  'P123 — one line per real matcher run. Judge it by emails_attributed (the STATE DELTA), '
  'never by already_attributed (which is a re-discovery tally, not work performed).';

GRANT SELECT ON public.v_lcc_deal_match_stalled_runs TO service_role;
GRANT SELECT ON public.v_lcc_deal_match_run_health  TO service_role;
