-- ===========================================================================
-- W7.2 — the deal-comms propagation tick (the heart of Wave 7).
-- See docs/architecture/WAVE7_COMMS_CONTEXT_PROPAGATION_PLAN.md §W7.2.
--
-- W7.1 (LIVE) stamps Outlook mail onto open deals as activity_events
-- (source_type='lcc:deal_match' + ingest-time dual-anchor rows carrying
-- metadata->>'deal_entity_id'). NOTHING ticked the deal state forward from
-- those comms. This migration builds the DB side of the tick handler
-- (api/_handlers/deal-comms-propagate-tick.js):
--
--   1. lcc_deal_comm_propagated       — per-activity consumption LEDGER (the
--      tick's OWN seam, W5.2b doctrine: one seam, one writer). idempotent.
--   2. lcc_deal_comms_propagation_run_log — observability ledger (mirrors
--      lcc_deal_match_run_log): one row per tick.
--   3. lcc_deal_comms_unpropagated()  — the per-tick batch reader. Picks the
--      deals with NEW (un-ledgered) stamped comms, oldest-backlog first, capped,
--      and returns BOTH the full comm corpus (drives the summary) and the
--      is_new subset (drives milestones/to-dos/ledger) in one round-trip.
--   4. lcc_deal_record_milestone()    — idempotent milestone writer (the
--      DETERMINISTIC cue path; ON CONFLICT DO NOTHING on the existing
--      uq_lcc_deal_milestone index).
--   5. feature_flags_registry row DEAL_COMMS_PROPAGATE (inert until flipped).
--   6. pg_cron lcc-deal-comms-propagate — hourly at :32 (≈15min after the W7.1
--      matcher at :17); no-ops until DEAL_COMMS_PROPAGATE_ENABLED is set.
--
-- Discipline: LLM SUMMARIZES/PROPOSES only; the auditable writes (milestones
-- from cues, to-dos via the Phase-1 guarded path, ledger rows) are
-- deterministic. Additive, idempotent, reversible (DROP the two tables + the
-- two functions + unschedule the cron). APPLIED LIVE to LCC Opps
-- (xengecqvemvfknjvbvrq).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Consumption ledger — the tick's own seam, keyed per activity_event.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lcc_deal_comm_propagated (
  activity_event_id uuid PRIMARY KEY,      -- the consumed deal-stamped comm
  entity_id         uuid NOT NULL,         -- the deal/asset entity it propagated to
  propagated_at     timestamptz NOT NULL DEFAULT now(),
  actions           jsonb NOT NULL DEFAULT '{}'::jsonb  -- {summary,milestone,todo,...} outcomes
);
CREATE INDEX IF NOT EXISTS lcc_deal_comm_propagated_entity_idx
  ON public.lcc_deal_comm_propagated (entity_id, propagated_at DESC);
COMMENT ON TABLE public.lcc_deal_comm_propagated IS
  'W7.2 — per-activity consumption ledger for the deal-comms propagation tick. A ledgered activity_event never reprocesses (idempotent catch-up). The tick''s OWN seam; do not share another consumer''s.';

-- ---------------------------------------------------------------------------
-- 2. Run log — one row per tick (mirrors lcc_deal_match_run_log).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lcc_deal_comms_propagation_run_log (
  run_id                 bigserial PRIMARY KEY,
  ran_at                 timestamptz NOT NULL DEFAULT now(),
  trigger_source         text,                    -- 'cron' | 'manual' | 'api'
  dry_run                boolean NOT NULL DEFAULT false,
  deals_scanned          integer,                 -- deals with new comms this tick
  deals_processed        integer,
  comms_consumed         integer,                 -- new activity rows ledgered
  summaries_written      integer,
  summary_skipped        integer,                 -- AI down/empty → prior kept
  milestones_written     integer,                 -- deterministic cue writes
  milestone_candidates   integer,                 -- LLM-only → confirm lane
  todos_generated        integer,
  todos_deduped          integer,
  dossiers_regenerated   integer,
  packets_refreshed      integer,
  error_count            integer NOT NULL DEFAULT 0,
  ok                     boolean NOT NULL DEFAULT true,
  detail                 jsonb
);
COMMENT ON TABLE public.lcc_deal_comms_propagation_run_log IS
  'W7.2 — one row per deal-comms propagation tick (cron/manual). Feeds the propagation-freshness / loud-failure checks.';

-- ---------------------------------------------------------------------------
-- 3. The per-tick batch reader.
--    Returns a jsonb ARRAY of deals that have ≥1 NEW (un-ledgered) stamped comm,
--    OLDEST-backlog first, capped to p_max_deals. Each deal carries its full
--    comm corpus (newest p_corpus_cap, for the summary) with per-comm flags:
--      is_new    — un-ledgered (drives milestone/to-do/ledger writes)
--      is_inbound— derived from metadata.direction / email_bodies.is_sent
--      is_recent — occurred within p_recent_days (to-do eligibility)
--    Direction/sender/subject/body are reconciled across the two stamp shapes:
--      • lcc:deal_match rows → join email_bodies via metadata->>'source_email_id'
--      • ingest dual-anchor rows → metadata.direction / metadata.from + ae.body
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_deal_comms_unpropagated(
  p_max_deals  integer DEFAULT 10,
  p_recent_days integer DEFAULT 7,
  p_corpus_cap integer DEFAULT 80
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH stamped AS (
    SELECT
      ae.id AS activity_id,
      COALESCE(ae.entity_id, NULLIF(ae.metadata->>'deal_entity_id','')::uuid) AS deal_entity_id,
      ae.title,
      ae.body,
      ae.occurred_at,
      ae.source_type,
      ae.metadata,
      NOT EXISTS (
        SELECT 1 FROM public.lcc_deal_comm_propagated p WHERE p.activity_event_id = ae.id
      ) AS is_new
    FROM public.activity_events ae
    WHERE (ae.source_type = 'lcc:deal_match' OR (ae.metadata->>'deal_entity_id') IS NOT NULL)
      AND COALESCE(ae.entity_id, NULLIF(ae.metadata->>'deal_entity_id','')::uuid) IS NOT NULL
  ),
  picked AS (          -- deals with ≥1 new comm, oldest-backlog first
    SELECT deal_entity_id, MIN(occurred_at) AS oldest_new
    FROM stamped
    WHERE is_new
    GROUP BY deal_entity_id
    ORDER BY MIN(occurred_at) ASC NULLS FIRST
    LIMIT GREATEST(1, COALESCE(p_max_deals, 10))
  ),
  corpus AS (
    SELECT
      s.*,
      eb.is_sent, eb.from_name, eb.from_email, eb.subject AS eb_subject,
      eb.body_text, eb.body_preview,
      ROW_NUMBER() OVER (PARTITION BY s.deal_entity_id ORDER BY s.occurred_at DESC NULLS LAST, s.activity_id) AS rn
    FROM stamped s
    JOIN picked pk ON pk.deal_entity_id = s.deal_entity_id
    LEFT JOIN public.email_bodies eb
      ON eb.id = NULLIF(s.metadata->>'source_email_id','')::uuid
  ),
  shaped AS (
    SELECT
      c.deal_entity_id,
      jsonb_build_object(
        'activity_id', c.activity_id,
        'occurred_at', c.occurred_at,
        'source_type', c.source_type,
        'is_new',      c.is_new,
        'subject',     COALESCE(NULLIF(c.title,''), c.eb_subject),
        'sender',      COALESCE(NULLIF(c.metadata->>'from',''), c.from_name, c.from_email),
        'body',        LEFT(COALESCE(NULLIF(c.body,''), c.body_text, c.body_preview, ''), 4000),
        'direction',   CASE
                          WHEN NULLIF(c.metadata->>'direction','') IS NOT NULL THEN c.metadata->>'direction'
                          WHEN c.is_sent IS TRUE THEN 'outbound'
                          WHEN c.is_sent IS FALSE THEN 'inbound'
                          ELSE NULL
                        END,
        'is_inbound',  CASE
                          WHEN NULLIF(c.metadata->>'direction','') IS NOT NULL THEN (c.metadata->>'direction') = 'inbound'
                          WHEN c.is_sent IS FALSE THEN true
                          WHEN c.is_sent IS TRUE THEN false
                          ELSE false
                        END,
        'is_recent',   (c.occurred_at IS NOT NULL AND c.occurred_at >= now() - make_interval(days => GREATEST(0, COALESCE(p_recent_days,7)))),
        'party_entity_id', COALESCE(NULLIF(c.metadata->>'party_entity_id',''), NULLIF(c.metadata->>'source_entity_id',''))
      ) AS comm,
      c.occurred_at, c.rn
    FROM corpus c
    WHERE c.rn <= GREATEST(1, COALESCE(p_corpus_cap, 80))
  )
  SELECT COALESCE(jsonb_agg(deal ORDER BY oldest_new ASC NULLS FIRST), '[]'::jsonb)
  FROM (
    SELECT
      sh.deal_entity_id AS entity_id,
      (SELECT e.name FROM public.entities e WHERE e.id = sh.deal_entity_id) AS deal_name,
      pk.oldest_new,
      jsonb_agg(sh.comm ORDER BY sh.occurred_at ASC NULLS FIRST) AS comms
    FROM shaped sh
    JOIN picked pk ON pk.deal_entity_id = sh.deal_entity_id
    GROUP BY sh.deal_entity_id, pk.oldest_new
  ) deal;
$function$;

COMMENT ON FUNCTION public.lcc_deal_comms_unpropagated(integer,integer,integer) IS
  'W7.2 — per-tick batch: deals with new (un-ledgered) deal-stamped comms, oldest first, capped. Each carries its full comm corpus (is_new/is_inbound/is_recent flagged).';

-- ---------------------------------------------------------------------------
-- 4. Deterministic milestone writer (idempotent). The cue-detection lives in
--    JS (api/_shared/deal-milestone-cues.js); this just lands the row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lcc_deal_record_milestone(
  p_entity     uuid,
  p_key        text,
  p_on         date,
  p_status     text,
  p_summary    text,
  p_source     text DEFAULT 'comms_tick',
  p_detail_ref text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ins integer;
BEGIN
  IF p_entity IS NULL OR p_key IS NULL OR btrim(p_key) = '' THEN
    RETURN false;
  END IF;
  INSERT INTO public.lcc_deal_milestone
    (entity_id, milestone_key, occurred_on, status, summary, source, detail_ref)
  VALUES
    (p_entity, p_key, p_on,
     CASE WHEN p_status IN ('past','now','next') THEN p_status ELSE 'past' END,
     p_summary, COALESCE(NULLIF(p_source,''),'comms_tick'), p_detail_ref)
  ON CONFLICT (entity_id, milestone_key, COALESCE(occurred_on,'0001-01-01'::date))
  DO NOTHING;
  GET DIAGNOSTICS v_ins = ROW_COUNT;
  RETURN v_ins > 0;
END;
$function$;

COMMENT ON FUNCTION public.lcc_deal_record_milestone(uuid,text,date,text,text,text,text) IS
  'W7.2 — idempotent deterministic milestone writer (ON CONFLICT DO NOTHING on uq_lcc_deal_milestone). Used by the comms tick cue path AND the milestone_confirm verdict (source=comms_tick_confirmed).';

-- Grants (called via PostgREST with the service key; keep parity with peers).
GRANT EXECUTE ON FUNCTION public.lcc_deal_comms_unpropagated(integer,integer,integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lcc_deal_record_milestone(uuid,text,date,text,text,text,text) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Feature-flag registry: the propagation-tick gate (inert until flipped).
-- ---------------------------------------------------------------------------
INSERT INTO public.feature_flags_registry (flag, purpose, surface, env_var, state, off_since, owner, notes)
VALUES (
  'DEAL_COMMS_PROPAGATE_CRON',
  'Hourly propagation tick: deal-stamped comms → correspondence summary / milestones / next-step to-dos / dossier + context-packet freshness.',
  'api/_handlers/deal-comms-propagate-tick.js (cron /api/deal-comms-propagate-tick)',
  'DEAL_COMMS_PROPAGATE_ENABLED',
  'off', now(), 'scott',
  'W7.2. pg_cron job lcc-deal-comms-propagate posts hourly at :32; the handler no-ops until DEAL_COMMS_PROPAGATE_ENABLED is set in Railway. GET ?dry_run=1 reports what it WOULD process; ?force=1 runs one live tick without the flag. Depends on W7.1 (DEAL_EMAIL_MATCH) producing stamped comms.'
)
ON CONFLICT (flag) DO UPDATE SET
  purpose=EXCLUDED.purpose, surface=EXCLUDED.surface, env_var=EXCLUDED.env_var, notes=EXCLUDED.notes;

-- ---------------------------------------------------------------------------
-- 6. Recurring cron (hourly at :32). Inert until the flag is set (handler
--    no-ops), so scheduling now is safe. cron.schedule upserts by jobname.
-- ---------------------------------------------------------------------------
SELECT cron.schedule(
  'lcc-deal-comms-propagate', '32 * * * *',
  $$SELECT public.lcc_cron_post('/api/deal-comms-propagate-tick', '{}'::jsonb, 'vercel')$$
);

-- ===========================================================================
-- REVERSAL RUNBOOK
--   SELECT cron.unschedule('lcc-deal-comms-propagate');
--   DROP FUNCTION IF EXISTS public.lcc_deal_comms_unpropagated(integer,integer,integer);
--   DROP FUNCTION IF EXISTS public.lcc_deal_record_milestone(uuid,text,date,text,text,text,text);
--   DROP TABLE IF EXISTS public.lcc_deal_comms_propagation_run_log;
--   DROP TABLE IF EXISTS public.lcc_deal_comm_propagated;
--   DELETE FROM public.feature_flags_registry WHERE flag='DEAL_COMMS_PROPAGATE_CRON';
--   -- milestones written by the tick: source IN ('comms_tick','comms_tick_confirmed')
-- ===========================================================================
