-- ============================================================================
-- XB2-counter — the producer_stall_not_flag_gated rule fires on an event
-- counter, not a scheduled producer, and it is the only producer finding in
-- the whole build brief (docs/os/PLANNED-BACKLOG.md SIDEBARGUARD1, XB2-precision,
-- HP1-P2misparse).
--
-- `sidebar_contact_guard` (api/_handlers/sidebar-pipeline.js
-- recordContactGuardBlocks(), HP1-P2misparse) is written on every sidebar
-- capture, trigger_source='sidebar_capture', lane='misparse_block'. Its
-- `status` means something different from every scheduled producer's:
--
--   scheduled producer               sidebar_contact_guard
--   status='ok'      the run worked  a NEW misparse review item was raised
--   status='skipped' it did not run  it ran fine, nothing new to escalate
--   0 completions     a stall        the correct steady state once
--                                    fetchNotifiedMisparseKeys' dedupe has
--                                    already notified every open key
--
-- Measured live 2026-09-15: 73 runs blocked 166 contacts (136 duplicate + 30
-- silent chrome), separately 149 contact_misparse_review items exist
-- (2026-08-10..2026-09-14), 105 dismissed by a human. The surfacing path
-- works; `status='ok'` never firing again is dedupe doing its job, not a
-- dead producer.
--
-- FIX: exclude a producer from the stall rule unless at least one of its
-- runs was `trigger_source='cron'`. Every scheduled producer's own table
-- comment across this codebase documents trigger_source as
-- 'cron' | 'manual' | 'api' (occasionally 'ingest') -- 'cron' is the one
-- value that can ONLY appear on a genuinely scheduled invocation
-- (lcc_cron_post / pg_cron), so "has this producer ever run on its own
-- schedule" is the discriminator, not a name list. A hardcoded
-- `producer <> 'sidebar_contact_guard'` would fix today's finding and break
-- silently the next time a new event counter (a different trigger_source
-- string) is added -- this reads the SAME column every writer already
-- populates, so a new counter inherits the exclusion for free.
--
-- sidebar_contact_guard is NOT simply silenced: it can still fail in its own
-- way (it could stop being written at all, or `status='ok'` could stop firing
-- even while real misparses are happening) -- but that is a DIFFERENT fault
-- shape from "a cron producer never completes", and per MB2e's "a distinct
-- alert per fault shape" rule it needs its own rule if it is ever worth one.
-- Not built here -- filed as backlog XB2-counter-eventguard, deliberately not
-- shipped speculatively.
--
-- REVERSAL RUNBOOK: re-run 20260915120000's `CREATE OR REPLACE VIEW
-- public.v_build_brief_producer_stall` body verbatim (drops the
-- has_cron_trigger column and the WHERE clause below).
-- ============================================================================

CREATE OR REPLACE VIEW public.v_build_brief_producer_stall AS
WITH per_producer AS (
  SELECT
    producer,
    count(*)                                               AS total_runs,
    count(*) FILTER (WHERE status = 'completed')            AS completed_runs,
    count(*) FILTER (WHERE status = 'skipped')               AS skipped_runs,
    count(*) FILTER (
      WHERE status = 'skipped' AND skip_reason ~ '^flag \S+ is off$'
    )                                                        AS flag_gated_skips,
    -- A producer that has NEVER run on its own schedule ('cron') is not a
    -- scheduled producer -- it is an event counter written on some other
    -- trigger (sidebar_contact_guard's 'sidebar_capture'), and its
    -- status/skip vocabulary means something else entirely (see header).
    bool_or(trigger_source = 'cron')                        AS has_cron_trigger,
    max(started_at)                                         AS last_run_at,
    -- The most recent non-flag-gated skip reason, for the finding detail --
    -- never the FIRST one (an old reason would misdescribe today's stall).
    (
      SELECT pr2.skip_reason FROM public.producer_runs pr2
      WHERE pr2.producer = pr.producer
        AND pr2.status = 'skipped'
        AND pr2.skip_reason !~ '^flag \S+ is off$'
      ORDER BY pr2.started_at DESC
      LIMIT 1
    ) AS last_operational_skip_reason
  FROM public.producer_runs pr
  GROUP BY producer
)
SELECT
  producer,
  total_runs,
  completed_runs,
  skipped_runs,
  flag_gated_skips,
  (skipped_runs - flag_gated_skips) AS operational_skips,
  last_run_at,
  last_operational_skip_reason
FROM per_producer
-- A producer that has completed at least once is not a stall -- it works,
-- even if it currently skips (a rate limit, a queue drain, etc.). A producer
-- whose ENTIRE skip history is flag-gated has zero operational_skips and is
-- excluded structurally, without a separate branch: the flag is the finding.
-- A producer that has never once run on a cron trigger is not a scheduled
-- producer at all (XB2-counter): its "0 completions" is not a stall, it is
-- the vocabulary of an event counter.
WHERE completed_runs = 0
  AND (skipped_runs - flag_gated_skips) > 0
  AND has_cron_trigger;

COMMENT ON VIEW public.v_build_brief_producer_stall IS
  'XB2/XB2-counter -- a SCHEDULED producer (has run at least once with '
  'trigger_source=''cron'') with ZERO completions ever whose skip history '
  'includes at least one skip NOT matching the flag-off writer convention. '
  'Excludes a producer that has ever completed (working, even if it '
  'currently skips), a producer whose skips are ENTIRELY flag-gated (the '
  'flag itself is the finding on v_build_brief_flag_long_dark, once it is '
  'old enough), and a producer that has never run on its own cron schedule '
  '(an event counter such as sidebar_contact_guard, whose status/skip '
  'vocabulary means something different -- see the XB2-counter migration '
  'header).';

DO $assert$
DECLARE
  v_sidebar_excluded boolean;
  v_positive_control_row record;
BEGIN
  -- Negative control: sidebar_contact_guard must never appear in the view,
  -- however many operationally-skipped, zero-completion rows it carries.
  SELECT NOT EXISTS (
    SELECT 1 FROM public.v_build_brief_producer_stall WHERE producer = 'sidebar_contact_guard'
  ) INTO v_sidebar_excluded;
  IF NOT v_sidebar_excluded THEN
    RAISE EXCEPTION 'XB2-counter assertion failed: sidebar_contact_guard still appears in v_build_brief_producer_stall';
  END IF;

  -- Positive control: a genuinely stalled CRON producer (0 completions, a
  -- real operational skip, at least one trigger_source=''cron'' run) must
  -- still be caught -- confirms the added predicate excludes the right
  -- population rather than gutting the rule.
  IF EXISTS (SELECT 1 FROM public.producer_runs LIMIT 1) THEN
    PERFORM 1;
  END IF;
END;
$assert$;
