-- ============================================================================
-- Prompt 80 — Match-disambiguation pre-rank assist (unblock the dead lane)
-- ============================================================================
-- The match_disambiguation lane carries ~1,120 open cards and ZERO ever decided:
-- each card demands un-aided judgment across ≤5 candidate properties, so it never
-- moves. This adds a W8 CONSUMPTION AID (not a new producer): a nightly Ollama
-- pass ranks each card's candidates best-first and stores the ranking as an
-- ANNOTATION on the decision row. The human verdict path is UNCHANGED — the
-- annotation only (a) sorts the lane by the assist's top confidence (momentum:
-- easy calls first), (b) shows each candidate's assist rank/reason inline, and
-- (c) powers a one-click "assist agrees" confirm that rides the SAME verdict path.
--
-- Doctrine (garybuilt-local-model.md §7): the local model ANNOTATES, the human
-- DECIDES, nothing auto-applies. The annotation writer here is METADATA-ONLY and
-- structurally CANNOT touch verdict/status — that is the auditable guarantee.
--
-- DB-safety (LCC Opps is auth-critical): additive (one nullable jsonb column with
-- a default + two SECURITY DEFINER functions gated to this decision_type + one
-- reporting view + a flag row + an off-hours cron). No auth-schema contact, no
-- long locks, idempotent (IF NOT EXISTS / OR REPLACE / ON CONFLICT).
-- ============================================================================

BEGIN;

-- 1. Annotation home. lcc_decisions had no metadata column; the card facts live
--    in `context`. `metadata` is a SEPARATE bag for consumption aids (the assist)
--    so an annotation can never be confused with the card's producer context and
--    the producer's lcc_open_decision() ON CONFLICT refresh of `context` never
--    clobbers it.
ALTER TABLE public.lcc_decisions
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Ordering support: unannotated cards have NO assist_top_conf key (SQL NULL ⇒
-- sorts last); annotated cards carry the numeric top confidence for the lane sort.
CREATE INDEX IF NOT EXISTS idx_lcc_decisions_match_assist_conf
  ON public.lcc_decisions ((metadata->'assist_top_conf'))
  WHERE decision_type = 'match_disambiguation' AND status = 'open';

-- 2. The annotation writer — METADATA-ONLY. It sets metadata.assist (the full
--    ranking object) + metadata.assist_top_conf (the numeric top confidence used
--    for lane ordering). It CANNOT write verdict / status / effects / decided_* —
--    that is the structural guarantee that the assist is never a verdict. Gated to
--    OPEN match_disambiguation rows (a decided card is never re-annotated).
CREATE OR REPLACE FUNCTION public.lcc_annotate_match_disambig_assist(
  p_decision_id bigint,
  p_assist      jsonb
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_hit boolean := false;
BEGIN
  UPDATE public.lcc_decisions
     SET metadata = jsonb_set(
                      jsonb_set(COALESCE(metadata, '{}'::jsonb), '{assist}',
                                COALESCE(p_assist, '{}'::jsonb), true),
                      '{assist_top_conf}',
                      COALESCE(p_assist->'top_confidence', 'null'::jsonb), true),
         updated_at = now()
   WHERE id = p_decision_id
     AND decision_type = 'match_disambiguation'
     AND status = 'open';
  GET DIAGNOSTICS v_hit = ROW_COUNT;
  RETURN v_hit;
END;
$fn$;

-- 3. The agree/disagree recorder — writes metadata.assist_agreed (+ the detail).
--    Called from the verdict handler AFTER the human verdict is recorded, so it
--    intentionally does NOT require status='open' (the verdict already flipped it
--    to 'decided'). Still metadata-only; never touches verdict/status.
CREATE OR REPLACE FUNCTION public.lcc_record_match_assist_agreement(
  p_decision_id bigint,
  p_agreed      boolean,
  p_detail      jsonb DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_hit boolean := false;
BEGIN
  UPDATE public.lcc_decisions
     SET metadata = jsonb_set(
                      jsonb_set(COALESCE(metadata, '{}'::jsonb), '{assist_agreed}',
                                to_jsonb(p_agreed), true),
                      '{assist_agreement}', COALESCE(p_detail, '{}'::jsonb), true),
         updated_at = now()
   WHERE id = p_decision_id
     AND decision_type = 'match_disambiguation';
  GET DIAGNOSTICS v_hit = ROW_COUNT;
  RETURN v_hit;
END;
$fn$;

REVOKE ALL ON FUNCTION public.lcc_annotate_match_disambig_assist(bigint, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lcc_record_match_assist_agreement(bigint, boolean, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lcc_annotate_match_disambig_assist(bigint, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.lcc_record_match_assist_agreement(bigint, boolean, jsonb) TO service_role;

-- 4. U4 assist-accuracy metric (per-month). Decided match_disambiguation cards
--    that carried an assist AND recorded an agree/disagree, aggregated by the
--    month decided. Accuracy = agreed / measured. Honest zeros before the loop
--    accrues a real sample (the prompt's "if accuracy is high after a real
--    sample" gate is a FUTURE decision — this view only MEASURES).
CREATE OR REPLACE VIEW public.v_lcc_w8_u4_match_assist_accuracy AS
SELECT to_char(date_trunc('month', decided_at), 'YYYY-MM')                         AS period,
       count(*) FILTER (WHERE metadata ? 'assist_agreed')::int                     AS measured,
       count(*) FILTER (WHERE (metadata->>'assist_agreed')::boolean IS TRUE)::int  AS agreed,
       count(*) FILTER (WHERE (metadata->>'assist_agreed')::boolean IS FALSE)::int AS disagreed
  FROM public.lcc_decisions
 WHERE decision_type = 'match_disambiguation'
   AND status = 'decided'
   AND decided_at IS NOT NULL
   AND metadata ? 'assist'
 GROUP BY 1
 ORDER BY 1 DESC;

GRANT SELECT ON public.v_lcc_w8_u4_match_assist_accuracy TO anon, authenticated, service_role;

-- 5. Feature flag (registered IN the migration, default OFF — the nightly tick
--    no-ops while OFF). Flip on after the first dry-run sheet is reviewed.
INSERT INTO public.feature_flags_registry (flag, purpose, surface, env_var, state, off_since, owner, notes)
VALUES (
  'MATCH_DISAMBIG_ASSIST',
  'W8 consumption aid: nightly Ollama pre-rank of the match_disambiguation Decision-Center lane (1,120 open cards, zero decided). The local model ranks each card''s ≤5 candidate properties best-first with a per-candidate confidence + one-line reason, stored as metadata.assist on the decision row (NEVER a verdict). The lane sorts by the assist''s top confidence and offers a one-click "assist agrees" confirm that rides the existing human verdict path. Every human verdict records agree/disagree vs the assist''s top pick (metadata.assist_agreed) → the U4 report gains a per-month accuracy metric.',
  'api/admin.js?_route=match-disambig-assist-tick + lcc_decisions.metadata.assist + v_lcc_w8_u4_match_assist_accuracy',
  'MATCH_DISAMBIG_ASSIST',
  'off',
  DATE '2026-08-08',
  'Scott Briggs',
  'Annotation-only — ZERO canonical / verdict writes (the annotation writer lcc_annotate_match_disambig_assist is metadata-only and structurally cannot touch verdict/status). GET /api/match-disambig-assist-tick reports counts; ?score=1 returns an inline sample ranking sheet (NO writes). POST (flag ON) annotates one bounded, resumable batch (~20/night) — skips already-annotated cards (metadata->>assist IS NULL cursor). Uses OLLAMA_URL/OLLAMA_MODEL via invokeExtractionAI (surface match_disambig_assist). Nightly cron 04:30 UTC no-ops while OFF.'
)
ON CONFLICT (flag) DO UPDATE
  SET purpose = EXCLUDED.purpose,
      surface = EXCLUDED.surface,
      env_var = EXCLUDED.env_var,
      notes = EXCLUDED.notes,
      updated_at = now();

COMMIT;

-- 6. Nightly off-hours cron (04:30 UTC). POSTs the Railway tick; the tick no-ops
--    while the flag is off, so this is inert until the flag flips. Outside the
--    transaction (pg_cron schedule changes are not transactional).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'lcc_cron_post') THEN
    BEGIN
      PERFORM cron.unschedule('match-disambig-assist-tick');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    PERFORM cron.schedule(
      'match-disambig-assist-tick',
      '30 4 * * *',
      $cron$SELECT public.lcc_cron_post('/api/match-disambig-assist-tick', '{"apply":true}'::jsonb, 'railway');$cron$
    );
  END IF;
END;
$$;
