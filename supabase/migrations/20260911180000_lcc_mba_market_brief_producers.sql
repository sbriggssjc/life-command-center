-- ============================================================================
-- MB-a — Market brief producers, dialysis lane first (P-SQL / P-RSS).
--
-- EB1 (20260911165100) laid market_brief_facts/issues + producer_runs but no
-- producer ever wrote to them. This migration is additive only:
--
--   1. market_brief_facts.fact_key — the identity for an on-box SQL
--      DERIVATION that has no source_url/source_date (a comps-engine cap-rate
--      band, an on-market count, a CMS clinic count). EB1's
--      uq_mbf_source_identity index only fires when source_url AND
--      source_date are both present, which every RSS/web fact has and no
--      SQL-derived fact does — so a P-SQL re-run against unchanged data would
--      duplicate forever without a second identity key. fact_key is that key;
--      RSS/web facts leave it NULL and keep using the source-identity index.
--   2. A partial UNIQUE index on (lane, section, fact_key) WHERE status='live'
--      — at most one LIVE fact per derivation per lane/section at a time.
--      Scoped to status='live' (not a bare unique constraint) because the
--      supersede chain keeps every prior version of a fact on the table with
--      status='superseded'; a superseded row must never block the next live
--      insert for the same fact_key.
--   3. feature_flags_registry rows for MARKET_BRIEF_PSQL / MARKET_BRIEF_PRSS
--      — both 'off'. A flag-gated no-op must be VISIBLE (audit 4.4.3);
--      registering the row is what makes "this capability exists and is off"
--      distinguishable from "this capability does not exist".
--   4. pg_cron schedules for both ticks, guarded by NOT EXISTS so a re-apply
--      is idempotent, and NOT gated on the feature flag (the P138 pattern —
--      an unscheduled job is invisible; the tick itself records the flag-off
--      skip loudly in producer_runs.skip_reason).
--
-- ⚠️ OPERATOR VERIFY BEFORE RELYING ON THE MINUTE PICKS BELOW. This migration
-- was written from a sandbox with no reach to the live cron.job table, so the
-- exact minutes ('15 7 * * *' for P-SQL, '10 10 * * *' for P-RSS, chosen to
-- land after the 10:00 UTC briefing-intel-snapshot cron per spec §2) have NOT
-- been checked against what else is already scheduled in that window — the
-- documented footgun (P138's own migration: "minute :18 was chosen because it
-- is the only free minute in that stretch"). Before flipping either flag on,
-- run `SELECT jobname, schedule FROM cron.job ORDER BY schedule;` and move
-- either job if it collides.
--
-- REVERSAL RUNBOOK (reverse order):
--   SELECT cron.unschedule('lcc-market-brief-rss');
--   SELECT cron.unschedule('lcc-market-brief-psql');
--   DELETE FROM public.feature_flags_registry WHERE flag IN ('MARKET_BRIEF_PSQL', 'MARKET_BRIEF_PRSS');
--   DROP INDEX IF EXISTS public.uq_mbf_fact_key_live;
--   ALTER TABLE public.market_brief_facts DROP COLUMN IF EXISTS fact_key;
-- ============================================================================

ALTER TABLE public.market_brief_facts
  ADD COLUMN IF NOT EXISTS fact_key text;

COMMENT ON COLUMN public.market_brief_facts.fact_key IS
  'MB-a — the identity of an on-box SQL derivation (e.g. cap_rate_ttm_band, '
  'on_market_count, cms_clinic_count:davita) that has no source_url/source_date '
  'to dedupe on. NULL for rss/web_research facts, which dedupe on '
  'uq_mbf_source_identity instead. See uq_mbf_fact_key_live for the supersede '
  'invariant this enforces (at most one live fact per lane/section/fact_key).';

CREATE UNIQUE INDEX IF NOT EXISTS uq_mbf_fact_key_live
  ON public.market_brief_facts (lane, section, fact_key)
  WHERE fact_key IS NOT NULL AND status = 'live';

-- ----------------------------------------------------------------------------
-- feature_flags_registry — both OFF until the live-verify step (spec §7).
-- ----------------------------------------------------------------------------

INSERT INTO public.feature_flags_registry (flag, purpose, surface, env_var, state, off_since, owner, notes)
VALUES (
  'MARKET_BRIEF_PSQL',
  'MB1 — write deterministic on-box SQL facts into market_brief_facts for the dialysis lane: TTM cap-rate band (whole-market + by operator where n>=5), trades since the producer''s last run, on-market count + median ask cap, CMS clinic counts by top operator + net change vs. the prior run.',
  'GET/POST /api/market-brief-psql-tick -> market_brief_facts (origin=onbox_sql), logged to producer_runs (producer=p_sql)',
  'MARKET_BRIEF_PSQL',
  'off',
  CURRENT_DATE,
  'scott',
  'MB-a. Deterministic — no model call. GET is always a dry run (no writes); POST writes when the flag is on. '
  'Never emits a cap-rate band below n=5 (small-n suppression). Never overwrites a live web_research fact that '
  'disagrees beyond 10% — both facts are marked status=conflict instead, per spec §2/§4. Flip to ''on'' only '
  'after a manual run is reviewed against v_market_brief_staleness for the dialysis lane.'
)
ON CONFLICT (flag) DO UPDATE SET
  purpose = EXCLUDED.purpose, surface = EXCLUDED.surface, env_var = EXCLUDED.env_var, notes = EXCLUDED.notes;

INSERT INTO public.feature_flags_registry (flag, purpose, surface, env_var, state, off_since, owner, notes)
VALUES (
  'MARKET_BRIEF_PRSS',
  'MB2 — classify the healthcare RSS stream (already fetched daily by briefing-intel-snapshot) for dialysis relevance with on-box Ollama, extract candidate facts as short cited claims, and write only the ones whose numbers appear verbatim in the source article into market_brief_facts.',
  'GET/POST /api/market-brief-rss-tick -> market_brief_facts (origin=rss), logged to producer_runs (producer=p_rss)',
  'MARKET_BRIEF_PRSS',
  'off',
  CURRENT_DATE,
  'scott',
  'MB-a. On-box Ollama only (no cloud fallback, fails closed — producer_runs.status=skipped when OLLAMA_URL is '
  'unset or the model is unreachable, never a silent zero-fact night). A fact whose claimed number does not '
  'appear verbatim in the article''s own title/summary is dropped before it is ever written. Runs daily after '
  'the 10:00 UTC snapshot cron so the day''s healthcare stream is already populated.'
)
ON CONFLICT (flag) DO UPDATE SET
  purpose = EXCLUDED.purpose, surface = EXCLUDED.surface, env_var = EXCLUDED.env_var, notes = EXCLUDED.notes;

-- ----------------------------------------------------------------------------
-- pg_cron schedules — guarded, idempotent, NOT flag-gated at the cron level.
-- ----------------------------------------------------------------------------

DO $cronblock$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-market-brief-psql') THEN
    PERFORM cron.schedule(
      'lcc-market-brief-psql',
      '15 7 * * *',
      $$SELECT public.lcc_cron_post('/api/market-brief-psql-tick', '{"trigger_source":"cron","lane":"dialysis"}'::jsonb, 'railway');$$
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lcc-market-brief-rss') THEN
    PERFORM cron.schedule(
      'lcc-market-brief-rss',
      '10 10 * * *',
      $$SELECT public.lcc_cron_post('/api/market-brief-rss-tick', '{"trigger_source":"cron","lane":"dialysis"}'::jsonb, 'railway');$$
    );
  END IF;
END
$cronblock$;
