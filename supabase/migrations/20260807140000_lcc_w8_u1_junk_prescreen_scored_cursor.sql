-- W8 U1 (Prompt 66, 2026-08-07): bounded, resumable junk-scoring — resume cursor.
--
-- Root cause of the ?score=1 502: scoring is ollama-latency-bound (~16s/call), so
-- an unbounded inline/cron scoring pass (20–247 candidates) blew past the Railway
-- proxy timeout. The app fix (api/admin.js) budgets the wall-clock, caps each POST
-- to one ollama-sized batch, and RESUMES across nights via the scored ledger this
-- migration adds. Additive + idempotent on LCC Opps (xengecqvemvfknjvbvrq).
--
--   * junk_prescreen_scored  — one row per scored candidate (proposal persisted OR
--                              keep-counted), keyed (domain, table, pk, name_hash).
--                              The next tick's scan excludes these ⇒ the resume
--                              cursor. A rename (new name_hash) yields a fresh row
--                              ⇒ re-scored (dedupe keys on the exact stored name).
--   * v_lcc_junk_prescreen_health gains scored_total (remaining-pool visibility).
--
-- REVERSAL: DROP TABLE public.junk_prescreen_scored; (re-scoring resumes from the
-- junk_entity_review proposals + lcc_decisions exclusions only). To force a full
-- re-score of everything: TRUNCATE public.junk_prescreen_scored.

BEGIN;

CREATE TABLE IF NOT EXISTS public.junk_prescreen_scored (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subject_ref   text NOT NULL,
  domain        text NOT NULL,
  table_name    text NOT NULL,
  pk_value      text NOT NULL,
  name_hash     text NOT NULL,
  entity_name   text,
  verdict       text,
  enqueued      boolean NOT NULL DEFAULT false,
  source_run_id text,
  scored_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_junk_prescreen_scored UNIQUE (domain, table_name, pk_value, name_hash)
);

CREATE INDEX IF NOT EXISTS idx_junk_prescreen_scored_subject
  ON public.junk_prescreen_scored (subject_ref, name_hash);

COMMENT ON TABLE public.junk_prescreen_scored IS
  'W8 U1 (Prompt 66): resume cursor for the bounded junk pre-screen. One row per scored candidate keyed (domain, table_name, pk_value, name_hash); the next tick excludes these so batches drain across nights. A rename (new name_hash) is re-scored.';

GRANT SELECT ON public.junk_prescreen_scored TO anon, authenticated, service_role;
GRANT INSERT, UPDATE ON public.junk_prescreen_scored TO service_role;

-- Health tile gains scored_total (cheap count) for remaining-pool visibility. The
-- remaining candidate pool itself is only knowable from a JS scan, so the tick's
-- health event carries remaining_unscored in details; this adds the drained total.
CREATE OR REPLACE VIEW public.v_lcc_junk_prescreen_health AS
WITH p AS (
  SELECT count(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int AS proposals_24h,
         count(*) FILTER (WHERE status = 'proposed')::int AS open_proposals,
         count(*) FILTER (WHERE status = 'applied')::int  AS applied_total,
         count(*) FILTER (WHERE status = 'conflict')::int AS conflict_total,
         max(created_at) AS latest_proposal_at
    FROM public.junk_entity_review
),
s AS (
  SELECT count(*)::int AS scored_total,
         count(*) FILTER (WHERE scored_at >= now() - interval '24 hours')::int AS scored_24h
    FROM public.junk_prescreen_scored
),
f AS (
  SELECT state FROM public.feature_flags_registry
   WHERE flag = 'W8_U1_JUNK_PRESCREEN' LIMIT 1
)
SELECT 'junk_prescreen'::text AS subsystem,
       'ollama_junk_prescreen'::text AS check_name,
       CASE WHEN coalesce((SELECT state FROM f), 'off') = 'off' THEN 'amber' ELSE 'green' END AS status,
       coalesce((SELECT open_proposals FROM p), 0)::int AS count,
       coalesce((SELECT latest_proposal_at FROM p), now()) AS first_seen,
       now() AS ts,
       CASE WHEN coalesce((SELECT state FROM f), 'off') = 'off'
            THEN 'W8_U1_JUNK_PRESCREEN feature flag is off' ELSE NULL END AS last_error,
       NULL::text AS external_url,
       jsonb_build_object(
         'feature_flag_state', coalesce((SELECT state FROM f), 'off'),
         'proposals_24h', coalesce((SELECT proposals_24h FROM p), 0),
         'open_proposals', coalesce((SELECT open_proposals FROM p), 0),
         'applied_total', coalesce((SELECT applied_total FROM p), 0),
         'conflict_total', coalesce((SELECT conflict_total FROM p), 0),
         'scored_total', coalesce((SELECT scored_total FROM s), 0),
         'scored_24h', coalesce((SELECT scored_24h FROM s), 0),
         'latest_proposal_at', (SELECT latest_proposal_at FROM p)
       ) AS details;

GRANT SELECT ON public.v_lcc_junk_prescreen_health TO anon, authenticated, service_role;

COMMIT;
