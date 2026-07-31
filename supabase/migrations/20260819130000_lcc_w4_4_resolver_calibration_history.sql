-- ============================================================================
-- W4.4 (2026-07-31): nightly resolver retrain loop — calibration history +
-- drift alerts (the LCC Opps half).
--
-- The nightly loop (w44-retrain-tick edge fn on Dialysis_DB → pg_cron) does:
--   1. refresh the labeled corpus (POST w41-corpus-export?action=export),
--   2. POST the Railway resolver /train for each model (owner_owner/owner_sf/
--      contact) with use_storage + target_precision 0.995 — which ALSO heals the
--      ephemeral-model problem after any resolver redeploy,
--   3. call THIS RPC once with the whole run so the outcome is persisted and drift
--      is alarmed. Sequenced: a failed corpus refresh must NOT train (the edge fn
--      enforces order; this RPC records + alarms whatever it is handed).
--
-- This migration builds the record + alarm half on LCC Opps (xengecqvemvfknjvbvrq,
-- where lcc_health_alerts lives; the edge fn reaches it via OPS_SUPABASE_SERVICE_KEY):
--   1. resolver_calibration_history — one row per (run, model) trained.
--   2. lcc_record_resolver_retrain(p_run jsonb) — insert history + evaluate drift:
--        (a) holdout auto_link precision drops > 1pt vs the model's prior run,
--        (b) trainer is unexpected (not count_estimator — the sole estimator after
--            the W4.4 splink retirement); a real train FAILURE also alarms,
--        (c) the auto_link band hit the floor (auto_link_floored) = the corpus
--            negatives are too easy again (the W4.3 calibration-transfer gap).
--      Drift alarms via the existing lcc_health_alerts dedup-on-unresolved pattern;
--      a corpus-refresh failure or any model failure opens a LOUD (error) alert so
--      the nightly loop is never silently broken.
--   3. A feature_flags_registry row for the retrain loop (env RESOLVER_URL) so its
--      off/unconfigured state is visible in the Dormant Capabilities digest.
--
-- Additive / idempotent / reversible. Apply on LCC Opps (xengecqvemvfknjvbvrq).
--
-- REVERSAL: DROP FUNCTION lcc_record_resolver_retrain(jsonb);
--           DROP TABLE resolver_calibration_history;
--           DELETE FROM feature_flags_registry WHERE flag='RESOLVER_RETRAIN_LOOP';
--           DELETE FROM lcc_health_alerts WHERE alert_kind IN
--             ('resolver_calibration_drift','resolver_retrain_failure');
-- ============================================================================

BEGIN;

-- ── 1. Calibration history ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.resolver_calibration_history (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recorded_at          timestamptz NOT NULL DEFAULT now(),
  run_id               text NOT NULL,               -- groups the models trained in one nightly pass
  model                text NOT NULL,               -- owner_owner | owner_sf | contact
  corpus               text,                        -- storage://… | fixtures
  trainer              text,                         -- count_estimator (the sole estimator post-W4.4)
  n_train              integer,
  n_test               integer,
  target_precision     numeric,
  auto_link            numeric,
  auto_reject          numeric,
  band_floor           numeric,
  auto_link_floored    boolean,
  auto_link_precision  numeric,
  auto_link_recall     numeric,
  needs_review_count   integer,
  raw                  jsonb                         -- the full /train calibration summary
);

CREATE INDEX IF NOT EXISTS idx_resolver_calib_model_recorded
  ON public.resolver_calibration_history (model, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_resolver_calib_run
  ON public.resolver_calibration_history (run_id);

COMMENT ON TABLE public.resolver_calibration_history IS
  'W4.4: one row per (nightly run, model) trained by the resolver retrain loop.
   Drives the drift alarm in lcc_record_resolver_retrain (precision drop / trainer
   fallback / band-floor hit) and the CALIBRATION trend over time.';

GRANT SELECT ON public.resolver_calibration_history TO authenticated, service_role;

-- ── 2. Record + alarm the nightly run ───────────────────────────────────────
-- p_run shape (built by the edge fn):
--   {
--     "run_id": "w44-2026-07-31T05:00Z",
--     "corpus": "storage://entity-resolution/w4_1/labeled_pairs.jsonl",
--     "corpus_refreshed": true,
--     "refresh_error": null,
--     "models": [
--       { "model":"owner_owner", "ok":true, "trainer":"count_estimator",
--         "n_train":4795, "n_test":547, "target_precision":0.995,
--         "auto_link":0.5, "auto_reject":0.4999, "band_floor":0.5,
--         "auto_link_floored":true, "precision":1.0, "recall":0.99,
--         "needs_review":94, "raw": {…}, "error":null },
--       …
--     ]
--   }
CREATE OR REPLACE FUNCTION public.lcc_record_resolver_retrain(p_run jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_run_id        text := COALESCE(p_run->>'run_id', 'w44-' || to_char(now(),'YYYYMMDD"T"HH24MI"Z"'));
  v_corpus        text := p_run->>'corpus';
  v_refreshed     boolean := COALESCE((p_run->>'corpus_refreshed')::boolean, false);
  v_refresh_err   text := p_run->>'refresh_error';
  v_expected_trainer text := 'count_estimator';   -- the sole estimator after W4.4
  v_m             jsonb;
  v_model         text;
  v_ok            boolean;
  v_trainer       text;
  v_prec          numeric;
  v_floored       boolean;
  v_prior_prec    numeric;
  v_drift         text[];
  v_reasons       text;
  v_inserted      int := 0;
  v_drift_alerts  int := 0;
  v_failures      int := 0;
  v_fail_detail   jsonb := '[]'::jsonb;
BEGIN
  -- ── per-model: record + evaluate drift ──
  FOR v_m IN SELECT * FROM jsonb_array_elements(COALESCE(p_run->'models','[]'::jsonb))
  LOOP
    v_model := v_m->>'model';
    v_ok    := COALESCE((v_m->>'ok')::boolean, false);

    IF NOT v_ok THEN
      v_failures := v_failures + 1;
      v_fail_detail := v_fail_detail || jsonb_build_object('model', v_model, 'error', v_m->>'error');
      CONTINUE;
    END IF;

    v_trainer := v_m->>'trainer';
    v_prec    := NULLIF(v_m->>'precision','')::numeric;
    v_floored := COALESCE((v_m->>'auto_link_floored')::boolean, false);

    -- prior precision BEFORE inserting this run's row
    SELECT auto_link_precision INTO v_prior_prec
    FROM public.resolver_calibration_history
    WHERE model = v_model
    ORDER BY recorded_at DESC
    LIMIT 1;

    INSERT INTO public.resolver_calibration_history (
      run_id, model, corpus, trainer, n_train, n_test, target_precision,
      auto_link, auto_reject, band_floor, auto_link_floored,
      auto_link_precision, auto_link_recall, needs_review_count, raw
    ) VALUES (
      v_run_id, v_model, v_corpus, v_trainer,
      NULLIF(v_m->>'n_train','')::int, NULLIF(v_m->>'n_test','')::int,
      NULLIF(v_m->>'target_precision','')::numeric,
      NULLIF(v_m->>'auto_link','')::numeric, NULLIF(v_m->>'auto_reject','')::numeric,
      NULLIF(v_m->>'band_floor','')::numeric, v_floored,
      v_prec, NULLIF(v_m->>'recall','')::numeric,
      NULLIF(v_m->>'needs_review','')::int, v_m->'raw'
    );
    v_inserted := v_inserted + 1;

    -- drift conditions (array_append: `text[] || text_literal` mis-resolves to
    -- array-literal parsing, so append explicitly)
    v_drift := ARRAY[]::text[];
    IF v_prior_prec IS NOT NULL AND v_prec IS NOT NULL AND (v_prior_prec - v_prec) > 0.01 THEN
      v_drift := array_append(v_drift, format('precision dropped %s->%s (>1pt)', v_prior_prec, v_prec));
    END IF;
    IF v_trainer IS DISTINCT FROM v_expected_trainer THEN
      v_drift := array_append(v_drift, format('unexpected trainer %s (expected %s)', COALESCE(v_trainer,'null'), v_expected_trainer));
    END IF;
    IF v_floored THEN
      v_drift := array_append(v_drift, 'auto_link band hit the floor (corpus negatives too easy - transfer gap)');
    END IF;

    IF array_length(v_drift,1) > 0 THEN
      v_reasons := array_to_string(v_drift, '; ');
      -- open one unresolved drift alert per model (dedup)
      INSERT INTO public.lcc_health_alerts (alert_kind, source, severity, summary, details)
      SELECT 'resolver_calibration_drift', 'resolver:' || v_model, 'warn',
             'Resolver model ' || v_model || ' calibration drift: ' || v_reasons || '.',
             jsonb_build_object('run_id', v_run_id, 'model', v_model, 'reasons', v_drift,
                                'precision', v_prec, 'prior_precision', v_prior_prec,
                                'auto_link_floored', v_floored, 'trainer', v_trainer)
      WHERE NOT EXISTS (
        SELECT 1 FROM public.lcc_health_alerts a
         WHERE a.alert_kind = 'resolver_calibration_drift'
           AND a.source = 'resolver:' || v_model
           AND a.resolved_at IS NULL
      );
      GET DIAGNOSTICS v_drift_alerts = ROW_COUNT;
    ELSE
      -- clean run for this model → auto-resolve any open drift alert
      UPDATE public.lcc_health_alerts a
         SET resolved_at = now(),
             resolved_note = 'Auto-resolved: clean calibration run ' || v_run_id
       WHERE a.alert_kind = 'resolver_calibration_drift'
         AND a.source = 'resolver:' || v_model
         AND a.resolved_at IS NULL;
    END IF;
  END LOOP;

  -- ── loud failure alert: corpus refresh failed OR any model failed ──
  IF NOT v_refreshed OR v_failures > 0 THEN
    INSERT INTO public.lcc_health_alerts (alert_kind, source, severity, summary, details)
    SELECT 'resolver_retrain_failure', 'resolver-retrain-tick', 'error',
           CASE WHEN NOT v_refreshed
                THEN 'Nightly resolver retrain: corpus refresh FAILED (' || COALESCE(v_refresh_err,'unknown') || ') — did not train. Loop is broken until fixed.'
                ELSE 'Nightly resolver retrain: ' || v_failures || ' model train(s) FAILED — models may be stale/ephemeral. Loop is broken until fixed.' END,
           jsonb_build_object('run_id', v_run_id, 'corpus_refreshed', v_refreshed,
                              'refresh_error', v_refresh_err, 'failures', v_fail_detail)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.lcc_health_alerts a
       WHERE a.alert_kind = 'resolver_retrain_failure'
         AND a.source = 'resolver-retrain-tick'
         AND a.resolved_at IS NULL
    );
  ELSE
    -- fully clean run → auto-resolve the failure alert
    UPDATE public.lcc_health_alerts a
       SET resolved_at = now(),
           resolved_note = 'Auto-resolved: clean nightly retrain run ' || v_run_id
     WHERE a.alert_kind = 'resolver_retrain_failure'
       AND a.source = 'resolver-retrain-tick'
       AND a.resolved_at IS NULL;
  END IF;

  RETURN jsonb_build_object(
    'run_id', v_run_id,
    'models_recorded', v_inserted,
    'model_failures', v_failures,
    'corpus_refreshed', v_refreshed,
    'drift_alerts_opened', v_drift_alerts
  );
END;
$$;

REVOKE ALL ON FUNCTION public.lcc_record_resolver_retrain(jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.lcc_record_resolver_retrain(jsonb) TO service_role;

COMMENT ON FUNCTION public.lcc_record_resolver_retrain(jsonb) IS
  'W4.4: record a nightly resolver retrain run into resolver_calibration_history and
   raise drift alerts (precision drop >1pt vs prior / unexpected trainer / auto_link
   band hit the floor) plus a loud resolver_retrain_failure alert when the corpus
   refresh or any model train failed. Dedup-on-unresolved via lcc_health_alerts;
   auto-resolves on a clean run. Called once per nightly pass by w44-retrain-tick.';

-- ── 3. Feature-flag registry: make the loop''s configured state visible ──────
INSERT INTO public.feature_flags_registry (flag, purpose, surface, env_var, state, off_since, owner, notes)
VALUES (
  'RESOLVER_RETRAIN_LOOP',
  'Nightly corpus refresh + resolver /train + calibration-drift alerting (W4.4).',
  'edge:w44-retrain-tick + pg_cron (Dialysis_DB)',
  'RESOLVER_URL',
  'partial', NULL, 'scott',
  'Cron + edge fn shipped; corpus refresh runs, but /train no-ops until RESOLVER_URL is set on the Dialysis_DB edge secrets. Flip to on when RESOLVER_URL is configured.'
)
ON CONFLICT (flag) DO UPDATE
  SET purpose = EXCLUDED.purpose, surface = EXCLUDED.surface, env_var = EXCLUDED.env_var,
      notes = EXCLUDED.notes, updated_at = now();

COMMIT;
