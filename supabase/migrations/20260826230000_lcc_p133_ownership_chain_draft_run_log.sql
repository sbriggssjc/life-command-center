-- ============================================================================
-- P133 — observability for the P131 ownership-chain drafter, ahead of putting
-- it on a nightly schedule.
--
-- WHY. P131 shipped the drafter (POST /api/ownership-chain-draft-tick, flag
-- OWNERSHIP_CHAIN_DRAFT, now ON) and it was drained BY HAND — six POSTs until
-- the tick reported `already_drafted:545, fresh:0`. Every lane row minted after
-- that (as gov transitions land and new asset entities mint) gets no draft until
-- somebody remembers to re-run it. CLAUDE.md: "a one-shot repair of a RECURRING
-- producer is a chore you repeat silently forever — pair it with a scheduled
-- sweep" (P176). The companion migration schedules that sweep.
--
-- A schedule without a run log is the failure mode this repo keeps re-learning:
-- pg_net records only the HTTP attempt (and `net._http_response` is pruned to a
-- ~6-hour window — P123), `lcc_cron_post_log` records only that a request was
-- POSTed, and cron.job_run_details says the SQL succeeded, which it does even
-- when the handler never answers. None of those can tell a drafted night from a
-- dropped one. So the tick gets its own ledger, on the P123 lifecycle:
--
--   * the row is OPENED at request entry with status='started', and PATCHed on
--     the way out. A row still reading 'started' means the handler never came
--     back (pg_net timeout, Railway restart, crash) — pre-P123 that left NO row
--     and was indistinguishable from a cron that never fired.
--   * the honest number is `written_draftable` (the STATE DELTA — drafts newly
--     in lcc_clean_assist_proposals), never `already_drafted`, which is a
--     re-discovery tally and reads exactly like throughput while nothing moves
--     (P159a / P123).
--   * `capped` + `backlog_remaining` keep a capped run from reading "done". The
--     tick writes at most `batch_limit` (100) rows per night by design; a night
--     that hits the cap is a night with work left, and says so.
--
-- DEPLOY ORDER. Additive schema, so it goes in BEFORE the JS writer ships
-- ("additive schema before writer; constraint after writer deploy"). The
-- currently-deployed handler writes nothing here; the run-log write is fail-soft
-- in JS, so neither ordering can break a tick.
--
-- REVERSAL RUNBOOK
--   drop view if exists public.v_lcc_ownership_chain_draft_run_health;
--   drop view if exists public.v_lcc_ownership_chain_draft_stalled_runs;
--   drop table if exists public.lcc_ownership_chain_draft_run_log;
--   -- the drafts themselves stay reversible exactly as P131 documented:
--   -- delete from lcc_clean_assist_proposals where source='ownership_chain_draft';
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.lcc_ownership_chain_draft_run_log (
  run_id               bigserial PRIMARY KEY,
  ran_at               timestamptz NOT NULL DEFAULT now(),
  finished_at          timestamptz,
  duration_ms          integer,
  status               text NOT NULL DEFAULT 'started',
  ok                   boolean,
  trigger_source       text,              -- 'cron' | 'manual' | 'api'
  -- The tick's own batch tag (p131_<ts>_<uuid8>). Joins straight to
  -- lcc_clean_assist_proposals.source_run_id, so a run's drafts are inspectable.
  source_run_id        text,
  flag_enabled         boolean,
  role_labels_enabled  boolean,
  batch_limit          integer,
  -- Scan shape.
  open_lane_rows       integer,           -- open establish_ownership_history rows seen
  already_drafted      integer,           -- re-discovery tally — NEVER read as throughput
  fresh                integer,           -- open rows with no draft yet
  -- Work performed (the state delta).
  written_draftable    integer,
  written_insufficient integer,
  failed_writes        integer,
  -- Honest caps.
  backlog_remaining    integer NOT NULL DEFAULT 0,
  capped               boolean NOT NULL DEFAULT false,
  budget_stopped       boolean NOT NULL DEFAULT false,
  lane_scan_capped     boolean NOT NULL DEFAULT false,
  error_count          integer NOT NULL DEFAULT 0,
  detail               jsonb
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.lcc_ownership_chain_draft_run_log'::regclass
       AND conname  = 'chk_ownership_chain_draft_run_log_status'
  ) THEN
    ALTER TABLE public.lcc_ownership_chain_draft_run_log
      ADD CONSTRAINT chk_ownership_chain_draft_run_log_status
      CHECK (status IN ('started', 'completed', 'failed'));
  END IF;
END $$;

COMMENT ON TABLE public.lcc_ownership_chain_draft_run_log IS
  'P133 — one row per POST to /api/ownership-chain-draft-tick. Opened at entry (status=started), '
  'closed on the way out. Judge a run by written_draftable (the state delta), never by '
  'already_drafted (a re-discovery tally).';
COMMENT ON COLUMN public.lcc_ownership_chain_draft_run_log.status IS
  'started = row opened at request entry and never closed ⇒ the run was DROPPED mid-flight '
  '(pg_net 60s timeout, Railway restart, crash). completed/failed = the handler came back.';
COMMENT ON COLUMN public.lcc_ownership_chain_draft_run_log.already_drafted IS
  'Lane rows that already carried a draft. A RE-DISCOVERY tally, not work performed — on a quiet '
  'night this is the whole population and written_draftable is 0, which is the correct outcome.';
COMMENT ON COLUMN public.lcc_ownership_chain_draft_run_log.written_draftable IS
  'Drafts newly written to lcc_clean_assist_proposals (source ownership_chain_draft). THE number.';
COMMENT ON COLUMN public.lcc_ownership_chain_draft_run_log.capped IS
  'TRUE = the run ended with fresh lane rows still undrafted — batch cap, budget stop, write failures, '
  'or the flag being off ⇒ work remains for tomorrow. The next run resumes, so a backlog drains; but a '
  'run that stopped short must never read as "done". Never a silent cap.';
COMMENT ON COLUMN public.lcc_ownership_chain_draft_run_log.lane_scan_capped IS
  'TRUE = the open-lane read itself hit its page cap, so backlog_remaining is a FLOOR, not a total.';
COMMENT ON COLUMN public.lcc_ownership_chain_draft_run_log.flag_enabled IS
  'FALSE = OWNERSHIP_CHAIN_DRAFT was off, so the tick no-opped by design. The cron is deliberately '
  'NOT gated on the flag — a fired-and-skipped run is recorded rather than invisible.';

CREATE INDEX IF NOT EXISTS idx_ownership_chain_draft_run_log_status_run
  ON public.lcc_ownership_chain_draft_run_log (status, run_id DESC);

-- ── Observability ───────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_lcc_ownership_chain_draft_stalled_runs AS
SELECT run_id, ran_at, trigger_source, source_run_id, batch_limit,
       round(extract(epoch FROM (now() - ran_at))::numeric, 0) AS stalled_secs
  FROM public.lcc_ownership_chain_draft_run_log
 WHERE status = 'started'
   AND ran_at < now() - interval '10 minutes'
 ORDER BY run_id DESC;

COMMENT ON VIEW public.v_lcc_ownership_chain_draft_stalled_runs IS
  'P133 — drafter runs whose row was opened and never closed: the handler did not return. '
  'Non-empty means dropped runs, which without the run log leave no trace at all.';

CREATE OR REPLACE VIEW public.v_lcc_ownership_chain_draft_run_health AS
SELECT run_id, ran_at, finished_at, status, ok, duration_ms, trigger_source,
       flag_enabled, role_labels_enabled, batch_limit,
       open_lane_rows, already_drafted, fresh,
       written_draftable, written_insufficient, failed_writes,
       backlog_remaining, capped, budget_stopped, lane_scan_capped, error_count,
       source_run_id
  FROM public.lcc_ownership_chain_draft_run_log
 ORDER BY run_id DESC;

COMMENT ON VIEW public.v_lcc_ownership_chain_draft_run_health IS
  'P133 — one line per drafter run. written_draftable is the state delta; already_drafted is not. '
  'capped/backlog_remaining say whether the night finished the lane or merely finished its batch.';

GRANT SELECT ON public.v_lcc_ownership_chain_draft_stalled_runs TO service_role;
GRANT SELECT ON public.v_lcc_ownership_chain_draft_run_health  TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.lcc_ownership_chain_draft_run_log TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.lcc_ownership_chain_draft_run_log_run_id_seq TO service_role;
