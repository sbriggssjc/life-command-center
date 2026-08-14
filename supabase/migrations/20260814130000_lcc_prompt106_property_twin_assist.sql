-- Prompt 106 — property_twin lane: deterministic pre-rank + Ollama assist
-- (annotation-only). LCC Opps (xengecqvemvfknjvbvrq).
--
-- The assist ANNOTATES and SORTS the dia property-twin review lane; it NEVER
-- merges. The dia merge (dia_merge_property_reversible) stays human-gated +
-- reversible. Annotations reuse the existing lcc_clean_assist_proposals store
-- (source 'property_twin_assist' — the source column keeps this stream from
-- colliding with 'ollama_clean_assist' / 'w9_3_sf_assist' on the UNIQUE key).
-- This migration only: (1) widens the source CHECK to admit the new stream,
-- (2) registers the PROPERTY_TWIN_ASSIST feature flag (OFF), (3) adds the U4
-- self-measure table + RPC + accuracy view, and (4) schedules the nightly cron.
--
-- Discipline: additive · reversible · idempotent. No curated-field write, so NO
-- field_source_priority rows (this is an annotation store, not a data writer).

BEGIN;

-- 1) Admit the new annotation stream on the existing store's source CHECK.
--    Additive: the prior values ('ollama_clean_assist','w9_3_sf_assist') are kept.
ALTER TABLE public.lcc_clean_assist_proposals
  DROP CONSTRAINT IF EXISTS lcc_clean_assist_proposals_source_check;
ALTER TABLE public.lcc_clean_assist_proposals
  ADD CONSTRAINT lcc_clean_assist_proposals_source_check
  CHECK (source = ANY (ARRAY['ollama_clean_assist'::text, 'w9_3_sf_assist'::text, 'property_twin_assist'::text]));

-- 2) Feature-flag registration (inert-feature registry). OFF by default; the tick
--    no-ops on POST while OFF (GET dry-run + ?score=1 sample always run).
INSERT INTO public.feature_flags_registry (flag, purpose, surface, env_var, state, off_since, owner, notes)
VALUES
  ('PROPERTY_TWIN_ASSIST',
   'Prompt 106: nightly deterministic pre-rank + Ollama assist for the dia property_twin review lane (~1,245 pending). A NO-LLM deterministic classifier decides the bulk (same-operator/near-identical-name -> merge; different-operator/distinct-address -> not_twin); the genuine-judgment residue (same-address operator change, multiple anchors, same-operator name divergence, blank shadow) is scored by Ollama with a VERBATIM evidence quote (dropped if not a substring of the supplied evidence). Stored as an ANNOTATION in lcc_clean_assist_proposals (source property_twin_assist) — NEVER a verdict. The lane sorts easy-first; deterministic merges are one-click bulk-confirmable (still a HUMAN verdict via dia_merge_property_reversible); each human verdict self-measures agree/disagree into v_lcc_property_twin_assist_accuracy.',
   'api/property-twin-assist-tick + lcc_clean_assist_proposals + v_lcc_property_twin_assist_accuracy',
   'PROPERTY_TWIN_ASSIST', 'off', DATE '2026-08-14', 'Scott Briggs',
   'Annotation-only. GET reports per-class + per-suggest counts; ?score=1&n= returns an inline sample (NO writes); POST (flag ON) annotates one bounded resumable batch. Deterministic classifier spends NO LLM; the residue uses OLLAMA via invokeExtractionAI (surface property_twin_assist). Nightly cron 05:45 UTC no-ops while OFF. The merge RPC is only ever called by a HUMAN verdict, never by the tick.')
ON CONFLICT (flag) DO UPDATE
  SET purpose = EXCLUDED.purpose, surface = EXCLUDED.surface, env_var = EXCLUDED.env_var,
      notes = EXCLUDED.notes, updated_at = now();

-- 3) U4 self-measure: append-only ledger of assist-verdict vs the human's actual
--    verdict, so we track agreement over time. Metadata-only; nothing here can
--    touch a dia review row or a decision verdict.
CREATE TABLE IF NOT EXISTS public.lcc_property_twin_assist_measure (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subject_ref    text NOT NULL,                      -- 'twin:dia:<review_id>'
  assist_verdict text,                               -- 'merge' | 'not' | 'uncertain'
  assist_layer   text,                               -- 'deterministic' | 'llm'
  assist_conf    numeric,
  human_verdict  text,                               -- 'merge' | 'not_twin' | 'research'
  agreed         boolean,                            -- NULL when not measurable
  decided_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_lcc_property_twin_assist_measure_subject
  ON public.lcc_property_twin_assist_measure (subject_ref);

CREATE OR REPLACE FUNCTION public.lcc_record_property_twin_assist_agreement(
  p_subject_ref    text,
  p_assist_verdict text,
  p_assist_layer   text,
  p_assist_conf    numeric,
  p_human_verdict  text,
  p_agreed         boolean,
  p_decided_by     uuid
) RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $fn$
  INSERT INTO public.lcc_property_twin_assist_measure
    (subject_ref, assist_verdict, assist_layer, assist_conf, human_verdict, agreed, decided_by)
  VALUES
    (p_subject_ref, p_assist_verdict, p_assist_layer, p_assist_conf, p_human_verdict, p_agreed, p_decided_by)
  RETURNING id;
$fn$;

-- Accuracy view — measurable rows only (decisive assist vs decisive human).
CREATE OR REPLACE VIEW public.v_lcc_property_twin_assist_accuracy AS
  SELECT
    assist_layer,
    count(*) FILTER (WHERE agreed IS NOT NULL)                     AS measured,
    count(*) FILTER (WHERE agreed IS TRUE)                         AS agreed,
    count(*) FILTER (WHERE agreed IS FALSE)                        AS disagreed,
    round(
      (count(*) FILTER (WHERE agreed IS TRUE))::numeric
      / NULLIF(count(*) FILTER (WHERE agreed IS NOT NULL), 0), 4)  AS agreement_rate,
    max(created_at)                                                AS last_measured_at
  FROM public.lcc_property_twin_assist_measure
  GROUP BY assist_layer;

GRANT SELECT ON public.v_lcc_property_twin_assist_accuracy TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lcc_record_property_twin_assist_agreement(text,text,text,numeric,text,boolean,uuid)
  TO anon, authenticated, service_role;

COMMIT;

-- 4) Nightly cron — staggered AFTER the W9.3 sf-assist chain (04:50 / 05:10 / 05:30)
--    and the match-disambig assist. pg_cron schedule changes are NOT transactional,
--    so this runs outside the COMMIT and is guarded on lcc_cron_post existing.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'lcc_cron_post') THEN
    BEGIN PERFORM cron.unschedule('property-twin-assist-tick'); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM cron.schedule('property-twin-assist-tick', '45 5 * * *',
      $cron$SELECT public.lcc_cron_post('/api/property-twin-assist-tick', '{"apply":true}'::jsonb, 'railway');$cron$);
  END IF;
END;
$$;

-- REVERSAL RUNBOOK:
--   SELECT cron.unschedule('property-twin-assist-tick');
--   DELETE FROM public.lcc_clean_assist_proposals WHERE source = 'property_twin_assist';
--   DROP VIEW  IF EXISTS public.v_lcc_property_twin_assist_accuracy;
--   DROP FUNCTION IF EXISTS public.lcc_record_property_twin_assist_agreement(text,text,text,numeric,text,boolean,uuid);
--   DROP TABLE IF EXISTS public.lcc_property_twin_assist_measure;
--   -- (optionally) restore the narrower source CHECK once the rows are gone.
--   DELETE FROM public.feature_flags_registry WHERE flag = 'PROPERTY_TWIN_ASSIST';
