-- W8 U4 (Prompt 70, 2026-08-07): Systemic-findings monthly report — the hygiene
-- campaign's REPORTING layer (final unit). Aggregates the systemic-defect signal
-- streams that are already logged but never synthesized (ingest/flow failures,
-- provenance drift, chain completeness, U1/U2/U3 throughput + precision floors,
-- extraction health) into ONE monthly doc that feeds the W6.6 audit.
--
-- Reuses the campaign shapes: pure JS aggregator (api/_shared/systemic-findings.js)
-- + a GET dry-run / POST flag-gated tick (api/admin.js?_route=systemic-findings-tick)
-- + an in-migration flag (default OFF, 36y) + a monthly no-op-while-off cron. It
-- creates NO new review lane — the doc IS the consumer (inserted as a research_task
-- artifact). Numbers are computed DETERMINISTICALLY; the local model only drafts the
-- narrative FROM the numbers (figure-validated, never fabricated).
--
-- This migration creates:
--   * lcc_w8_u4_findings_snapshot        — one row per period (YYYY-MM); the delta baseline
--   * v_lcc_w8_u4_ingest_failure_clusters — grouped ingest_write_failures by signature (top-N)
--   * v_lcc_w8_u4_flow_failure_clusters   — grouped flow_run_failures by flow/error
--   * v_lcc_w8_u4_failure_windows         — scalar totals/30d/unresolved for both streams
--   * v_lcc_w8_u4_chain_rollup / _chain_gaps — ownership-chain completeness rollup
--   * v_lcc_w8_u4_extraction_mix          — 30d provider-stamp mix + fallback rate
--   * v_lcc_w8_u4_junk_verdicts / _dup_dispositions / _match_label_seeders — U1/U2 throughput
--   * v_lcc_w8_u4_findings_health         — Health-surface tile (amber while flag off)
--   * feature flag W8_U4_FINDINGS_REPORT (default OFF, registered here per 36y)
--   * a MONTHLY off-hours pg_cron POST to /api/systemic-findings-tick (05:00 UTC, 1st;
--     after the nightly hygiene chain; no-ops while OFF)
--
-- REVERSAL RUNBOOK
--   -- This unit writes NO canonical data. It persists a per-period snapshot row and
--   --   opens a research_task pointing at the generated doc. To retire a period:
--   DELETE FROM public.lcc_w8_u4_findings_snapshot WHERE period = '2026-08';
--   -- The research_task is idempotent on (research_type, domain, source_table,
--   --   source_record_id=period); close it in the Decision Center / research queue.
--   -- To retire the feature: flip W8_U4_FINDINGS_REPORT off (default) — the cron POST
--   --   no-ops and the tick GET stays a dry-run.

BEGIN;

-- Per-period snapshot: the month-over-month delta baseline. sections/findings/totals
-- carry the full computed report so next month's deltas read from here (not a re-run).
CREATE TABLE IF NOT EXISTS public.lcc_w8_u4_findings_snapshot (
  snapshot_id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  period        text NOT NULL UNIQUE,          -- 'YYYY-MM'
  computed_at   timestamptz NOT NULL DEFAULT now(),
  source_run_id text,
  sections      jsonb NOT NULL DEFAULT '[]'::jsonb,   -- the per-section computed table (delta source)
  findings      jsonb NOT NULL DEFAULT '[]'::jsonb,   -- flattened findings
  totals        jsonb NOT NULL DEFAULT '{}'::jsonb,
  narrative_ok  boolean,                         -- did the model narrative pass figure validation
  doc_path      text,                            -- docs/audits/systemic-findings/YYYY-MM.md
  doc_markdown  text,                            -- the rendered doc (so the cron output is inspectable)
  research_task_id uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lcc_w8_u4_snapshot_period
  ON public.lcc_w8_u4_findings_snapshot (period DESC, computed_at DESC);

COMMENT ON TABLE public.lcc_w8_u4_findings_snapshot IS
  'W8 U4: one row per monthly systemic-findings report period (YYYY-MM). sections holds the full computed table so month-over-month deltas read from the prior row. The doc IS the consumer (also opened as a research_task).';

CREATE OR REPLACE FUNCTION public.lcc_w8_u4_snapshot_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_lcc_w8_u4_snapshot_touch ON public.lcc_w8_u4_findings_snapshot;
CREATE TRIGGER trg_lcc_w8_u4_snapshot_touch
  BEFORE UPDATE ON public.lcc_w8_u4_findings_snapshot
  FOR EACH ROW EXECUTE FUNCTION public.lcc_w8_u4_snapshot_touch();

GRANT SELECT, INSERT, UPDATE ON public.lcc_w8_u4_findings_snapshot TO anon, authenticated, service_role;

-- ── Ingest write-failure clusters (grouped by error signature) ────────────────
-- Signature = (domain, http_status, label | error code). The JS aggregator slices
-- the top-N and shapes severity + fix-units. cnt_30d bounds the recency read.
CREATE OR REPLACE VIEW public.v_lcc_w8_u4_ingest_failure_clusters AS
SELECT coalesce(domain, '?')                                   AS domain,
       http_status,
       coalesce(nullif(label, ''), error_detail->>'code', '')  AS label,
       count(*)::int                                           AS cnt,
       count(*) FILTER (WHERE occurred_at >= now() - interval '30 days')::int AS cnt_30d,
       max(occurred_at)                                        AS last_seen
  FROM public.ingest_write_failures
 GROUP BY 1, 2, 3
 ORDER BY count(*) DESC
 LIMIT 25;

GRANT SELECT ON public.v_lcc_w8_u4_ingest_failure_clusters TO anon, authenticated, service_role;

-- ── Flow-run failure clusters (grouped by flow + error kind/code) ─────────────
CREATE OR REPLACE VIEW public.v_lcc_w8_u4_flow_failure_clusters AS
SELECT coalesce(flow_name, '?')     AS flow_name,
       coalesce(error_kind, '')     AS error_kind,
       coalesce(error_code, '')     AS error_code,
       count(*)::int                AS cnt,
       count(*) FILTER (WHERE detected_at >= now() - interval '30 days')::int AS cnt_30d,
       max(detected_at)             AS last_seen
  FROM public.flow_run_failures
 GROUP BY 1, 2, 3
 ORDER BY count(*) DESC
 LIMIT 25;

GRANT SELECT ON public.v_lcc_w8_u4_flow_failure_clusters TO anon, authenticated, service_role;

-- ── Scalar failure windows for both streams (one row) ─────────────────────────
CREATE OR REPLACE VIEW public.v_lcc_w8_u4_failure_windows AS
SELECT (SELECT count(*)::int FROM public.ingest_write_failures) AS iwf_total,
       (SELECT count(*)::int FROM public.ingest_write_failures WHERE occurred_at >= now() - interval '30 days') AS iwf_30d,
       (SELECT count(*)::int FROM public.flow_run_failures) AS frf_total,
       (SELECT count(*)::int FROM public.flow_run_failures WHERE detected_at >= now() - interval '30 days') AS frf_30d,
       (SELECT count(*)::int FROM public.flow_run_failures WHERE resolved_at IS NULL) AS frf_unresolved;

GRANT SELECT ON public.v_lcc_w8_u4_failure_windows TO anon, authenticated, service_role;

-- ── Ownership-chain completeness rollup (over the heavy per-property view) ─────
CREATE OR REPLACE VIEW public.v_lcc_w8_u4_chain_rollup AS
SELECT count(*)::int                                 AS total,
       count(*) FILTER (WHERE chain_complete)::int   AS complete,
       count(*) FILTER (WHERE NOT chain_complete)::int AS incomplete
  FROM public.v_lcc_ownership_chain_completeness;

GRANT SELECT ON public.v_lcc_w8_u4_chain_rollup TO anon, authenticated, service_role;

CREATE OR REPLACE VIEW public.v_lcc_w8_u4_chain_gaps AS
SELECT coalesce(missing_segments, 'complete') AS seg, count(*)::int AS cnt
  FROM public.v_lcc_ownership_chain_completeness
 GROUP BY 1
 ORDER BY count(*) DESC;

GRANT SELECT ON public.v_lcc_w8_u4_chain_gaps TO anon, authenticated, service_role;

-- ── Extraction provider mix (30d) — the post-61 _provider stamp ───────────────
CREATE OR REPLACE VIEW public.v_lcc_w8_u4_extraction_mix AS
SELECT count(*)::int AS total_30d,
       count(*) FILTER (WHERE extraction_snapshot ? '_provider')::int AS stamped,
       count(*) FILTER (WHERE extraction_snapshot->'_provider'->>'final_provider' = 'ollama')::int AS ollama,
       count(*) FILTER (WHERE (extraction_snapshot->'_provider'->>'fell_back')::boolean IS TRUE)::int AS fell_back
  FROM public.staged_intake_extractions
 WHERE created_at >= now() - interval '30 days';

GRANT SELECT ON public.v_lcc_w8_u4_extraction_mix TO anon, authenticated, service_role;

-- ── U1/U2 lane throughput ─────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_lcc_w8_u4_junk_verdicts AS
SELECT status, count(*)::int AS cnt FROM public.junk_entity_review GROUP BY 1;
GRANT SELECT ON public.v_lcc_w8_u4_junk_verdicts TO anon, authenticated, service_role;

CREATE OR REPLACE VIEW public.v_lcc_w8_u4_dup_dispositions AS
SELECT status, count(*)::int AS cnt FROM public.w8_u2_dup_pair GROUP BY 1;
GRANT SELECT ON public.v_lcc_w8_u4_dup_dispositions TO anon, authenticated, service_role;

CREATE OR REPLACE VIEW public.v_lcc_w8_u4_match_label_seeders AS
SELECT coalesce(seeder, '?') AS seeder, coalesce(verdict, '?') AS verdict, count(*)::int AS cnt
  FROM public.entity_match_labels
 GROUP BY 1, 2
 ORDER BY count(*) DESC;
GRANT SELECT ON public.v_lcc_w8_u4_match_label_seeders TO anon, authenticated, service_role;

-- ── Health tile — flag state + latest snapshot age. amber while the flag is off. ─
CREATE OR REPLACE VIEW public.v_lcc_w8_u4_findings_health AS
WITH s AS (
  SELECT period, computed_at, narrative_ok,
         (totals->'by_severity') AS by_severity,
         (totals->>'findings')::int AS findings
    FROM public.lcc_w8_u4_findings_snapshot
   ORDER BY period DESC LIMIT 1
),
f AS (
  SELECT state FROM public.feature_flags_registry WHERE flag = 'W8_U4_FINDINGS_REPORT' LIMIT 1
)
SELECT 'systemic_findings'::text AS subsystem,
       'w8_u4_findings_report'::text AS check_name,
       CASE WHEN coalesce((SELECT state FROM f), 'off') = 'off' THEN 'amber' ELSE 'green' END AS status,
       coalesce((SELECT findings FROM s), 0)::int AS count,
       coalesce((SELECT computed_at FROM s), now()) AS first_seen,
       now() AS ts,
       CASE WHEN coalesce((SELECT state FROM f), 'off') = 'off'
            THEN 'W8_U4_FINDINGS_REPORT feature flag is off' ELSE NULL END AS last_error,
       NULL::text AS external_url,
       jsonb_build_object(
         'feature_flag_state', coalesce((SELECT state FROM f), 'off'),
         'latest_period', (SELECT period FROM s),
         'latest_computed_at', (SELECT computed_at FROM s),
         'latest_findings', coalesce((SELECT findings FROM s), 0),
         'latest_narrative_ok', (SELECT narrative_ok FROM s),
         'latest_by_severity', (SELECT by_severity FROM s)
       ) AS details;

GRANT SELECT ON public.v_lcc_w8_u4_findings_health TO anon, authenticated, service_role;

-- Feature flag (36y rule: registered IN the migration, default OFF).
INSERT INTO public.feature_flags_registry (flag, purpose, surface, env_var, state, off_since, owner, notes)
VALUES (
  'W8_U4_FINDINGS_REPORT',
  'W8 U4 hygiene reporting: monthly systemic-findings report. Aggregates the systemic-defect signal streams (ingest_write_failures / flow_run_failures clusters, field_provenance drift+conflicts, ownership-chain completeness + U3 drain, precision-floor drop ratios, U1/U2 lane throughput + human accept rates, naming-hygiene backlog, extraction provider mix) into ONE monthly doc that feeds the W6.6 audit. Numbers computed deterministically (no LLM); the local model drafts only the narrative FROM the numbers, figure-validated (every prose number must match a computed value or the narrative is dropped for the raw tables). Creates NO new lane — the doc IS the consumer (opened as a research_task).',
  'api/admin.js?_route=systemic-findings-tick + lcc_w8_u4_findings_snapshot + docs/audits/systemic-findings/YYYY-MM.md',
  'W8_U4_FINDINGS_REPORT',
  'off',
  DATE '2026-08-07',
  'Scott Briggs',
  'Report-only — ZERO canonical writes. GET /api/systemic-findings-tick returns the computed findings JSON (dry-run, honest zeros where a source is empty); ?narrate=1 adds the figure-validated model narrative. POST (flag ON) persists a lcc_w8_u4_findings_snapshot row + opens the research_task. Monthly cron (1st 05:00 UTC) no-ops while OFF. Flip on after the first doc is reviewed. Uses OLLAMA_URL/OLLAMA_MODEL via invokeExtractionAI (surface clean_assist) for the narrative only.'
)
ON CONFLICT (flag) DO UPDATE
  SET purpose = EXCLUDED.purpose,
      surface = EXCLUDED.surface,
      env_var = EXCLUDED.env_var,
      notes = EXCLUDED.notes,
      updated_at = now();

-- Monthly off-hours cron (05:00 UTC on the 1st, after the nightly hygiene chain).
-- POSTs the Railway tick; the tick no-ops while the flag is off, so this is inert
-- until the flag flips.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'lcc_cron_post') THEN
    BEGIN
      PERFORM cron.unschedule('systemic-findings-tick');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    PERFORM cron.schedule(
      'systemic-findings-tick',
      '0 5 1 * *',
      $cron$SELECT public.lcc_cron_post('/api/systemic-findings-tick', '{"apply":true}'::jsonb, 'railway');$cron$
    );
  END IF;
END;
$$;

COMMIT;
